"""Warning data repository — all warnings table queries."""

from datetime import datetime

from app.core.constants import SHANGHAI_TZ
from app.core.database import get_pool

_LEVEL_ORDER_SQL = "CASE level WHEN 'red' THEN 0 WHEN 'orange' THEN 1 WHEN 'yellow' THEN 2 WHEN 'blue' THEN 3 ELSE 4 END"

_WARNING_COLUMNS = """
    id, level, label, type, street, action,
    change_rate, abs_change_kw,
    from_time, to_time, from_power_kw, to_power_kw,
    issued_at, weather_from, weather_to
"""


class WarningRepo:

    async def get_active_warnings(self) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                f"""
                SELECT {_WARNING_COLUMNS}
                FROM warnings
                WHERE is_active = TRUE
                ORDER BY {_LEVEL_ORDER_SQL}, from_time
                """
            )

    async def get_warning_history(self, since: datetime) -> list[dict]:
        pool = get_pool()
        async with pool.acquire() as conn:
            return await conn.fetch(
                f"""
                SELECT {_WARNING_COLUMNS}
                FROM warnings
                WHERE issued_at >= $1
                ORDER BY issued_at DESC
                """,
                since,
            )

    async def insert_warnings(self, warn_rows: list[tuple]) -> None:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO warnings (
                    id, level, label, type, street, action,
                    change_rate, abs_change_kw,
                    from_time, to_time, from_power_kw, to_power_kw,
                    issued_at, weather_from, weather_to, is_active
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE)
                ON CONFLICT (id) DO NOTHING
                """,
                warn_rows,
            )

    async def deactivate_old_warnings(self, before: datetime) -> None:
        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE warnings SET is_active = FALSE
                WHERE is_active = TRUE AND issued_at < $1
                """,
                before,
            )
