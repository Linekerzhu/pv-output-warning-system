"""Forecast/power data repository — power prediction queries."""

from datetime import datetime

from app.core.constants import SHANGHAI_TZ
from app.core.database import get_pool


class ForecastRepo:

    async def get_street_power(self, station_id: str, start: datetime, end: datetime) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT forecast_time, ghi, clearsky_ghi, weather_ratio,
                       power_kw, clearsky_power_kw, weather_text, weather_icon
                FROM weather_forecast
                WHERE station_id = $1
                  AND ghi IS NOT NULL
                  AND forecast_time >= $2
                  AND forecast_time < $3
                ORDER BY forecast_time
                """,
                station_id,
                start,
                end,
            )

    async def get_all_street_power(self, start: datetime, end: datetime) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                """
                SELECT wf.station_id, s.name AS street_name,
                       wf.forecast_time, wf.ghi, wf.clearsky_ghi, wf.weather_ratio,
                       wf.power_kw, wf.clearsky_power_kw, wf.weather_text, wf.weather_icon
                FROM weather_forecast wf
                JOIN stations s ON s.id = wf.station_id
                WHERE wf.ghi IS NOT NULL
                  AND wf.forecast_time >= $1
                  AND wf.forecast_time < $2
                ORDER BY wf.station_id, wf.forecast_time
                """,
                start,
                end,
            )

    async def get_district_total(self, start: datetime, end: datetime) -> tuple[list[dict], float]:
        """Returns (hourly_totals, total_capacity_kw)."""
        pool = get_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT forecast_time,
                       SUM(power_kw) AS total_power_kw,
                       SUM(clearsky_power_kw) AS total_clearsky_power_kw
                FROM weather_forecast
                WHERE ghi IS NOT NULL
                  AND forecast_time >= $1
                  AND forecast_time < $2
                GROUP BY forecast_time
                ORDER BY forecast_time
                """,
                start,
                end,
            )
            capacity_row = await conn.fetchrow(
                "SELECT SUM(capacity_kw) AS total_capacity_kw FROM stations"
            )
        total_cap = float(capacity_row["total_capacity_kw"]) if capacity_row and capacity_row["total_capacity_kw"] else 0.0
        return rows, total_cap
