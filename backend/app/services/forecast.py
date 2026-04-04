"""光伏出力预测服务：理论曲线 × 天气系数"""

from datetime import date, datetime, timedelta

from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS, get_weather_output_factor
from app.models.warning_record import PowerPrediction
from app.services.aggregation import AggregationService
from app.services.solar import SolarService
from app.services.weather import WeatherService


class ForecastService:
    """光伏出力预测"""

    def __init__(self):
        self.weather_service = WeatherService()
        self.solar_service = SolarService()
        self.aggregation_service = AggregationService()

    def _build_weather_map(self, hourly_items: list) -> dict[str, tuple[float, str, int]]:
        """构建 'YYYY-MM-DD HH' -> (factor, text, icon) 映射"""
        result = {}
        for hw in hourly_items:
            try:
                parts = hw.time.split(" ")
                date_str = parts[0]
                hour = int(parts[1].split(":")[0])
                key = f"{date_str} {hour:02d}"
                factor = get_weather_output_factor(hw.icon)
                result[key] = (factor, hw.text, hw.icon)
            except (IndexError, ValueError):
                continue
        return result

    async def predict_street_power(
        self, street: str, target_date: date | None = None
    ) -> list[PowerPrediction]:
        """预测指定街道的逐小时光伏出力，覆盖今明两天完整发电时段"""
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        # 获取天气预报
        forecast = await self.weather_service.get_hourly_forecast(street)

        # 上海时间"今天"和"明天"
        now_shanghai = datetime.utcnow() + timedelta(hours=8)
        today = target_date or now_shanghai.date()
        tomorrow = today + timedelta(days=1)

        # 构建天气映射
        weather_map: dict[str, tuple[float, str, int]] = {}
        if forecast and forecast.hourly:
            weather_map = self._build_weather_map(forecast.hourly)

        # 获取实时天气（用于填充今天已过去的时段）
        realtime = await self.weather_service.get_realtime_weather(street)
        if realtime:
            current_weather = (get_weather_output_factor(realtime.icon), realtime.text, realtime.icon)
        elif forecast and forecast.hourly:
            first = forecast.hourly[0]
            current_weather = (get_weather_output_factor(first.icon), first.text, first.icon)
        else:
            current_weather = (0.7, "多云", 103)

        predictions = []

        for d in [today, tomorrow]:
            clearsky = self.solar_service.get_clearsky_curve(
                d, agg.center_lat, agg.center_lon
            )
            date_str = str(d)

            for hour, ratio in sorted(clearsky.items()):
                key = f"{date_str} {hour:02d}"
                if key in weather_map:
                    factor, text, icon = weather_map[key]
                else:
                    # 无预报数据：今天已过去的时段用当前天气填充，未来无数据则跳过
                    is_past = (d == today and hour <= now_shanghai.hour)
                    if is_past:
                        factor, text, icon = current_weather
                        text = f"{text}*"  # 标记为推算值
                    else:
                        continue  # 未来没预报就不猜

                clearsky_kw = agg.total_capacity_kw * ratio
                predicted = clearsky_kw * factor

                predictions.append(PowerPrediction(
                    time=f"{date_str} {hour:02d}:00",
                    clearsky_ratio=round(ratio, 4),
                    clearsky_power_kw=round(clearsky_kw, 2),
                    weather_factor=factor,
                    predicted_power_kw=round(predicted, 2),
                    weather_text=text,
                    weather_icon=icon,
                ))

        return predictions

    async def predict_all_streets(
        self, target_date: date | None = None
    ) -> dict[str, list[PowerPrediction]]:
        """预测所有街道的出力"""
        results = {}
        for street in JINSHAN_STREETS:
            predictions = await self.predict_street_power(street, target_date)
            if predictions:
                results[street] = predictions
        return results

    async def get_district_total_prediction(
        self, target_date: date | None = None
    ) -> list[dict]:
        """获取全区汇总预测（所有街道合计）"""
        all_predictions = await self.predict_all_streets(target_date)

        hour_totals: dict[str, float] = {}
        hour_clearsky: dict[str, float] = {}

        for street, predictions in all_predictions.items():
            agg = self.aggregation_service.get_street_aggregation(street)
            street_capacity = agg.total_capacity_kw if agg else 0
            for p in predictions:
                hour_totals[p.time] = hour_totals.get(p.time, 0) + p.predicted_power_kw
                hour_clearsky[p.time] = hour_clearsky.get(p.time, 0) + (
                    street_capacity * p.clearsky_ratio
                )

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
