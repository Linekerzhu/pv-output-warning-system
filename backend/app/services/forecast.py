"""光伏出力预测服务：理论曲线 × 天气系数"""

from datetime import date, datetime, timezone

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

    async def predict_street_power(
        self, street: str, target_date: date | None = None
    ) -> list[PowerPrediction]:
        """预测指定街道的逐小时光伏出力"""
        target_date = target_date or date.today()

        # 1. 获取街道聚合装机容量
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        # 2. 计算晴空理论曲线
        clearsky = self.solar_service.get_clearsky_curve(
            target_date, agg.center_lat, agg.center_lon
        )

        # 3. 获取天气预报
        forecast = await self.weather_service.get_hourly_forecast(street)
        if not forecast:
            logger.warning(f"{street} 天气预报获取失败，使用晴天默认值")
            # 降级：假设晴天
            return [
                PowerPrediction(
                    time=f"{target_date} {h:02d}:00",
                    clearsky_ratio=ratio,
                    weather_factor=1.0,
                    predicted_power_kw=round(agg.total_capacity_kw * ratio, 2),
                    weather_text="晴（默认）",
                    weather_icon=100,
                )
                for h, ratio in sorted(clearsky.items())
            ]

        # 4. 匹配天气预报到每个小时
        weather_by_hour: dict[int, tuple[float, str, int]] = {}
        for hw in forecast.hourly:
            try:
                hour = int(hw.time.split(" ")[1].split(":")[0])
            except (IndexError, ValueError):
                continue
            factor = get_weather_output_factor(hw.icon)
            weather_by_hour[hour] = (factor, hw.text, hw.icon)

        # 5. 计算预测出力
        predictions = []
        for hour, ratio in sorted(clearsky.items()):
            factor, text, icon = weather_by_hour.get(hour, (1.0, "晴", 100))
            predicted = agg.total_capacity_kw * ratio * factor

            predictions.append(PowerPrediction(
                time=f"{target_date} {hour:02d}:00",
                clearsky_ratio=round(ratio, 4),
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

        # 按小时汇总
        hour_totals: dict[str, float] = {}
        hour_clearsky: dict[str, float] = {}

        for street, predictions in all_predictions.items():
            agg = self.aggregation_service.get_street_aggregation(street)
            street_capacity = agg.total_capacity_kw if agg else 0
            for p in predictions:
                hour_totals[p.time] = hour_totals.get(p.time, 0) + p.predicted_power_kw
                # 晴空出力 = 街道容量 × 晴空比例（不受天气影响）
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
