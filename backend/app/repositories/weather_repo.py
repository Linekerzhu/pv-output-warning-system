"""Weather data repository — all weather_forecast table queries."""

from datetime import datetime, timedelta

from app.core.constants import SHANGHAI_TZ, STREET_TO_STATION_ID
from app.core.database import get_pool


def _fmt_time(dt: datetime) -> str:
    if dt.tzinfo is None:
        from datetime import timezone
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M")


class WeatherRepo:

    async def get_street_forecast(self, station_id: str) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT forecast_time, weather_icon, weather_text,
                       temp, humidity, cloud, pop, wind_speed, precip
                FROM weather_forecast
                WHERE station_id = $1
                ORDER BY forecast_time
                """,
                station_id,
            )

    async def get_all_forecasts(self) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT s.name as street, wf.forecast_time, wf.weather_icon, wf.weather_text,
                       wf.temp, wf.humidity, wf.cloud, wf.pop, wf.wind_speed, wf.precip
                FROM weather_forecast wf
                JOIN stations s ON s.id = wf.station_id
                ORDER BY s.name, wf.forecast_time
                """
            )

    async def get_weather_summary_rows(self, since: datetime) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT s.name as street, wf.forecast_time,
                       wf.weather_icon, wf.weather_text
                FROM weather_forecast wf
                JOIN stations s ON s.id = wf.station_id
                WHERE wf.forecast_time >= $1
                ORDER BY s.name, wf.forecast_time
                """,
                since,
            )

    async def get_solar_radiation(self, station_id: str, since: datetime, limit: int) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT forecast_time, ghi, dni, dhi FROM (
                    SELECT forecast_time, ghi, dni, dhi FROM weather_forecast
                    WHERE station_id = $1 AND forecast_time >= $2 AND ghi IS NOT NULL
                    UNION ALL
                    SELECT time AS forecast_time, ghi, dni, dhi FROM weather_history
                    WHERE station_id = $1 AND time >= $2 AND ghi IS NOT NULL
                ) combined
                ORDER BY forecast_time
                LIMIT $3
                """,
                station_id,
                since,
                limit,
            )
