"""光伏出力预测计算

核心公式: power_kw = capacity_kw × (GHI / 1000) × PR
  PR (Performance Ratio) ≈ 0.80, 包含逆变器效率、系统损耗、温度影响

本模块仅提供纯计算函数，不涉及 API 调用或 DB 操作。
实时预测数据由 DataCollector 写入 DB，API 路由从 DB 读取。
"""

from datetime import date

from app.core.config import settings
from app.models.warning_record import PowerPrediction
from app.models.weather_data import HourlyWeather
from app.services.aggregation import AggregationService
from app.services.solar import SolarService


class ForecastService:
    """基于GHI的光伏出力预测（纯计算）"""

    def __init__(
        self,
        solar_service: SolarService | None = None,
        aggregation_service: AggregationService | None = None,
    ):
        self.solar_service = solar_service or SolarService()
        self.aggregation_service = aggregation_service or AggregationService()

    def predict_from_weather(
        self, street: str, hourly: list[HourlyWeather],
        ghi_values: dict[int, float], target_date: date,
        is_estimated: bool = False,
    ) -> list[PowerPrediction]:
        """基于给定天气和GHI数据预测出力。

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
        pr = settings.PV_PERFORMANCE_RATIO
        clearsky_curve = self.solar_service.get_clearsky_ghi(
            target_date, agg.center_lat, agg.center_lon
        )
        date_str = str(target_date)

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
