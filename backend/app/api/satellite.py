"""Satellite API: real-time GHI from Himawari-9 satellite."""

from datetime import datetime, timedelta

from fastapi import APIRouter

from app.core.constants import SHANGHAI_TZ
from app.core.database import get_pool

router = APIRouter()


@router.get("/ghi/latest")
async def get_latest_ghi():
    """Get latest satellite GHI for all grid cells."""
    pool = get_pool()
    async with pool.acquire() as conn:
        # Find latest obs_time (include nighttime data)
        latest = await conn.fetchval(
            "SELECT MAX(obs_time) FROM satellite_ghi"
        )
        if not latest:
            return {"obs_time": None, "grids": []}

        rows = await conn.fetch(
            """
            SELECT grid_id, ghi, swr, qa_flag, is_valid
            FROM satellite_ghi
            WHERE obs_time = $1
            ORDER BY grid_id
            """,
            latest,
        )

    obs_shanghai = latest.astimezone(SHANGHAI_TZ)
    return {
        "obs_time": obs_shanghai.isoformat(),
        "obs_time_utc": latest.isoformat(),
        "grids": [
            {
                "grid_id": r["grid_id"],
                "ghi": r["ghi"],
                "swr": r["swr"],
                "qa_flag": r["qa_flag"],
                "is_valid": r["is_valid"],
            }
            for r in rows
        ],
    }


@router.get("/ghi/history")
async def get_ghi_history(grid_id: str, hours: int = 6):
    """Get GHI history for a single grid cell."""
    pool = get_pool()
    since = datetime.now(SHANGHAI_TZ) - timedelta(hours=hours)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT obs_time, ghi, is_valid
            FROM satellite_ghi
            WHERE grid_id = $1 AND obs_time >= $2
            ORDER BY obs_time
            """,
            grid_id,
            since,
        )

    return {
        "grid_id": grid_id,
        "data": [
            {
                "time": r["obs_time"].astimezone(SHANGHAI_TZ).isoformat(),
                "ghi": r["ghi"],
                "is_valid": r["is_valid"],
            }
            for r in rows
        ],
    }


@router.get("/ghi/frames")
async def get_ghi_frames(date: str):
    """Get all hourly GHI frames for a date (for playback)."""
    from datetime import date as date_type
    target = date_type.fromisoformat(date)
    day_start = datetime(target.year, target.month, target.day, tzinfo=SHANGHAI_TZ)
    day_end = day_start + timedelta(days=1)

    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT obs_time, grid_id, ghi, is_valid
            FROM satellite_ghi
            WHERE obs_time >= $1 AND obs_time < $2
            ORDER BY obs_time, grid_id
            """,
            day_start, day_end,
        )

    # Group by obs_time
    frames: dict[str, list] = {}
    for r in rows:
        t = r["obs_time"].astimezone(SHANGHAI_TZ).strftime("%H:%M")
        if t not in frames:
            frames[t] = []
        frames[t].append({"grid_id": r["grid_id"], "ghi": r["ghi"], "is_valid": r["is_valid"]})

    return {
        "date": date,
        "frames": [{"time": t, "grids": grids} for t, grids in sorted(frames.items())],
    }


@router.get("/status")
async def get_satellite_status():
    """Get satellite data collection status."""
    pool = get_pool()
    now = datetime.now(SHANGHAI_TZ)

    async with pool.acquire() as conn:
        latest = await conn.fetchval(
            "SELECT MAX(obs_time) FROM satellite_ghi"
        )
        today_count = await conn.fetchval(
            "SELECT COUNT(DISTINCT obs_time) FROM satellite_ghi WHERE obs_time::date = $1",
            now.date(),
        )
        valid_latest = await conn.fetchval(
            """
            SELECT COUNT(*) FROM satellite_ghi
            WHERE obs_time = (SELECT MAX(obs_time) FROM satellite_ghi)
              AND is_valid = TRUE AND ghi > 0
            """
        )

    delay = None
    if latest:
        delay = (now - latest.astimezone(SHANGHAI_TZ)).total_seconds() / 60

    return {
        "last_update": latest.astimezone(SHANGHAI_TZ).isoformat() if latest else None,
        "delay_minutes": round(delay, 1) if delay else None,
        "collections_today": today_count or 0,
        "valid_grids_latest": valid_latest or 0,
        "total_grids": 51,
    }
