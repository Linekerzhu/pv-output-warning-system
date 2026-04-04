"""光伏出力预测服务 — 基于GHI太阳辐射数据

核心公式: power_kw = capacity_kw × GHI / 1000
  - GHI来自和风太阳辐射预报API（实时路径）
  - 或来自pvlib晴空模型×天气衰减估算（历史回测路径）

weather_ratio = forecast_GHI / clearsky_GHI
  - 接近1.0: 晴空，光伏满发
  - 0.3-0.5: 多云/阴天
  - <0.15: 降雨/浓雾
  - 日出日落时ratio保持稳定（两者同步变化），不会误触预警
"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.constants import JINSHAN_STREETS
from app.models.warning_record import PowerPrediction
from app.models.weather_data import HourlyWeather
from app.services.aggregation import AggregationService
from app.services.solar import SolarService
from app.services.weather import WeatherService


class ForecastService:
    """基于GHI的光伏出力预测"""

    def __init__(self):
        self.weather_service = WeatherService()
        self.solar_service = SolarService()
        self.aggregation_service = AggregationService()

    # ── 唯一的预测计算入口 ─────────────────────────────

    def predict_from_weather(
        self, street: str, hourly: list[HourlyWeather],
        ghi_values: dict[int, float], target_date: date,
        is_estimated: bool = False,
    ) -> list[PowerPrediction]:
        """基于给定天气和GHI数据预测出力 — 实时和历史的唯一计算入口

        Args:
            street: 街道名
            hourly: 天气数据（仅用于 text/icon 展示）
            ghi_values: {hour: ghi_value} 映射
            target_date: 目标日期
            is_estimated: True=历史估算GHI, False=来自辐射预报API
        """
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        capacity = agg.total_capacity_kw
        clearsky_curve = self.solar_service.get_clearsky_ghi(
            target_date, agg.center_lat, agg.center_lon
        )
        date_str = str(target_date)

        # 天气文字映射（仅展示用）
        weather_map: dict[int, tuple[str, int]] = {}
        for hw in hourly:
            try:
                hour = int(hw.time.split(" ")[1].split(":")[0])
                weather_map[hour] = (hw.text, hw.icon)
            except (IndexError, ValueError):
                continue

        predictions = []
        for hour, clearsky_ghi in sorted(clearsky_curve.items()):
            ghi = ghi_values.get(hour)
            if ghi is None or clearsky_ghi <= 0:
                continue

            weather_ratio = min(ghi / clearsky_ghi, 1.5)
            from app.core.config import settings
            pr = settings.PV_PERFORMANCE_RATIO
            power_kw = capacity * ghi / 1000 * pr
            clearsky_power_kw = capacity * clearsky_ghi / 1000 * pr
            weather_text, weather_icon = weather_map.get(hour, ("--", 999))

            predictions.append(PowerPrediction(
                time=f"{date_str} {hour:02d}:00",
                ghi=round(ghi, 1),
                clearsky_ghi=round(clearsky_ghi, 1),
                weather_ratio=round(weather_ratio, 4),
                power_kw=round(power_kw, 2),
                clearsky_power_kw=round(clearsky_power_kw, 2),
                weather_text=weather_text,
                weather_icon=weather_icon,
                is_estimated=is_estimated,
            ))

        return predictions

    # ── 实时预测（获取数据 → 调用 predict_from_weather）────

    async def _fetch_district_ghi(self, hours: int = 48) -> dict[str, float]:
        """获取全区GHI辐射预报（只调一次，所有街道共用）

        Returns:
            {"YYYY-MM-DD HH": ghi_wm2} 映射，失败返回空dict
        """
        from app.core.config import settings
        radiation = await self.weather_service.get_solar_radiation(
            lat=settings.LOCATION_LAT, lon=settings.LOCATION_LON, hours=hours
        )
        ghi_map: dict[str, float] = {}
        if radiation and radiation.forecasts:
            for r in radiation.forecasts:
                try:
                    parts = r.time.split(" ")
                    hour = int(parts[1].split(":")[0])
                    key = f"{parts[0]} {hour:02d}"
                    ghi_map[key] = r.ghi
                except (IndexError, ValueError):
                    continue
        if not ghi_map:
            logger.error("太阳辐射API无数据或请求失败")
        return ghi_map

    async def predict_street_power(
        self, street: str, target_date: date | None = None,
        ghi_map: dict[str, float] | None = None,
    ) -> list[PowerPrediction]:
        """预测指定街道出力

        Args:
            ghi_map: 预获取的GHI数据，如果为None则自行获取
        """
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        now_shanghai = datetime.now(timezone(timedelta(hours=8)))
        today = target_date or now_shanghai.date()
        tomorrow = today + timedelta(days=1)

        # GHI：使用传入的或自行获取（单街道调用场景）
        if ghi_map is None:
            ghi_map = await self._fetch_district_ghi(hours=48)

        # 天气预报（仅用于展示 text/icon，不参与出力计算）
        weather_forecast = await self.weather_service.get_hourly_forecast(street)
        hourly = weather_forecast.hourly if weather_forecast else []

        # 对今天和明天分别调用唯一计算入口
        predictions = []
        for d in [today, tomorrow]:
            # 提取当天的 {hour: ghi}
            date_str = str(d)
            day_ghi: dict[int, float] = {}
            for key, ghi in ghi_map.items():
                if key.startswith(date_str):
                    try:
                        hour = int(key.split(" ")[1])
                        day_ghi[hour] = ghi
                    except (IndexError, ValueError):
                        continue

            predictions.extend(
                self.predict_from_weather(street, hourly, day_ghi, d)
            )

        return predictions

    async def predict_all_streets(
        self, target_date: date | None = None
    ) -> dict[str, list[PowerPrediction]]:
        """预测所有街道 — GHI只获取一次，分发给所有街道"""
        ghi_map = await self._fetch_district_ghi(hours=48)

        results = {}
        for street in JINSHAN_STREETS:
            predictions = await self.predict_street_power(
                street, target_date, ghi_map=ghi_map
            )
            if predictions:
                results[street] = predictions
        return results

    async def get_district_total_prediction(
        self, target_date: date | None = None
    ) -> list[dict]:
        all_predictions = await self.predict_all_streets(target_date)

        hour_totals: dict[str, float] = {}
        hour_clearsky: dict[str, float] = {}

        for street, predictions in all_predictions.items():
            for p in predictions:
                hour_totals[p.time] = hour_totals.get(p.time, 0) + p.power_kw
                hour_clearsky[p.time] = hour_clearsky.get(p.time, 0) + p.clearsky_power_kw

        total_capacity = self.aggregation_service.get_total_capacity_kw()

        return [
            {
                "time": time,
                "predicted_power_kw": round(power, 2),
                "clearsky_power_kw": round(hour_clearsky.get(time, 0), 2),
                "total_capacity_kw": total_capacity,
            }
            for time, power in sorted(hour_totals.items())
        ]
