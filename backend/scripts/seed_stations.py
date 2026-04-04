"""Populate stations table from JINSHAN_STREETS + pv_users.json"""

import asyncio
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import asyncpg

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS, STREET_TO_STATION_ID


def load_pv_users() -> dict[str, dict]:
    """Load PV users and compute per-street aggregation."""
    pv_file = Path(settings.PV_USERS_FILE)
    if not pv_file.exists():
        pv_file = Path(__file__).parent.parent / settings.PV_USERS_FILE
    if not pv_file.exists():
        print(f"WARNING: pv_users.json not found at {pv_file}")
        return {}

    with open(pv_file, encoding="utf-8") as f:
        users = json.load(f)

    agg: dict[str, dict] = {}
    for u in users:
        street = u.get("street", "")
        if street not in agg:
            agg[street] = {"capacity": 0.0, "active": 0, "total": 0}
        agg[street]["total"] += 1
        if u.get("status") == "运行":
            agg[street]["active"] += 1
            agg[street]["capacity"] += u.get("capacity_kw", 0)

    return agg


async def seed():
    conn = await asyncpg.connect(settings.DATABASE_URL)
    try:
        pv_agg = load_pv_users()

        for name, info in JINSHAN_STREETS.items():
            sid = STREET_TO_STATION_ID[name]
            street_agg = pv_agg.get(name, {})
            await conn.execute(
                """
                INSERT INTO stations (id, name, lat, lon, capacity_kw, active_users, total_users)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    lat = EXCLUDED.lat,
                    lon = EXCLUDED.lon,
                    capacity_kw = EXCLUDED.capacity_kw,
                    active_users = EXCLUDED.active_users,
                    total_users = EXCLUDED.total_users,
                    updated_at = NOW()
                """,
                sid,
                name,
                info["lat"],
                info["lon"],
                street_agg.get("capacity", 0.0),
                street_agg.get("active", 0),
                street_agg.get("total", 0),
            )
            print(f"  Seeded: {sid} ({name}) capacity={street_agg.get('capacity', 0):.1f}kW")

        count = await conn.fetchval("SELECT COUNT(*) FROM stations")
        print(f"\nDone. {count} stations in database.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(seed())
