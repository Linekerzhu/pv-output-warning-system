"""和风天气API对接服务"""

import httpx
from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS
from app.models.weather_data import HourlyWeather, WeatherForecast


class WeatherService:
    """和风天气数据采集服务"""

    def __init__(self):
        self.api_key = settings.QWEATHER_API_KEY
        self.base_url = settings.QWEATHER_API_HOST

    async def get_hourly_forecast(self, street: str) -> WeatherForecast | None:
        """获取指定街道未来24小时逐小时预报"""
        street_info = JINSHAN_STREETS.get(street)
        if not street_info:
            logger.error(f"未知街道: {street}")
            return None

        location = f"{street_info['lon']},{street_info['lat']}"

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self.base_url}/v7/weather/24h",
                    params={
                        "location": location,
                        "key": self.api_key,
                        "lang": "zh",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            if data.get("code") != "200":
                logger.error(f"和风API错误: code={data.get('code')}, street={street}")
                return None

            hourly = []
            for item in data.get("hourly", []):
                hourly.append(HourlyWeather(
                    time=item["fxTime"][:16].replace("T", " "),
                    icon=int(item["icon"]),
                    text=item["text"],
                    temp=float(item["temp"]),
                    humidity=int(item["humidity"]),
                    cloud=int(item.get("cloud", 0)),
                    pop=int(item.get("pop", 0)),
                    wind_speed=float(item.get("windSpeed", 0)),
                    precip=float(item.get("precip", 0)),
                ))

            return WeatherForecast(
                street=street,
                update_time=data.get("updateTime", ""),
                hourly=hourly,
            )

        except Exception as e:
            logger.error(f"获取{street}天气预报失败: {e}")
            return None

    async def get_all_streets_forecast(self) -> dict[str, WeatherForecast]:
        """获取所有街道的天气预报"""
        results = {}
        for street in JINSHAN_STREETS:
            forecast = await self.get_hourly_forecast(street)
            if forecast:
                results[street] = forecast
        return results
