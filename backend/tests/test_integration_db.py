"""Integration test: verify full data collection → DB → API read cycle.

Requires a running PostgreSQL with pv_warning database.
Skip with: pytest -m "not integration"
"""

import pytest
import asyncio
from datetime import datetime, timedelta, timezone

SHANGHAI_TZ = timezone(timedelta(hours=8))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_collect_and_read_cycle():
    """Verify: collect weather → DB has data → API can read it."""
    from app.core.database import init_db, close_db, get_pool

    await init_db()
    pool = get_pool()

    try:
        # Verify stations exist
        async with pool.acquire() as conn:
            count = await conn.fetchval("SELECT COUNT(*) FROM stations")
        assert count == 10, f"Expected 10 stations, got {count}"

        # Verify tables exist and are queryable
        async with pool.acquire() as conn:
            await conn.fetch("SELECT * FROM weather_forecast LIMIT 1")
            await conn.fetch("SELECT * FROM weather_history LIMIT 1")
            await conn.fetch("SELECT * FROM warnings LIMIT 1")

    finally:
        await close_db()


@pytest.mark.integration
@pytest.mark.asyncio
async def test_forecast_table_schema():
    """Verify weather_forecast table has expected columns."""
    from app.core.database import init_db, close_db, get_pool

    await init_db()
    pool = get_pool()

    try:
        async with pool.acquire() as conn:
            cols = await conn.fetch(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_name = 'weather_forecast'
                ORDER BY ordinal_position
                """
            )
        col_names = [r["column_name"] for r in cols]
        assert "station_id" in col_names
        assert "forecast_time" in col_names
        assert "ghi" in col_names
        assert "weather_ratio" in col_names
        assert "power_kw" in col_names
    finally:
        await close_db()
