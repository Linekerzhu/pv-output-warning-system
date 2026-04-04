"""基于pvlib的光伏理论发电曲线计算"""

from datetime import date

import pandas as pd
from pvlib import location as pvloc

from app.core.config import settings


class SolarService:
    """光伏晴空理论出力曲线"""

    def __init__(self):
        self.start_hour = settings.GENERATION_START_HOUR
        self.end_hour = settings.GENERATION_END_HOUR

    def get_clearsky_curve(
        self, target_date: date, lat: float, lon: float
    ) -> dict[int, float]:
        """
        计算指定日期和位置的晴空GHI曲线，归一化为0-1。

        Returns:
            dict[int, float]: {hour: normalized_ratio}，仅包含有效发电时段
        """
        site = pvloc.Location(lat, lon, tz="Asia/Shanghai", altitude=4)

        # 生成全天逐小时时间序列
        times = pd.date_range(
            start=f"{target_date} 00:00",
            periods=24,
            freq="h",
            tz="Asia/Shanghai",
        )

        # Ineichen晴空模型
        clearsky = site.get_clearsky(times, model="ineichen")
        ghi = clearsky["ghi"]

        # 归一化：以当天最大GHI为基准
        max_ghi = ghi.max()
        if max_ghi == 0:
            return {}

        result = {}
        for ts, val in ghi.items():
            hour = ts.hour
            if self.start_hour <= hour <= self.end_hour:
                result[hour] = round(float(val / max_ghi), 4)

        return result

    def get_clearsky_ghi(
        self, target_date: date, lat: float, lon: float
    ) -> dict[int, float]:
        """
        计算指定日期和位置的晴空GHI曲线（绝对值 W/m²）。

        Returns:
            dict[int, float]: {hour: ghi_wm2}，仅包含有效发电时段
        """
        site = pvloc.Location(lat, lon, tz="Asia/Shanghai", altitude=4)

        times = pd.date_range(
            start=f"{target_date} 00:00",
            periods=24,
            freq="h",
            tz="Asia/Shanghai",
        )

        clearsky = site.get_clearsky(times, model="ineichen")
        ghi = clearsky["ghi"]

        result = {}
        for ts, val in ghi.items():
            hour = ts.hour
            if self.start_hour <= hour <= self.end_hour and val > 0:
                result[hour] = round(float(val), 1)

        return result

    def get_clearsky_curve_default(self, target_date: date) -> dict[int, float]:
        """使用金山中心坐标计算晴空曲线"""
        return self.get_clearsky_curve(
            target_date,
            settings.LOCATION_LAT,
            settings.LOCATION_LON,
        )
