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
        """获取太阳辐射预报 — 使用 Open-Meteo 免费 API（替代和风辐照API）

        数据来源: Open-Meteo (ECMWF/GFS NWP模型)
        成本: 完全免费, 无需 API Key
        兜底: Open-Meteo 不可用时, 用 pvlib 晴空模型 + 云量推算
        """
        forecast_days = max(1, (hours + 23) // 24)

        # ── 方案1: Open-Meteo 免费 API ──
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.open-meteo.com/v1/forecast",
                    params={
                        "latitude": round(lat, 2),
                        "longitude": round(lon, 2),
                        "hourly": "shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
                        "timezone": "Asia/Shanghai",
                        "forecast_days": forecast_days,
                    },
                )
                resp.raise_for_status()
                data = resp.json()

            hourly = data.get("hourly", {})
            times = hourly.get("time", [])
            ghi_list = hourly.get("shortwave_radiation", [])
            dni_list = hourly.get("direct_normal_irradiance", [])
            dhi_list = hourly.get("diffuse_radiation", [])

            if not times:
                logger.warning("Open-Meteo 返回空数据，尝试兜底方案")
                return await self._fallback_solar_radiation(lat, lon, hours)

            forecasts = []
            for i in range(min(len(times), hours)):
                t = times[i].replace("T", " ")  # "2026-04-07T08:00" → "2026-04-07 08:00"
                forecasts.append(SolarRadiation(
                    time=t,
                    ghi=float(ghi_list[i] or 0),
                    dni=float(dni_list[i] or 0),
                    dhi=float(dhi_list[i] or 0),
                    elevation=0,
                ))

            logger.info(f"Open-Meteo 太阳辐射: {len(forecasts)} 小时数据")
            return SolarRadiationForecast(lat=lat, lon=lon, forecasts=forecasts)

        except Exception as e:
            logger.warning(f"Open-Meteo 请求失败({e})，使用兜底方案")
            return await self._fallback_solar_radiation(lat, lon, hours)

    async def _fallback_solar_radiation(self, lat: float, lon: float, hours: int) -> SolarRadiationForecast | None:
        """兜底: pvlib 晴空GHI × 云量衰减系数 (Campbell-Norman 模型)

        零外部API调用，使用已有天气预报的 cloud 字段推算 GHI
        """
        try:
            from datetime import datetime, timedelta
            from pvlib import location as pvloc, irradiance
            import pandas as pd
            import numpy as np

            site = pvloc.Location(lat, lon, tz="Asia/Shanghai", altitude=4)
            now = datetime.now().astimezone()
            start = now.replace(minute=0, second=0, microsecond=0)

            times = pd.date_range(start=start, periods=hours, freq="h", tz="Asia/Shanghai")
            clearsky = site.get_clearsky(times, model="ineichen")
            solar_pos = site.get_solarposition(times)

            # 尝试从DB获取云量预报
            cloud_map: dict[str, int] = {}
            try:
                from app.core.database import get_pool
                from app.core.constants import STREET_TO_STATION_ID
                pool = get_pool()
                station_id = STREET_TO_STATION_ID.get("山阳镇", "shanyang")
                async with pool.acquire() as conn:
                    rows = await conn.fetch(
                        "SELECT forecast_time, cloud FROM weather_forecast WHERE station_id = $1 AND forecast_time >= $2 ORDER BY forecast_time LIMIT $3",
                        station_id, start, hours,
                    )
                    for r in rows:
                        ft = r["forecast_time"]
                        key = ft.strftime("%Y-%m-%d %H:00")
                        cloud_map[key] = r["cloud"] or 0
            except Exception:
                pass

            forecasts = []
            for ts in times:
                hour_key = ts.strftime("%Y-%m-%d %H:00")
                cs_ghi = float(clearsky.loc[ts, "ghi"])
                cs_dni = float(clearsky.loc[ts, "dni"])
                cs_dhi = float(clearsky.loc[ts, "dhi"])
                zenith = float(solar_pos.loc[ts, "zenith"])

                cloud = cloud_map.get(hour_key, 30)  # 默认30%云量
                cloud_frac = cloud / 100.0

                # Campbell-Norman 云量衰减
                tau = max(0.0, 1.0 - 0.75 * (cloud_frac ** 3.4))
                ghi = round(cs_ghi * tau, 1)
                dni = round(cs_dni * tau, 1) if zenith < 87 else 0
                dhi = round(max(0, ghi - dni * max(0, np.cos(np.radians(zenith)))), 1)

                forecasts.append(SolarRadiation(
                    time=ts.strftime("%Y-%m-%d %H:%M"),
                    ghi=ghi, dni=dni, dhi=dhi, elevation=max(0, 90 - zenith),
                ))

            logger.info(f"兜底方案: pvlib+云量推算 {len(forecasts)} 小时GHI")
            return SolarRadiationForecast(lat=lat, lon=lon, forecasts=forecasts)

        except Exception as e:
            logger.error(f"兜底方案也失败: {e}")
            return None

    async def get_all_streets_forecast(self) -> dict[str, WeatherForecast]:
        """获取所有街道的天气预报"""
        results = {}
        for street in JINSHAN_STREETS:
            forecast = await self.get_hourly_forecast(street)
            if forecast:
                results[street] = forecast
        return results
