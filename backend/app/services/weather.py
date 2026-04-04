"""和风天气API对接服务"""

import httpx
from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS
from app.models.weather_data import HourlyWeather, WeatherForecast, SolarRadiation, SolarRadiationForecast


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
                    f"{self.base_url}/v7/weather/72h",
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

    async def get_realtime_weather(self, street: str) -> HourlyWeather | None:
        """获取指定街道的实时天气"""
        street_info = JINSHAN_STREETS.get(street)
        if not street_info:
            return None

        location = f"{street_info['lon']},{street_info['lat']}"

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self.base_url}/v7/weather/now",
                    params={
                        "location": location,
                        "key": self.api_key,
                        "lang": "zh",
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            if data.get("code") != "200":
                return None

            now = data.get("now", {})
            return HourlyWeather(
                time=data.get("updateTime", "")[:16].replace("T", " "),
                icon=int(now.get("icon", 100)),
                text=now.get("text", "未知"),
                temp=float(now.get("temp", 20)),
                humidity=int(now.get("humidity", 50)),
                cloud=int(now.get("cloud", 0)),
                pop=0,
                wind_speed=float(now.get("windSpeed", 0)),
                precip=float(now.get("precip", 0)),
            )
        except Exception as e:
            logger.error(f"获取{street}实时天气失败: {e}")
            return None

    async def get_solar_radiation(self, lat: float = 30.82, lon: float = 121.20, hours: int = 24) -> SolarRadiationForecast | None:
        """获取太阳辐射预报数据"""
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.base_url}/solarradiation/v1/forecast/{lat:.2f}/{lon:.2f}",
                    params={
                        "key": self.api_key,
                        "hours": hours,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            forecasts_raw = data.get("forecasts", [])
            if not forecasts_raw:
                logger.error("太阳辐射API无数据")
                return None

            forecasts = []
            for item in forecasts_raw:
                ft = item["forecastTime"]
                # Convert ISO8601 to yyyy-MM-dd HH:mm (UTC→Shanghai +8)
                from datetime import datetime, timezone, timedelta
                dt = datetime.fromisoformat(ft.replace("Z", "+00:00"))
                dt_shanghai = dt.astimezone(timezone(timedelta(hours=8)))
                time_str = dt_shanghai.strftime("%Y-%m-%d %H:%M")

                forecasts.append(SolarRadiation(
                    time=time_str,
                    ghi=float(item.get("ghi", {}).get("value", 0)),
                    dni=float(item.get("dni", {}).get("value", 0)),
                    dhi=float(item.get("dhi", {}).get("value", 0)),
                    elevation=float(item.get("solarAngle", {}).get("elevation", 0)),
                ))

            return SolarRadiationForecast(lat=lat, lon=lon, forecasts=forecasts)

        except Exception as e:
            logger.error(f"获取太阳辐射数据失败: {e}")
            return None

    async def get_all_streets_forecast(self) -> dict[str, WeatherForecast]:
        """获取所有街道的天气预报"""
        results = {}
        for street in JINSHAN_STREETS:
            forecast = await self.get_hourly_forecast(street)
            if forecast:
                results[street] = forecast
        return results
