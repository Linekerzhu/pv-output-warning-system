"""历史天气数据服务

职责：
  1. 从和风历史天气API获取实际观测数据
  2. 用 pvlib clearsky × icon衰减系数 估算历史GHI（无真实GHI时的fallback）

注意：本服务仅被 DataCollector.collect_observations() 调用，
不直接服务 API 请求。所有 API 读取走 DB。
"""

from datetime import date

import httpx
from loguru import logger

from app.core.config import settings
from app.core.constants import (
    JINSHAN_LOCATION_ID,
    get_historical_weather_reduction,
)
from app.models.weather_data import HourlyWeather
from app.services.solar import SolarService


class HistoricalWeatherService:
    """历史天气获取 + GHI估算"""

    def __init__(self, solar_service: SolarService | None = None):
        self.api_key = settings.QWEATHER_API_KEY
        self.base_url = settings.QWEATHER_API_HOST
        self.solar_service = solar_service or SolarService()

    async def fetch_historical_weather(self, target_date: date) -> list[HourlyWeather] | None:
        """从和风历史天气API获取实际观测数据（按区级 location ID）"""
        date_str = target_date.strftime("%Y%m%d")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.base_url}/v7/historical/weather",
                    params={
                        "location": JINSHAN_LOCATION_ID,
                        "date": date_str,
                        "key": self.api_key,
                    },
                    headers={"Accept-Encoding": "gzip"},
                )
                resp.raise_for_status()
                data = resp.json()

            if data.get("code") != "200":
                error = data.get("error", {})
                logger.error(f"历史天气API错误: {error.get('title', data.get('code'))}")
                return None

            hourly = []
            for item in data.get("weatherHourly", []):
                time_str = item["time"][:16].replace("T", " ")
                hourly.append(HourlyWeather(
                    time=time_str,
                    icon=int(item["icon"]),
                    text=item["text"],
                    temp=float(item["temp"]),
                    humidity=int(item.get("humidity", 50)),
                    cloud=0,
                    pop=0,
                    wind_speed=float(item.get("windSpeed", 0)),
                    precip=float(item.get("precip", 0)),
                ))
            return hourly

        except Exception as e:
            logger.error(f"获取历史天气失败 date={date_str}: {e}")
            return None

    def estimate_ghi_from_weather(
        self, target_date: date, hourly: list[HourlyWeather],
        lat: float, lon: float,
    ) -> dict[int, float]:
        """用pvlib晴空GHI × 天气图标衰减系数 估算历史GHI

        仅在无 forecast_archive GHI 数据时使用（部署前的历史日期）。
        """
        clearsky = self.solar_service.get_clearsky_ghi(target_date, lat, lon)

        weather_map: dict[int, int] = {}
        for h in hourly:
            try:
                hour = int(h.time.split(" ")[1].split(":")[0])
                weather_map[hour] = h.icon
            except (IndexError, ValueError):
                continue

        estimated: dict[int, float] = {}
        for hour, clearsky_ghi in clearsky.items():
            icon = weather_map.get(hour)
            if icon is None:
                continue
            reduction = get_historical_weather_reduction(icon)
            estimated[hour] = round(clearsky_ghi * reduction, 1)

        return estimated
