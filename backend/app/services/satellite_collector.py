"""SatelliteCollector: 每 10 分钟从 JAXA P-Tree 下载向日葵-9 SWR 数据

数据链路:
  FTP 下载 → NetCDF 解析 → 51 网格 GHI 提取 → DB 写入 → 临时文件删除
"""

import asyncio
import ftplib
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from loguru import logger

from app.core.constants import SHANGHAI_TZ
from app.core.database import get_pool

# P-Tree FTP credentials
FTP_HOST = "ftp.ptree.jaxa.jp"
FTP_USER = "linekerzhu_gmail.com"
FTP_PASS = "SP+wari8"

# SWR → GHI correction factor (SWR covers 0.2-4.0μm, GHI is 0.3-2.8μm)
GHI_CORRECTION = 0.98

# 51 hex grid cell centers (from frontend ghi-grid.ts)
# Loaded once at module level
GRID_CELLS: list[tuple[str, float, float]] = []  # [(id, lat, lon), ...]


def _load_grid_cells():
    """Load grid cell definitions. Called once at startup."""
    global GRID_CELLS
    if GRID_CELLS:
        return

    # Inline definition matching frontend/src/data/ghi-grid.ts
    # This avoids cross-language file parsing
    import json
    grid_file = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "data" / "ghi-grid.ts"
    if grid_file.exists():
        import re
        content = grid_file.read_text()
        for m in re.finditer(r'id: "([^"]+)".*?lat: ([\d.]+).*?lon: ([\d.]+)', content):
            GRID_CELLS.append((m.group(1), float(m.group(2)), float(m.group(3))))
        logger.info(f"Loaded {len(GRID_CELLS)} grid cells from {grid_file}")
    else:
        logger.warning(f"Grid file not found: {grid_file}, using hardcoded fallback")
        # Fallback: just use district center
        GRID_CELLS.append(("H-center", 30.82, 121.20))


class SatelliteCollector:
    """Downloads Himawari-9 SWR data and writes GHI to satellite_ghi table."""

    def __init__(self):
        _load_grid_cells()
        self._pixel_map: dict[str, tuple[int, int]] | None = None

    def _latest_available_time(self) -> datetime:
        """Calculate the most recent file likely available on FTP.
        Data delay is ~15-20 minutes from observation to FTP upload.
        """
        now_utc = datetime.now(timezone.utc)
        available = now_utc - timedelta(minutes=20)
        minute = (available.minute // 10) * 10
        return available.replace(minute=minute, second=0, microsecond=0)

    def _ftp_path(self, t: datetime) -> tuple[str, str]:
        """Build FTP directory and filename for a given UTC time."""
        directory = f"/pub/himawari/L2/PAR/021/{t.strftime('%Y%m')}/{t.strftime('%d')}/{t.strftime('%H')}/"
        filename = f"H09_{t.strftime('%Y%m%d')}_{t.strftime('%H')}{t.minute:02d}_RFL021_FLDK.02801_02401.nc"
        return directory, filename

    def _ftp_download(self, target_time: datetime) -> str | None:
        """Download SWR NetCDF file from FTP. Returns temp file path or None."""
        directory, filename = self._ftp_path(target_time)

        for attempt in range(3):
            try:
                ftp = ftplib.FTP(FTP_HOST, timeout=30)
                ftp.login(FTP_USER, FTP_PASS)
                ftp.cwd(directory)

                # Check file exists
                files = ftp.nlst()
                if filename not in files:
                    logger.warning(f"File not yet available: {filename}")
                    ftp.quit()
                    return None

                # Download to temp file
                tmp = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
                with open(tmp.name, "wb") as f:
                    ftp.retrbinary(f"RETR {filename}", f.write)
                ftp.quit()

                size_mb = Path(tmp.name).stat().st_size / 1024 / 1024
                logger.info(f"Downloaded {filename} ({size_mb:.1f} MB) attempt {attempt+1}")
                return tmp.name

            except Exception as e:
                logger.warning(f"FTP download attempt {attempt+1} failed: {e}")
                if attempt < 2:
                    import time
                    time.sleep(3)

        logger.error(f"FTP download failed after 3 attempts: {filename}")
        return None

    def _build_pixel_map(self, lat: np.ndarray, lon: np.ndarray):
        """Pre-compute grid_id → nearest satellite pixel index mapping."""
        self._pixel_map = {}
        for grid_id, glat, glon in GRID_CELLS:
            lat_idx = int(np.argmin(np.abs(lat - glat)))
            lon_idx = int(np.argmin(np.abs(lon - glon)))
            self._pixel_map[grid_id] = (lat_idx, lon_idx)

        unique = len(set(self._pixel_map.values()))
        logger.info(f"Pixel map: {len(self._pixel_map)} grids → {unique} unique pixels")

    def _extract_grid_swr(self, nc_path: str, obs_time: datetime) -> list[dict]:
        """Extract SWR values for all grid cells from NetCDF file."""
        from netCDF4 import Dataset

        ds = Dataset(nc_path)
        lat = ds.variables["latitude"][:]
        lon = ds.variables["longitude"][:]
        swr_var = ds.variables["SWR"]
        qa_var = ds.variables["QA_flag"]

        # Build pixel map on first call (lat/lon grid is always the same)
        if self._pixel_map is None:
            self._build_pixel_map(lat, lon)

        obs_time_shanghai = obs_time.replace(tzinfo=timezone.utc).astimezone(SHANGHAI_TZ)

        results = []
        for grid_id, (lat_idx, lon_idx) in self._pixel_map.items():
            swr_raw = swr_var[lat_idx, lon_idx]
            qa_raw = qa_var[lat_idx, lon_idx]

            # Handle masked values
            if np.ma.is_masked(swr_raw):
                swr_val = 0.0
                qa_val = 255  # mark as invalid
            else:
                swr_val = float(swr_raw)
                qa_val = int(qa_raw) if not np.ma.is_masked(qa_raw) else 0

            ghi_val = swr_val * GHI_CORRECTION

            # is_valid: bit6 (sat zenith >70°) and bit7 (solar zenith >67°) must be 0
            is_valid = not (qa_val & 0b11000000)

            # Self-check: GHI should not exceed ~1200 W/m² (theoretical max)
            if ghi_val > 1200:
                logger.warning(f"Anomalous GHI {ghi_val:.0f} at {grid_id}, marking invalid")
                is_valid = False

            results.append({
                "grid_id": grid_id,
                "obs_time": obs_time,
                "swr": round(swr_val, 1),
                "ghi": round(ghi_val, 1),
                "qa_flag": qa_val,
                "is_valid": is_valid,
            })

        ds.close()
        return results

    async def _save_to_db(self, grid_data: list[dict]) -> int:
        """UPSERT grid data to satellite_ghi table."""
        pool = get_pool()
        rows = [
            (d["grid_id"], d["obs_time"], d["swr"], d["ghi"], d["qa_flag"], d["is_valid"])
            for d in grid_data
        ]

        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO satellite_ghi (grid_id, obs_time, swr, ghi, qa_flag, is_valid)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (grid_id, obs_time) DO UPDATE SET
                    swr = EXCLUDED.swr,
                    ghi = EXCLUDED.ghi,
                    qa_flag = EXCLUDED.qa_flag,
                    is_valid = EXCLUDED.is_valid,
                    created_at = NOW()
                """,
                rows,
            )

        valid_count = sum(1 for d in grid_data if d["is_valid"] and d["ghi"] > 0)
        return len(rows), valid_count

    async def collect(self) -> int:
        """Main entry point: download → parse → store. Returns rows written."""
        target_time = self._latest_available_time()
        logger.info(f"Satellite collect: target {target_time.strftime('%Y-%m-%d %H:%M')} UTC")

        # Download in thread pool (blocking FTP)
        nc_path = await asyncio.to_thread(self._ftp_download, target_time)
        if nc_path is None:
            return 0

        try:
            # Extract grid SWR
            grid_data = self._extract_grid_swr(nc_path, target_time)

            # Save to DB
            total, valid = await self._save_to_db(grid_data)

            # Log summary
            ghis = [d["ghi"] for d in grid_data if d["is_valid"] and d["ghi"] > 0]
            if ghis:
                logger.info(
                    f"Satellite: {total} grids, {valid} valid, "
                    f"GHI avg={sum(ghis)/len(ghis):.0f} max={max(ghis):.0f} W/m²"
                )
            else:
                logger.info(f"Satellite: {total} grids, {valid} valid (night or all cloudy)")

            return total

        finally:
            # Always clean up temp file
            Path(nc_path).unlink(missing_ok=True)
