"""回填历史卫星 GHI 数据 — 全天24小时整点"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.database import init_db, close_db
from app.services.satellite_collector import SatelliteCollector


async def backfill(start_date: str, end_date: str):
    await init_db()
    sc = SatelliteCollector()

    start = datetime.strptime(start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    end = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)

    current = start
    total_success = 0
    total_fail = 0

    while current <= end:
        # Full day: UTC 00:00-23:00
        for hh in range(24):
            target = current.replace(hour=hh, minute=0)
            beijing_h = (hh + 8) % 24

            nc_path = await asyncio.to_thread(sc._ftp_download, target)
            if nc_path is None:
                total_fail += 1
                continue

            try:
                grid_data = sc._extract_grid_swr(nc_path, target)
                count, valid = await sc._save_to_db(grid_data)
                total_success += 1

                ghis = [d["ghi"] for d in grid_data if d["is_valid"] and d["ghi"] > 0]
                avg = sum(ghis) / len(ghis) if ghis else 0
                tag = f"avg={avg:.0f}" if ghis else "night"
                print(f"  {current.strftime('%m/%d')} {beijing_h:02d}:00  {valid:2d} valid  {tag}")
            except Exception as e:
                print(f"  {current.strftime('%m/%d')} {beijing_h:02d}:00  ERROR: {e}")
                total_fail += 1
            finally:
                Path(nc_path).unlink(missing_ok=True)

        current += timedelta(days=1)

    await close_db()
    print(f"\nDone: {total_success} success, {total_fail} failed")


if __name__ == "__main__":
    start = sys.argv[1] if len(sys.argv) > 1 else "2026-04-01"
    end = sys.argv[2] if len(sys.argv) > 2 else "2026-04-06"
    print(f"Backfilling satellite GHI (24h): {start} to {end}")
    asyncio.run(backfill(start, end))
