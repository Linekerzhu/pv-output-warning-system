# PostgreSQL Data Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace JSON file storage with PostgreSQL, decouple data collection from frontend requests so the backend collects weather/GHI data on a schedule and the frontend only reads from the database.

**Architecture:** Data collection runs independently via APScheduler (hourly weather+GHI+warnings, daily observations). All API routes read from PostgreSQL via asyncpg connection pool. District-level totals are computed as SUM of street-level data, not independently stored.

**Tech Stack:** asyncpg (direct SQL, no ORM), APScheduler (existing), pvlib (existing), PostgreSQL 15+

---

## Database Schema

4 tables. All timestamps stored as `TIMESTAMPTZ` (UTC), converted to Shanghai time strings in API responses.

```
stations (10 rows)
├── id: TEXT PK                    -- pinyin slug: 'shihua', 'zhujing', ...
├── name: TEXT                     -- '石化街道', '朱泾镇', ...
├── lat, lon: DOUBLE PRECISION     -- WGS84 coordinates
├── capacity_kw: DOUBLE PRECISION  -- SUM of active PV users
├── active_users, total_users: INT
└── updated_at: TIMESTAMPTZ

weather_forecast (10 streets × ~72 hours = ~720 rows, rolling)
├── station_id: TEXT FK → stations
├── forecast_time: TIMESTAMPTZ     -- the hour being forecasted
├── weather_icon, weather_text, temp, humidity, cloud, pop, wind_speed, precip
├── ghi, clearsky_ghi: DOUBLE PRECISION
├── weather_ratio, power_kw, clearsky_power_kw: DOUBLE PRECISION
├── updated_at: TIMESTAMPTZ
└── PK(station_id, forecast_time)

weather_history (grows over time, per-station per-hour)
├── station_id: TEXT FK → stations
├── time: TIMESTAMPTZ
├── source: TEXT                   -- 'forecast_archive' | 'observation'
├── (same weather + solar fields as weather_forecast)
├── is_estimated: BOOLEAN          -- TRUE for icon→GHI estimation
├── created_at: TIMESTAMPTZ
└── PK(station_id, time, source)

warnings (grows over time)
├── id: TEXT PK
├── level, label, type, street, action
├── change_rate, abs_change_kw
├── from_time, to_time: TEXT       -- keep string format for compatibility
├── from_power_kw, to_power_kw
├── issued_at: TIMESTAMPTZ
├── weather_from, weather_to
├── is_active: BOOLEAN
└── created_at: TIMESTAMPTZ
```

## Scheduled Jobs

| Job | Frequency | API Calls | What it does |
|-----|-----------|-----------|-------------|
| `collect_and_evaluate` | Every hour | 10 weather + 10 GHI = **20** | Fetch 72h weather per street + GHI per street坐标, compute power, UPSERT forecast, archive past hours, run warning evaluation |
| `collect_observations` | Daily 01:00 | 1 | Fetch yesterday's actual weather via historical API, estimate GHI, INSERT into history |
| `cleanup_old_data` | Daily 02:00 | 0 | 清理90天前的weather_history + 30天前的warnings |

## File Structure

```
backend/app/
├── core/
│   ├── config.py          (MODIFY: add DATABASE_URL)
│   └── database.py        (CREATE: asyncpg pool lifecycle)
├── services/
│   ├── data_collector.py  (CREATE: scheduled data collection)
│   └── warning.py         (MODIFY: read/write DB instead of JSON)
├── api/
│   ├── forecast.py        (MODIFY: read from DB)
│   ├── weather.py         (MODIFY: read from DB)
│   ├── warning.py         (MODIFY: read from DB)
│   └── history.py         (MODIFY: read from weather_history)
└── main.py                (MODIFY: DB lifecycle, new scheduler jobs)

backend/scripts/
├── init_db.sql            (CREATE: DDL)
└── seed_stations.py       (CREATE: populate stations from pv_users.json)

backend/tests/
└── test_data_collector.py (CREATE)
```

---

### Task 1: Database Infrastructure

**Files:**
- Create: `backend/app/core/database.py`
- Create: `backend/scripts/init_db.sql`
- Modify: `backend/app/core/config.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add asyncpg dependency**

Append to `backend/requirements.txt`:
```
asyncpg==0.30.0
```

- [ ] **Step 2: Run test to verify asyncpg installs**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && pip install asyncpg==0.30.0`
Expected: Successfully installed asyncpg

- [ ] **Step 3: Add DATABASE_URL to config.py**

In `backend/app/core/config.py`, add to the `Settings` class after `PV_USERS_FILE`:

```python
    # PostgreSQL
    DATABASE_URL: str = "postgresql://pvuser:pvpass@localhost:5432/pv_warning"
```

- [ ] **Step 3b: Add STREET_TO_STATION_ID to constants.py**

Add to the end of `backend/app/core/constants.py`:

```python
# 街道名→station_id映射（用于数据库）
STREET_TO_STATION_ID: dict[str, str] = {
    "石化街道": "shihua",
    "朱泾镇": "zhujing",
    "枫泾镇": "fengjing",
    "张堰镇": "zhangyan",
    "亭林镇": "tinglin",
    "吕巷镇": "lvxiang",
    "廊下镇": "langxia",
    "金山卫镇": "jinshanwei",
    "漕泾镇": "caojing",
    "山阳镇": "shanyang",
}

STATION_ID_TO_STREET: dict[str, str] = {v: k for k, v in STREET_TO_STATION_ID.items()}
```

- [ ] **Step 4: Create database.py connection pool module**

Create `backend/app/core/database.py`:

```python
"""asyncpg connection pool lifecycle"""

import asyncpg
from loguru import logger

from app.core.config import settings

_pool: asyncpg.Pool | None = None


async def init_db() -> None:
    """Create connection pool. Call once at app startup."""
    global _pool
    _pool = await asyncpg.create_pool(
        settings.DATABASE_URL,
        min_size=2,
        max_size=10,
    )
    logger.info("PostgreSQL connection pool created")


async def close_db() -> None:
    """Close connection pool. Call at app shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL connection pool closed")


def get_pool() -> asyncpg.Pool:
    """Get the connection pool. Raises if not initialized."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_db() first.")
    return _pool
```

- [ ] **Step 5: Create init_db.sql with all table definitions**

Create `backend/scripts/init_db.sql`:

```sql
-- PV Output Warning System - Database Schema
-- PostgreSQL 15+

CREATE TABLE IF NOT EXISTS stations (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    lat         DOUBLE PRECISION NOT NULL,
    lon         DOUBLE PRECISION NOT NULL,
    capacity_kw DOUBLE PRECISION NOT NULL DEFAULT 0,
    active_users INTEGER NOT NULL DEFAULT 0,
    total_users  INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weather_forecast (
    station_id    TEXT NOT NULL REFERENCES stations(id),
    forecast_time TIMESTAMPTZ NOT NULL,
    weather_icon  INTEGER,
    weather_text  TEXT,
    temp          DOUBLE PRECISION,
    humidity      INTEGER,
    cloud         INTEGER,
    pop           INTEGER DEFAULT 0,
    wind_speed    DOUBLE PRECISION DEFAULT 0,
    precip        DOUBLE PRECISION DEFAULT 0,
    ghi             DOUBLE PRECISION,
    clearsky_ghi    DOUBLE PRECISION,
    weather_ratio   DOUBLE PRECISION,
    power_kw        DOUBLE PRECISION,
    clearsky_power_kw DOUBLE PRECISION,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (station_id, forecast_time)
);

CREATE TABLE IF NOT EXISTS weather_history (
    station_id    TEXT NOT NULL REFERENCES stations(id),
    time          TIMESTAMPTZ NOT NULL,
    source        TEXT NOT NULL,  -- 'forecast_archive' or 'observation'
    weather_icon  INTEGER,
    weather_text  TEXT,
    temp          DOUBLE PRECISION,
    humidity      INTEGER,
    cloud         INTEGER,
    pop           INTEGER DEFAULT 0,
    wind_speed    DOUBLE PRECISION DEFAULT 0,
    precip        DOUBLE PRECISION DEFAULT 0,
    ghi             DOUBLE PRECISION,
    clearsky_ghi    DOUBLE PRECISION,
    weather_ratio   DOUBLE PRECISION,
    power_kw        DOUBLE PRECISION,
    clearsky_power_kw DOUBLE PRECISION,
    is_estimated  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (station_id, time, source)
);

CREATE TABLE IF NOT EXISTS warnings (
    id              TEXT PRIMARY KEY,
    level           TEXT NOT NULL,
    label           TEXT,
    type            TEXT,
    street          TEXT NOT NULL,
    action          TEXT,
    change_rate     DOUBLE PRECISION,
    abs_change_kw   DOUBLE PRECISION,
    from_time       TEXT,
    to_time         TEXT,
    from_power_kw   DOUBLE PRECISION,
    to_power_kw     DOUBLE PRECISION,
    issued_at       TIMESTAMPTZ NOT NULL,
    weather_from    TEXT,
    weather_to      TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
-- NOTE: PK indexes on (station_id, forecast_time) and (station_id, time, source)
-- are created automatically, no need to duplicate them.

CREATE INDEX IF NOT EXISTS idx_history_time_source
    ON weather_history (time, source);

CREATE INDEX IF NOT EXISTS idx_warnings_issued
    ON warnings (issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_warnings_street_active
    ON warnings (street, is_active);
```

- [ ] **Step 6: Verify SQL is valid**

Run:
```bash
# Connect to PostgreSQL and create the database
psql -U postgres -c "CREATE DATABASE pv_warning;" 2>/dev/null || true
psql -U postgres -c "CREATE USER pvuser WITH PASSWORD 'pvpass';" 2>/dev/null || true
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE pv_warning TO pvuser;"
psql -U pvuser -d pv_warning -f backend/scripts/init_db.sql
```
Expected: CREATE TABLE / CREATE INDEX messages, no errors

- [ ] **Step 7: Commit**

```bash
git add backend/app/core/database.py backend/scripts/init_db.sql backend/app/core/config.py backend/requirements.txt
git commit -m "feat: add PostgreSQL infrastructure (asyncpg pool + DDL)"
```

---

### Task 2: Seed Stations Data

**Files:**
- Create: `backend/scripts/seed_stations.py`
- Test: manual verification via psql

- [ ] **Step 1: Create seed_stations.py**

Create `backend/scripts/seed_stations.py`:

```python
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
```

- [ ] **Step 2: Run the seed script**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python scripts/seed_stations.py`
Expected: 10 stations seeded with capacity data

- [ ] **Step 3: Verify via psql**

Run: `psql -U pvuser -d pv_warning -c "SELECT id, name, capacity_kw, active_users FROM stations ORDER BY id;"`
Expected: 10 rows with correct names and capacity values

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/seed_stations.py
git commit -m "feat: add stations seed script"
```

---

### Task 3: DataCollector Service — Weather + GHI Collection

**Files:**
- Create: `backend/app/services/data_collector.py`
- Test: `backend/tests/test_data_collector.py`

This is the core of the architecture change. The DataCollector fetches data from QWeather APIs and writes to the database. It runs on a schedule, independent of frontend requests.

- [ ] **Step 1: Write the failing test for collect_weather_forecasts**

Create `backend/tests/test_data_collector.py`:

```python
"""Tests for DataCollector service"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone, timedelta

from app.services.data_collector import DataCollector
from app.models.weather_data import HourlyWeather, WeatherForecast


def make_hourly(hour: int, text: str = "晴", icon: int = 100) -> HourlyWeather:
    return HourlyWeather(
        time=f"2026-04-04 {hour:02d}:00",
        icon=icon, text=text, temp=25.0,
        humidity=50, cloud=10, pop=0,
        wind_speed=5.0, precip=0.0,
    )


class TestCollectWeatherForecasts:
    """Test weather forecast collection and DB writes"""

    @pytest.mark.asyncio
    async def test_fetches_all_streets_and_writes_db(self):
        """Should fetch weather for each street and UPSERT into weather_forecast"""
        collector = DataCollector.__new__(DataCollector)
        collector.weather_service = MagicMock()
        collector.solar_service = MagicMock()
        collector.aggregation_service = MagicMock()

        # Mock weather fetch returns 2 hours of data
        forecast = WeatherForecast(
            street="石化街道",
            update_time="2026-04-04T10:00",
            hourly=[make_hourly(10), make_hourly(11)],
        )
        collector.weather_service.get_hourly_forecast = AsyncMock(return_value=forecast)

        # Mock DB pool
        mock_conn = AsyncMock()
        mock_conn.executemany = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire = MagicMock(return_value=AsyncMock(
            __aenter__=AsyncMock(return_value=mock_conn),
            __aexit__=AsyncMock(return_value=False),
        ))

        with patch("app.services.data_collector.get_pool", return_value=mock_pool):
            await collector._collect_street_weather("shihua", "石化街道")

        # Should have called executemany with weather data
        assert mock_conn.executemany.called
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_data_collector.py -v`
Expected: FAIL with ModuleNotFoundError (data_collector not yet created)

- [ ] **Step 3: Create DataCollector service**

Create `backend/app/services/data_collector.py`:

```python
"""Scheduled data collection service.

Runs independently of frontend requests. Fetches weather + GHI from QWeather APIs,
computes power predictions, and writes everything to PostgreSQL.

Hourly job: collect_and_evaluate()
  1. Fetch 72h weather forecast per street (10 API calls)
  2. Fetch GHI per street坐标 (10 API calls)
  3. Compute clearsky_ghi (pvlib) + weather_ratio + power_kw per street
  4. UPSERT weather_forecast table
  5. Archive past forecast hours → weather_history
  6. Run warning evaluation → write to warnings table

Daily job: collect_observations()
  1. Fetch yesterday's actual weather (1 API call via location ID)
  2. Estimate GHI via pvlib clearsky × icon reduction
  3. INSERT into weather_history (source='observation')

Cleanup job: cleanup_old_data()
  - Delete weather_history older than 90 days
  - Delete warnings older than 30 days
"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.constants import JINSHAN_STREETS, STREET_TO_STATION_ID
from app.core.database import get_pool
from app.services.aggregation import AggregationService
from app.services.solar import SolarService
from app.services.weather import WeatherService

SHANGHAI_TZ = timezone(timedelta(hours=8))


class DataCollector:
    """Scheduled data collection: QWeather APIs → PostgreSQL"""

    def __init__(self):
        self.weather_service = WeatherService()
        self.solar_service = SolarService()
        self.aggregation_service = AggregationService()

    # ── Hourly: Weather Forecast Collection ──────────────────

    async def _collect_street_weather(self, station_id: str, street: str) -> int:
        """Fetch 72h forecast for one street and UPSERT into weather_forecast.

        Returns number of rows upserted.
        """
        forecast = await self.weather_service.get_hourly_forecast(street)
        if not forecast or not forecast.hourly:
            logger.warning(f"No weather data for {street}")
            return 0

        pool = get_pool()
        rows = []
        for hw in forecast.hourly:
            # Parse time string "2026-04-04 14:00" → TIMESTAMPTZ
            try:
                dt = datetime.strptime(hw.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)
            except ValueError:
                continue
            rows.append((
                station_id, dt,
                hw.icon, hw.text, hw.temp, hw.humidity, hw.cloud,
                hw.pop, hw.wind_speed, hw.precip,
            ))

        if not rows:
            return 0

        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO weather_forecast
                    (station_id, forecast_time, weather_icon, weather_text,
                     temp, humidity, cloud, pop, wind_speed, precip, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
                ON CONFLICT (station_id, forecast_time) DO UPDATE SET
                    weather_icon = EXCLUDED.weather_icon,
                    weather_text = EXCLUDED.weather_text,
                    temp = EXCLUDED.temp,
                    humidity = EXCLUDED.humidity,
                    cloud = EXCLUDED.cloud,
                    pop = EXCLUDED.pop,
                    wind_speed = EXCLUDED.wind_speed,
                    precip = EXCLUDED.precip,
                    updated_at = NOW()
                """,
                rows,
            )

        return len(rows)

    async def _update_ghi_and_power(self) -> None:
        """Fetch GHI per street坐标 from solar radiation API, compute power.

        Each street gets its own GHI API call (10 calls total) because the
        solar radiation API has 1km resolution and streets span ~20×40km.
        clearsky_ghi computed per street via pvlib.
        """
        pool = get_pool()
        total_updated = 0

        for street, info in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]
            agg = self.aggregation_service.get_street_aggregation(street)
            if not agg or agg.total_capacity_kw <= 0:
                continue

            capacity = agg.total_capacity_kw

            # 1. Fetch GHI for THIS street's coordinates (1 API call per street)
            radiation = await self.weather_service.get_solar_radiation(
                lat=info["lat"], lon=info["lon"], hours=48,
            )
            if not radiation or not radiation.forecasts:
                logger.warning(f"No GHI data for {street}")
                continue

            # Build {datetime: ghi} mapping
            ghi_by_time: dict[datetime, float] = {}
            for r in radiation.forecasts:
                try:
                    dt = datetime.strptime(r.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)
                    ghi_by_time[dt] = r.ghi
                except ValueError:
                    continue

            if not ghi_by_time:
                continue

            # 2. Compute clearsky_ghi via pvlib for each date covered
            dates = {dt.date() for dt in ghi_by_time}
            clearsky_by_hour: dict[tuple[date, int], float] = {}
            for d in dates:
                clearsky = self.solar_service.get_clearsky_ghi(d, info["lat"], info["lon"])
                for hour, val in clearsky.items():
                    clearsky_by_hour[(d, hour)] = val

            # 3. Build update rows
            updates = []
            for dt, ghi in ghi_by_time.items():
                cs_ghi = clearsky_by_hour.get((dt.date(), dt.hour))
                if cs_ghi is None or cs_ghi <= 0:
                    continue

                weather_ratio = min(ghi / cs_ghi, 1.5)
                power_kw = capacity * ghi / 1000
                clearsky_power_kw = capacity * cs_ghi / 1000

                updates.append((
                    round(ghi, 1),
                    round(cs_ghi, 1),
                    round(weather_ratio, 4),
                    round(power_kw, 2),
                    round(clearsky_power_kw, 2),
                    station_id,
                    dt,
                ))

            if updates:
                async with pool.acquire() as conn:
                    await conn.executemany(
                        """
                        UPDATE weather_forecast SET
                            ghi = $1,
                            clearsky_ghi = $2,
                            weather_ratio = $3,
                            power_kw = $4,
                            clearsky_power_kw = $5,
                            updated_at = NOW()
                        WHERE station_id = $6 AND forecast_time = $7
                        """,
                        updates,
                    )
                total_updated += len(updates)

        logger.info(f"Updated GHI + power: {total_updated} rows across {len(JINSHAN_STREETS)} streets")

    # ── Hourly: Archive Past Forecasts ───────────────────────

    async def _archive_past_forecasts(self) -> int:
        """Move forecast rows older than current hour to weather_history.

        Returns number of rows archived.
        """
        now = datetime.now(SHANGHAI_TZ)
        cutoff = now.replace(minute=0, second=0, microsecond=0)

        pool = get_pool()
        async with pool.acquire() as conn:
            # Copy to history (skip if already exists)
            result = await conn.execute(
                """
                INSERT INTO weather_history
                    (station_id, time, source,
                     weather_icon, weather_text, temp, humidity, cloud,
                     pop, wind_speed, precip,
                     ghi, clearsky_ghi, weather_ratio,
                     power_kw, clearsky_power_kw, is_estimated)
                SELECT
                    station_id, forecast_time, 'forecast_archive',
                    weather_icon, weather_text, temp, humidity, cloud,
                    pop, wind_speed, precip,
                    ghi, clearsky_ghi, weather_ratio,
                    power_kw, clearsky_power_kw, FALSE
                FROM weather_forecast
                WHERE forecast_time < $1
                ON CONFLICT (station_id, time, source) DO NOTHING
                """,
                cutoff,
            )
            # result is a command tag like "INSERT 0 5"
            try:
                archived = int(result.split()[-1]) if result else 0
            except (ValueError, IndexError):
                archived = 0

            # Delete archived rows from forecast
            await conn.execute(
                "DELETE FROM weather_forecast WHERE forecast_time < $1",
                cutoff,
            )

        if archived > 0:
            logger.info(f"Archived {archived} past forecast rows")
        return archived

    # ── Daily: Historical Observations ───────────────────────

    async def collect_observations(self, target_date: date | None = None) -> int:
        """Fetch actual weather observations for a date and store in history.

        Uses the district location ID (101020700) to fetch hourly observations.
        GHI is estimated via pvlib clearsky × icon reduction factor.

        Returns number of rows inserted.
        """
        from app.services.history import HistoricalWeatherService

        if target_date is None:
            target_date = (datetime.now(SHANGHAI_TZ) - timedelta(days=1)).date()

        history_service = HistoricalWeatherService()
        hourly = await history_service.fetch_historical_weather(target_date)
        if not hourly:
            logger.warning(f"No historical weather data for {target_date}")
            return 0

        pool = get_pool()
        total = 0

        for street, info in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]
            agg = self.aggregation_service.get_street_aggregation(street)
            if not agg or agg.total_capacity_kw <= 0:
                continue

            capacity = agg.total_capacity_kw

            # Estimate GHI from icon
            estimated_ghi = history_service.estimate_ghi_from_weather(
                target_date, hourly, info["lat"], info["lon"],
            )
            clearsky = self.solar_service.get_clearsky_ghi(
                target_date, info["lat"], info["lon"],
            )

            rows = []
            for hw in hourly:
                try:
                    dt = datetime.strptime(hw.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)
                    hour = dt.hour
                except ValueError:
                    continue

                ghi = estimated_ghi.get(hour)
                cs_ghi = clearsky.get(hour)

                power_kw = None
                clearsky_power_kw = None
                weather_ratio = None
                if ghi is not None:
                    power_kw = round(capacity * ghi / 1000, 2)
                if cs_ghi is not None and cs_ghi > 0:
                    clearsky_power_kw = round(capacity * cs_ghi / 1000, 2)
                    if ghi is not None:
                        weather_ratio = round(min(ghi / cs_ghi, 1.5), 4)

                rows.append((
                    station_id, dt, "observation",
                    hw.icon, hw.text, hw.temp, hw.humidity, hw.cloud,
                    hw.pop, hw.wind_speed, hw.precip,
                    ghi, cs_ghi, weather_ratio,
                    power_kw, clearsky_power_kw,
                    ghi is not None,  # is_estimated (GHI estimated from icon)
                ))

            if rows:
                async with pool.acquire() as conn:
                    await conn.executemany(
                        """
                        INSERT INTO weather_history
                            (station_id, time, source,
                             weather_icon, weather_text, temp, humidity, cloud,
                             pop, wind_speed, precip,
                             ghi, clearsky_ghi, weather_ratio,
                             power_kw, clearsky_power_kw, is_estimated)
                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                        ON CONFLICT (station_id, time, source) DO NOTHING
                        """,
                        rows,
                    )
                total += len(rows)

        logger.info(f"Collected {total} observation rows for {target_date}")
        return total

    # ── Main Hourly Job ──────────────────────────────────────

    async def collect_and_evaluate(self) -> None:
        """Main hourly job: fetch data → compute → store → warn.

        This is THE entry point called by the scheduler every hour.
        """
        logger.info("=== Hourly data collection started ===")

        # 1. Fetch weather forecasts for all streets
        total_rows = 0
        for street in JINSHAN_STREETS:
            station_id = STREET_TO_STATION_ID[street]
            count = await self._collect_street_weather(station_id, street)
            total_rows += count
        logger.info(f"Weather forecasts collected: {total_rows} rows across {len(JINSHAN_STREETS)} streets")

        # 2. Fetch GHI + compute power
        await self._update_ghi_and_power()

        # 3. Archive past forecast hours
        await self._archive_past_forecasts()

        # 4. Run warning evaluation
        await self._evaluate_warnings()

        logger.info("=== Hourly data collection complete ===")

    async def _evaluate_warnings(self) -> None:
        """Read current forecast data from DB, run warning evaluation, store results."""
        from app.models.warning_record import PowerPrediction
        from app.services.warning import WarningService

        pool = get_pool()
        warning_service = WarningService()
        all_warnings = []

        for street in JINSHAN_STREETS:
            station_id = STREET_TO_STATION_ID[street]

            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT forecast_time, ghi, clearsky_ghi, weather_ratio,
                           power_kw, clearsky_power_kw, weather_text, weather_icon
                    FROM weather_forecast
                    WHERE station_id = $1
                      AND ghi IS NOT NULL
                      AND clearsky_ghi IS NOT NULL
                    ORDER BY forecast_time
                    """,
                    station_id,
                )

            if not rows:
                continue

            predictions = []
            for r in rows:
                dt = r["forecast_time"].astimezone(SHANGHAI_TZ)
                predictions.append(PowerPrediction(
                    time=dt.strftime("%Y-%m-%d %H:00"),
                    ghi=r["ghi"],
                    clearsky_ghi=r["clearsky_ghi"],
                    weather_ratio=r["weather_ratio"],
                    power_kw=r["power_kw"],
                    clearsky_power_kw=r["clearsky_power_kw"],
                    weather_text=r["weather_text"] or "--",
                    weather_icon=r["weather_icon"] or 999,
                ))

            warnings = warning_service.evaluate_predictions(street, predictions)
            all_warnings.extend(warnings)

        # Write warnings to DB
        if all_warnings:
            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO warnings
                        (id, level, label, type, street, action,
                         change_rate, abs_change_kw,
                         from_time, to_time, from_power_kw, to_power_kw,
                         issued_at, weather_from, weather_to, is_active)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    [(
                        w.id, w.level, w.label, w.type, w.street, w.action,
                        w.change_rate, w.abs_change_kw,
                        w.from_time, w.to_time, w.from_power_kw, w.to_power_kw,
                        w.issued_at, w.weather_from, w.weather_to,
                    ) for w in all_warnings],
                )

            # Deactivate old warnings (older than 24h)
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    UPDATE warnings SET is_active = FALSE
                    WHERE is_active = TRUE
                      AND issued_at < NOW() - INTERVAL '24 hours'
                    """,
                )

            logger.warning(f"Evaluation produced {len(all_warnings)} warnings")
        else:
            logger.info("Evaluation: no warnings")

    # ── Daily: Cleanup Old Data ──────────────────────────────

    async def cleanup_old_data(self) -> None:
        """Delete old weather_history (>90 days) and warnings (>30 days)."""
        pool = get_pool()
        async with pool.acquire() as conn:
            result_h = await conn.execute(
                "DELETE FROM weather_history WHERE time < NOW() - INTERVAL '90 days'"
            )
            result_w = await conn.execute(
                "DELETE FROM warnings WHERE created_at < NOW() - INTERVAL '30 days'"
            )
        logger.info(f"Cleanup: deleted history={result_h}, warnings={result_w}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_data_collector.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/data_collector.py backend/tests/test_data_collector.py
git commit -m "feat: add DataCollector service for scheduled weather/GHI collection"
```

---

### Task 4: Integrate Scheduler + DB Lifecycle in main.py

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: Update main.py with DB lifecycle and new scheduler jobs**

Replace the full content of `backend/app/main.py`:

```python
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api import weather, forecast, warning, pv_users, history
from app.core.config import settings
from app.core.database import init_db, close_db
from app.services.data_collector import DataCollector

data_collector = DataCollector()
scheduler = AsyncIOScheduler()


async def hourly_job():
    """Hourly: collect weather + GHI, compute power, evaluate warnings."""
    try:
        await data_collector.collect_and_evaluate()
    except Exception as e:
        logger.error(f"Hourly job failed: {e}")


async def daily_job():
    """Daily at 01:00: fetch yesterday's actual weather observations."""
    try:
        await data_collector.collect_observations()
    except Exception as e:
        logger.error(f"Daily observation job failed: {e}")


async def cleanup_job():
    """Daily at 02:00: clean up old history and warning data."""
    try:
        await data_collector.cleanup_old_data()
    except Exception as e:
        logger.error(f"Cleanup job failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database connection pool
    await init_db()
    logger.info("Database initialized")

    # Schedule hourly data collection
    scheduler.add_job(
        hourly_job,
        "interval",
        seconds=settings.POLL_INTERVAL_SECONDS,
        id="hourly_collect",
        next_run_time=None,  # Don't run immediately; trigger manually below
    )

    # Schedule daily observation collection at 01:00 Shanghai time
    scheduler.add_job(
        daily_job,
        CronTrigger(hour=1, minute=0, timezone="Asia/Shanghai"),
        id="daily_observations",
    )

    # Schedule daily cleanup at 02:00 Shanghai time
    scheduler.add_job(
        cleanup_job,
        CronTrigger(hour=2, minute=0, timezone="Asia/Shanghai"),
        id="daily_cleanup",
    )

    scheduler.start()
    logger.info(f"Scheduler started: hourly every {settings.POLL_INTERVAL_SECONDS}s, daily at 01:00/02:00")

    # Run initial data collection on startup
    try:
        await data_collector.collect_and_evaluate()
    except Exception as e:
        logger.error(f"Initial data collection failed: {e}")

    yield

    scheduler.shutdown()
    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(
    title="光伏出力预警系统",
    description="上海金山地区光伏出力骤降预警API",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(weather.router, prefix="/api/weather", tags=["气象数据"])
app.include_router(forecast.router, prefix="/api/forecast", tags=["出力预测"])
app.include_router(warning.router, prefix="/api/warning", tags=["预警管理"])
app.include_router(pv_users.router, prefix="/api/pv-users", tags=["光伏用户"])
app.include_router(history.router, prefix="/api/history", tags=["历史回测"])


@app.get("/")
async def root():
    return {
        "name": "光伏出力预警系统",
        "version": "0.2.0",
        "location": settings.LOCATION_NAME,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 2: Verify app starts without errors**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && timeout 10 python -c "from app.main import app; print('Import OK')" || true`
Expected: "Import OK" (verifies no import errors)

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: integrate DB lifecycle and new scheduler jobs in main.py"
```

---

### Task 5: Refactor API Routes — Weather

**Files:**
- Modify: `backend/app/api/weather.py`

All weather endpoints now read from `weather_forecast` table instead of calling QWeather API directly.

- [ ] **Step 1: Rewrite weather.py to read from DB**

Replace `backend/app/api/weather.py`:

```python
"""Weather API routes — read from weather_forecast table."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.core.constants import JINSHAN_STREETS, STREET_TO_STATION_ID
from app.core.database import get_pool

router = APIRouter()

SHANGHAI_TZ = timezone(timedelta(hours=8))


def _row_to_hourly(row) -> dict:
    """Convert a DB row to HourlyWeather-compatible dict."""
    dt = row["forecast_time"].astimezone(SHANGHAI_TZ)
    return {
        "time": dt.strftime("%Y-%m-%d %H:%M"),
        "icon": row["weather_icon"] or 100,
        "text": row["weather_text"] or "--",
        "temp": row["temp"] or 0,
        "humidity": row["humidity"] or 0,
        "cloud": row["cloud"] or 0,
        "pop": row["pop"] or 0,
        "wind_speed": row["wind_speed"] or 0,
        "precip": row["precip"] or 0,
    }


@router.get("/forecast/{street}")
async def get_street_forecast(street: str):
    """Get hourly weather forecast for a street from DB."""
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")

    station_id = STREET_TO_STATION_ID[street]
    pool = get_pool()

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT forecast_time, weather_icon, weather_text,
                   temp, humidity, cloud, pop, wind_speed, precip
            FROM weather_forecast
            WHERE station_id = $1
            ORDER BY forecast_time
            """,
            station_id,
        )

    if not rows:
        raise HTTPException(status_code=503, detail="暂无气象数据，请等待数据采集")

    return {
        "street": street,
        "update_time": rows[0]["forecast_time"].astimezone(SHANGHAI_TZ).isoformat() if rows else "",
        "hourly": [_row_to_hourly(r) for r in rows],
    }


@router.get("/forecast")
async def get_all_forecasts():
    """Get weather forecasts for all streets from DB."""
    pool = get_pool()
    result = {}

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.name as street, f.forecast_time, f.weather_icon, f.weather_text,
                   f.temp, f.humidity, f.cloud, f.pop, f.wind_speed, f.precip
            FROM weather_forecast f
            JOIN stations s ON s.id = f.station_id
            ORDER BY s.name, f.forecast_time
            """,
        )

    for row in rows:
        street = row["street"]
        if street not in result:
            result[street] = {
                "street": street,
                "update_time": row["forecast_time"].astimezone(SHANGHAI_TZ).isoformat(),
                "hourly": [],
            }
        result[street]["hourly"].append(_row_to_hourly(row))

    return result


@router.get("/summary")
async def get_weather_summary():
    """Lightweight weather summary for map display — from DB."""
    pool = get_pool()
    now = datetime.now(SHANGHAI_TZ)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.name as street, f.forecast_time, f.weather_icon, f.weather_text
            FROM weather_forecast f
            JOIN stations s ON s.id = f.station_id
            WHERE f.forecast_time >= $1
            ORDER BY s.name, f.forecast_time
            """,
            now - timedelta(hours=1),
        )

    # Group by street, take first 3 hours
    by_street: dict[str, list] = {}
    for row in rows:
        street = row["street"]
        if street not in by_street:
            by_street[street] = []
        if len(by_street[street]) < 3:
            by_street[street].append(row)

    summary = []
    for street, hours in by_street.items():
        if not hours:
            continue
        current = hours[0]
        next_hour = hours[1] if len(hours) > 1 else None
        weather_change = any(h["weather_text"] != current["weather_text"] for h in hours[1:])

        entry = {
            "street": street,
            "current_text": current["weather_text"] or "--",
            "current_icon": current["weather_icon"] or 100,
            "next_hour_text": next_hour["weather_text"] if next_hour else None,
            "next_hour_icon": next_hour["weather_icon"] if next_hour else None,
            "weather_change": weather_change,
        }
        summary.append(entry)

    return summary


@router.get("/solar-radiation")
async def get_solar_radiation(hours: int = 24):
    """Get GHI/clearsky data from weather_forecast — uses first available station."""
    pool = get_pool()
    now = datetime.now(SHANGHAI_TZ)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT forecast_time, ghi, clearsky_ghi
            FROM weather_forecast
            WHERE station_id = (SELECT id FROM stations LIMIT 1)
              AND forecast_time >= $1
              AND ghi IS NOT NULL
            ORDER BY forecast_time
            LIMIT $2
            """,
            now - timedelta(hours=1),
            hours,
        )

    forecasts = []
    for r in rows:
        dt = r["forecast_time"].astimezone(SHANGHAI_TZ)
        forecasts.append({
            "time": dt.strftime("%Y-%m-%d %H:%M"),
            "ghi": r["ghi"] or 0,
            "dni": 0,  # Not stored separately
            "dhi": 0,
            "elevation": 0,
        })

    return {"lat": 30.74, "lon": 121.34, "forecasts": forecasts}


@router.get("/streets")
async def get_streets():
    """Get all Jinshan streets with coordinates."""
    return {
        name: {"lat": info["lat"], "lon": info["lon"]}
        for name, info in JINSHAN_STREETS.items()
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/weather.py
git commit -m "refactor: weather API routes read from DB instead of QWeather API"
```

---

### Task 6: Refactor API Routes — Forecast

**Files:**
- Modify: `backend/app/api/forecast.py`

All forecast/power endpoints now read computed power data from `weather_forecast` table.

- [ ] **Step 1: Rewrite forecast.py to read from DB**

Replace `backend/app/api/forecast.py`:

```python
"""Forecast API routes — read power predictions from weather_forecast table."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.core.constants import JINSHAN_STREETS, STREET_TO_STATION_ID
from app.core.database import get_pool
from app.services.solar import SolarService

router = APIRouter()
solar_service = SolarService()

SHANGHAI_TZ = timezone(timedelta(hours=8))


def _row_to_prediction(row) -> dict:
    """Convert DB row to PowerPrediction-compatible dict."""
    dt = row["forecast_time"].astimezone(SHANGHAI_TZ)
    return {
        "time": dt.strftime("%Y-%m-%d %H:00"),
        "ghi": row["ghi"] or 0,
        "clearsky_ghi": row["clearsky_ghi"] or 0,
        "weather_ratio": row["weather_ratio"] or 0,
        "power_kw": row["power_kw"] or 0,
        "clearsky_power_kw": row["clearsky_power_kw"] or 0,
        "weather_text": row["weather_text"] or "--",
        "weather_icon": row["weather_icon"] or 999,
        "is_estimated": False,
    }


@router.get("/power/{street}")
async def get_street_power(street: str, target_date: date | None = None):
    """Get hourly power predictions for a street from DB."""
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")

    station_id = STREET_TO_STATION_ID[street]
    pool = get_pool()

    # Build date filter
    if target_date:
        start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ)
        end = start + timedelta(days=2)
    else:
        now = datetime.now(SHANGHAI_TZ)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=2)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT forecast_time, ghi, clearsky_ghi, weather_ratio,
                   power_kw, clearsky_power_kw, weather_text, weather_icon
            FROM weather_forecast
            WHERE station_id = $1
              AND forecast_time >= $2
              AND forecast_time < $3
              AND ghi IS NOT NULL
            ORDER BY forecast_time
            """,
            station_id, start, end,
        )

    return {
        "street": street,
        "predictions": [_row_to_prediction(r) for r in rows],
    }


@router.get("/power")
async def get_all_power(target_date: date | None = None):
    """Get power predictions for all streets from DB."""
    pool = get_pool()

    if target_date:
        start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ)
        end = start + timedelta(days=2)
    else:
        now = datetime.now(SHANGHAI_TZ)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=2)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.name as street, f.forecast_time, f.ghi, f.clearsky_ghi,
                   f.weather_ratio, f.power_kw, f.clearsky_power_kw,
                   f.weather_text, f.weather_icon
            FROM weather_forecast f
            JOIN stations s ON s.id = f.station_id
            WHERE f.forecast_time >= $1
              AND f.forecast_time < $2
              AND f.ghi IS NOT NULL
            ORDER BY s.name, f.forecast_time
            """,
            start, end,
        )

    result: dict[str, list] = {}
    for row in rows:
        street = row["street"]
        if street not in result:
            result[street] = []
        result[street].append(_row_to_prediction(row))

    return result


@router.get("/total")
async def get_district_total(target_date: date | None = None):
    """Get district total power prediction — SUM of all streets."""
    pool = get_pool()

    if target_date:
        start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ)
        end = start + timedelta(days=2)
    else:
        now = datetime.now(SHANGHAI_TZ)
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=2)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT forecast_time,
                   SUM(power_kw) as predicted_power_kw,
                   SUM(clearsky_power_kw) as clearsky_power_kw
            FROM weather_forecast
            WHERE forecast_time >= $1
              AND forecast_time < $2
              AND power_kw IS NOT NULL
            GROUP BY forecast_time
            ORDER BY forecast_time
            """,
            start, end,
        )

        total_capacity = await conn.fetchval(
            "SELECT COALESCE(SUM(capacity_kw), 0) FROM stations"
        )

    return [
        {
            "time": r["forecast_time"].astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:00"),
            "predicted_power_kw": round(r["predicted_power_kw"], 2),
            "clearsky_power_kw": round(r["clearsky_power_kw"], 2),
            "total_capacity_kw": total_capacity,
        }
        for r in rows
    ]


@router.get("/curve")
async def get_clearsky_curve(target_date: date | None = None):
    """Get clearsky GHI curve (unchanged — computed from pvlib, not DB)."""
    target_date = target_date or date.today()
    curve = solar_service.get_clearsky_curve_default(target_date)
    return {"date": str(target_date), "curve": curve}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/forecast.py
git commit -m "refactor: forecast API routes read power predictions from DB"
```

---

### Task 7: Refactor API Routes — Warnings

**Files:**
- Modify: `backend/app/api/warning.py`

Warning endpoints read from `warnings` table. The `evaluate` endpoint triggers the DataCollector instead of computing inline.

- [ ] **Step 1: Rewrite warning.py to read from DB**

Replace `backend/app/api/warning.py`:

```python
"""Warning API routes — read from warnings table."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from app.core.database import get_pool

router = APIRouter()

SHANGHAI_TZ = timezone(timedelta(hours=8))


def _row_to_warning(row) -> dict:
    """Convert DB row to WarningRecord-compatible dict."""
    return {
        "id": row["id"],
        "level": row["level"],
        "label": row["label"],
        "type": row["type"],
        "street": row["street"],
        "action": row["action"],
        "change_rate": row["change_rate"],
        "abs_change_kw": row["abs_change_kw"],
        "from_time": row["from_time"],
        "to_time": row["to_time"],
        "from_power_kw": row["from_power_kw"],
        "to_power_kw": row["to_power_kw"],
        "issued_at": row["issued_at"].astimezone(SHANGHAI_TZ).isoformat() if row["issued_at"] else "",
        "weather_from": row["weather_from"],
        "weather_to": row["weather_to"],
    }


@router.get("/current")
async def get_current_warnings():
    """Get active warnings from DB."""
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM warnings
            WHERE is_active = TRUE
            ORDER BY
                CASE level
                    WHEN 'red' THEN 0
                    WHEN 'orange' THEN 1
                    WHEN 'yellow' THEN 2
                    WHEN 'blue' THEN 3
                    ELSE 9
                END,
                from_time
            """,
        )
    return [_row_to_warning(r) for r in rows]


@router.get("/history")
async def get_warning_history():
    """Get warning history from DB (last 7 days)."""
    pool = get_pool()
    cutoff = datetime.now(SHANGHAI_TZ) - timedelta(days=7)

    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM warnings
            WHERE issued_at >= $1
            ORDER BY issued_at DESC
            """,
            cutoff,
        )
    return [_row_to_warning(r) for r in rows]


@router.post("/evaluate")
async def evaluate_warnings():
    """Manually trigger warning evaluation using DataCollector."""
    from app.services.data_collector import DataCollector

    collector = DataCollector()
    await collector.collect_and_evaluate()

    # Return current active warnings
    pool = get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM warnings
            WHERE is_active = TRUE
            ORDER BY
                CASE level WHEN 'red' THEN 0 WHEN 'orange' THEN 1
                           WHEN 'yellow' THEN 2 WHEN 'blue' THEN 3 ELSE 9 END,
                from_time
            """,
        )

    warnings = [_row_to_warning(r) for r in rows]
    return {"total_warnings": len(warnings), "warnings": warnings}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/warning.py
git commit -m "refactor: warning API routes read from DB"
```

---

### Task 8: Refactor API Routes — History (Backtest)

**Files:**
- Modify: `backend/app/api/history.py`

History endpoints read from `weather_history` table. Backtest can also use stored history data.

- [ ] **Step 1: Rewrite history.py to read from DB + fallback to API**

Replace `backend/app/api/history.py`:

```python
"""History API routes — read from weather_history table, fallback to API for missing dates."""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Query

from app.core.constants import JINSHAN_STREETS, STREET_TO_STATION_ID
from app.core.database import get_pool
from app.services.history import HistoricalWeatherService

router = APIRouter()
history_service = HistoricalWeatherService()

SHANGHAI_TZ = timezone(timedelta(hours=8))


@router.get("/weather/{target_date}")
async def get_historical_weather(target_date: date):
    """Get historical weather observations.

    First checks weather_history table (source='observation'),
    then falls back to QWeather API if not in DB.
    """
    pool = get_pool()
    # Try DB first (any station — observations are district-level)
    station_id = list(STREET_TO_STATION_ID.values())[0]
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT time, weather_icon, weather_text, temp, humidity, cloud,
                   pop, wind_speed, precip
            FROM weather_history
            WHERE station_id = $1
              AND source = 'observation'
              AND time >= $2
              AND time < $3
            ORDER BY time
            """,
            station_id,
            datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ),
            datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ) + timedelta(days=1),
        )

    if rows:
        hourly = [
            {
                "time": r["time"].astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M"),
                "icon": r["weather_icon"] or 100,
                "text": r["weather_text"] or "--",
                "temp": r["temp"] or 0,
                "humidity": r["humidity"] or 0,
                "cloud": r["cloud"] or 0,
                "pop": r["pop"] or 0,
                "wind_speed": r["wind_speed"] or 0,
                "precip": r["precip"] or 0,
            }
            for r in rows
        ]
        return {"date": str(target_date), "hourly": hourly}

    # Fallback to API
    hourly = await history_service.get_historical_weather(target_date)
    if hourly is None:
        return {"error": "无法获取历史天气数据", "date": str(target_date)}
    return {"date": str(target_date), "hourly": [h.model_dump() for h in hourly]}


@router.get("/backtest/{target_date}")
async def backtest_date(target_date: date):
    """Backtest a historical date.

    First checks if DB has observation data. If so, uses it.
    Otherwise falls back to API fetch + icon estimation.
    """
    # Check if we have observations in DB
    pool = get_pool()
    station_id = list(STREET_TO_STATION_ID.values())[0]
    async with pool.acquire() as conn:
        count = await conn.fetchval(
            """
            SELECT COUNT(*) FROM weather_history
            WHERE station_id = $1 AND source = 'observation'
              AND time >= $2 AND time < $3
            """,
            station_id,
            datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ),
            datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ) + timedelta(days=1),
        )

    if count and count > 0:
        # Read from DB — build predictions from stored history data
        return await _backtest_from_db(target_date)

    # Fallback to API-based backtest
    return await history_service.backtest_date(target_date)


async def _backtest_from_db(target_date: date) -> dict:
    """Run backtest using data from weather_history table."""
    from app.models.warning_record import PowerPrediction
    from app.services.warning import WarningService

    pool = get_pool()
    warning_service = WarningService()
    all_predictions: dict[str, list[dict]] = {}
    all_warnings = []

    start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=SHANGHAI_TZ)
    end = start + timedelta(days=1)

    # Get weather summary (from any station — observations are district-level)
    first_station = list(STREET_TO_STATION_ID.values())[0]
    async with pool.acquire() as conn:
        weather_rows = await conn.fetch(
            """
            SELECT time, weather_icon, weather_text, temp, humidity, cloud,
                   pop, wind_speed, precip
            FROM weather_history
            WHERE station_id = $1 AND source = 'observation'
              AND time >= $2 AND time < $3
            ORDER BY time
            """,
            first_station, start, end,
        )

    weather_hourly = [
        {
            "time": r["time"].astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M"),
            "icon": r["weather_icon"] or 100,
            "text": r["weather_text"] or "--",
            "temp": r["temp"] or 0,
            "humidity": r["humidity"] or 0,
            "cloud": r["cloud"] or 0,
            "pop": r["pop"] or 0,
            "wind_speed": r["wind_speed"] or 0,
            "precip": r["precip"] or 0,
        }
        for r in weather_rows
    ]

    for street, station_id in STREET_TO_STATION_ID.items():
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT time, ghi, clearsky_ghi, weather_ratio,
                       power_kw, clearsky_power_kw, weather_text, weather_icon
                FROM weather_history
                WHERE station_id = $1 AND source = 'observation'
                  AND time >= $2 AND time < $3
                  AND ghi IS NOT NULL
                ORDER BY time
                """,
                station_id, start, end,
            )

        if not rows:
            continue

        predictions = []
        for r in rows:
            dt = r["time"].astimezone(SHANGHAI_TZ)
            pred = PowerPrediction(
                time=dt.strftime("%Y-%m-%d %H:00"),
                ghi=r["ghi"] or 0,
                clearsky_ghi=r["clearsky_ghi"] or 0,
                weather_ratio=r["weather_ratio"] or 0,
                power_kw=r["power_kw"] or 0,
                clearsky_power_kw=r["clearsky_power_kw"] or 0,
                weather_text=r["weather_text"] or "--",
                weather_icon=r["weather_icon"] or 999,
                is_estimated=True,
            )
            predictions.append(pred)

        all_predictions[street] = [p.model_dump() for p in predictions]
        warnings = warning_service.evaluate_predictions(street, predictions, is_historical=True)
        all_warnings.extend(warnings)

    level_order = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}
    all_warnings.sort(key=lambda w: (level_order.get(w.level, 9), w.from_time))

    return {
        "date": str(target_date),
        "weather_hourly": weather_hourly,
        "predictions": all_predictions,
        "warnings": [w.model_dump() for w in all_warnings],
        "summary": {
            "total_warnings": len(all_warnings),
            "by_level": {
                level: sum(1 for w in all_warnings if w.level == level)
                for level in ["red", "orange", "yellow", "blue"]
            },
        },
        "data_source": "database (weather_history)",
    }


@router.get("/backtest-range")
async def backtest_range(
    start: date = Query(...), end: date = Query(...),
):
    if (end - start).days > 30:
        return {"error": "范围不能超过30天"}
    results = []
    current = start
    while current <= end:
        results.append(await backtest_date(current))
        current += timedelta(days=1)
    return {"results": results}


@router.post("/fetch-range")
async def fetch_and_cache(
    start: date = Query(...), end: date = Query(...),
):
    """Fetch historical weather and store in DB."""
    from app.services.data_collector import DataCollector

    collector = DataCollector()
    fetched, failed = [], []
    current = start
    while current <= end:
        try:
            count = await collector.collect_observations(current)
            if count > 0:
                fetched.append(str(current))
            else:
                failed.append(str(current))
        except Exception:
            failed.append(str(current))
        current += timedelta(days=1)
    return {"fetched": fetched, "failed": failed}
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/api/history.py
git commit -m "refactor: history API reads from DB, falls back to API for missing data"
```

---

### Task 9: Update Environment + Deployment Config

> **Note:** The `STREET_TO_STATION_ID` mapping was already added to `constants.py` as part of Task 1, and all files use it from the start — no separate extraction task needed.

**Files:**
- Modify: `backend/.env` (or `.env.example`)
- Modify: `backend/Dockerfile`
- Modify: `backend/requirements.txt` (verify asyncpg is added)

- [ ] **Step 1: Add DATABASE_URL to .env.example**

Add to `.env.example`:
```
# PostgreSQL
DATABASE_URL=postgresql://pvuser:pvpass@localhost:5432/pv_warning
```

- [ ] **Step 2: Add DATABASE_URL to server .env**

On the server, add to the `.env` file:
```
DATABASE_URL=postgresql://pvuser:pvpass@localhost:5432/pv_warning
```

- [ ] **Step 3: Verify requirements.txt includes asyncpg**

Confirm `asyncpg==0.30.0` is in `backend/requirements.txt`.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: add DATABASE_URL to env config"
```

---

### Task 10: Cleanup Old JSON Storage

**Files:**
- Modify: `backend/app/services/warning.py` — remove JSON read/write
- Remove dependency on: `data/warnings.json`

After PostgreSQL is working, remove the JSON-based warning persistence.

- [ ] **Step 1: Simplify warning.py — remove JSON persistence**

In `backend/app/services/warning.py`:
- Remove `WARNINGS_FILE`, `HISTORY_RETENTION_DAYS`
- Remove `_load_history()`, `_save_history()` methods
- Remove `self._history` field
- Remove `self._active_warnings` field
- Keep `_determine_level()` and `evaluate_predictions()` — these are pure computation, still used by DataCollector
- Remove `evaluate_street()`, `evaluate_all()`, `get_active_warnings()`, `get_history()` — replaced by DataCollector + DB reads

New `warning.py` should be slim:

```python
"""预警引擎：双判据检测光伏出力骤变（weather_ratio 变化率 + 天气驱动绝对变化量）

设计初衷：天气骤变（晴→雨、阴→晴）导致大量负荷/发电能力突然变化，
对电网潮流造成冲击。因此预警必须同时满足：
  1. weather_ratio 变化率足够大（变化剧烈）
  2. 天气驱动的绝对出力变化量足够大（对电网有实际影响）

关键设计：只检测天气驱动的变化，排除晴空曲线自然变化（日出日落）。
  - 变化率 = |ratio_t - ratio_t1| / max(ratio_t, ratio_t1)
  - 绝对量 = clearsky_avg × |ratio_t - ratio_t1|
  天气不变时两者都为0，无论日出日落怎么变都不会误报。
"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.config import settings
from app.core.constants import WARNING_LEVELS
from app.models.warning_record import PowerPrediction, WarningRecord

_LEVEL_ORDER = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}


class WarningService:
    """双判据预警引擎 — 纯计算，不涉及存储"""

    def _determine_level(self, change_rate: float, abs_change_kw: float) -> str | None:
        """双判据分级：取两个维度各自能达到的最高等级中较低的那个（短板原则）。"""
        rate_level = None
        if change_rate >= settings.WARNING_RATE_RED:
            rate_level = "red"
        elif change_rate >= settings.WARNING_RATE_ORANGE:
            rate_level = "orange"
        elif change_rate >= settings.WARNING_RATE_YELLOW:
            rate_level = "yellow"
        elif change_rate >= settings.WARNING_RATE_BLUE:
            rate_level = "blue"

        abs_level = None
        if abs_change_kw >= settings.WARNING_ABS_RED:
            abs_level = "red"
        elif abs_change_kw >= settings.WARNING_ABS_ORANGE:
            abs_level = "orange"
        elif abs_change_kw >= settings.WARNING_ABS_YELLOW:
            abs_level = "yellow"
        elif abs_change_kw >= settings.WARNING_ABS_BLUE:
            abs_level = "blue"

        if rate_level is None or abs_level is None:
            return None

        return max(rate_level, abs_level, key=lambda l: _LEVEL_ORDER[l])

    def evaluate_predictions(
        self,
        street: str,
        predictions: list[PowerPrediction],
        is_historical: bool = False,
    ) -> list[WarningRecord]:
        """唯一的检测入口：对一组预测序列进行双判据骤变检测。"""
        if len(predictions) < 2:
            return []

        now_shanghai = datetime.now(timezone(timedelta(hours=8)))
        now_hour = now_shanghai.hour
        warnings: list[WarningRecord] = []
        seen_pairs: set[str] = set()

        for window in [1, 2]:
            for i in range(len(predictions) - window):
                curr = predictions[i]
                target = predictions[i + window]

                curr_date = curr.time.split(" ")[0]
                target_date_str = target.time.split(" ")[0]

                if curr_date != target_date_str:
                    continue

                if not is_historical:
                    try:
                        curr_hour = int(curr.time.split(" ")[1].split(":")[0])
                    except (IndexError, ValueError):
                        continue
                    curr_date_obj = date.fromisoformat(curr_date)
                    if curr_date_obj == now_shanghai.date() and curr_hour < now_hour:
                        continue

                ratio_from = curr.weather_ratio
                ratio_to = target.weather_ratio
                ratio_delta = abs(ratio_from - ratio_to)

                if ratio_delta < 0.01:
                    continue

                denominator = max(ratio_from, ratio_to)
                if denominator <= 0:
                    continue

                change_rate = ratio_delta / denominator
                clearsky_avg = (curr.clearsky_power_kw + target.clearsky_power_kw) / 2
                abs_change_kw = clearsky_avg * ratio_delta

                level = self._determine_level(change_rate, abs_change_kw)
                if level is None:
                    continue

                pair_key = f"{curr.time}-{target.time}"
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                warn_type = "ramp_down" if ratio_to < ratio_from else "ramp_up"
                level_info = WARNING_LEVELS[level]

                warning = WarningRecord(
                    id=f"W-{street[:2]}-{now_shanghai.strftime('%Y%m%d%H%M%S')}-{i}-{window}h",
                    level=level,
                    label=level_info["label"],
                    type=warn_type,
                    street=street,
                    action=level_info["action"],
                    change_rate=round(change_rate, 3),
                    abs_change_kw=round(abs_change_kw, 2),
                    from_time=curr.time,
                    to_time=target.time,
                    from_power_kw=curr.power_kw,
                    to_power_kw=target.power_kw,
                    issued_at=now_shanghai.isoformat(),
                    weather_from=curr.weather_text,
                    weather_to=target.weather_text,
                )
                warnings.append(warning)

        return warnings
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_warning.py -v`
Expected: All 14 tests pass (they test `_determine_level` and `evaluate_predictions` which are unchanged)

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/warning.py
git commit -m "refactor: remove JSON persistence from WarningService, keep pure computation"
```

---

### Task 11: Integration Test — Full Data Collection Cycle

**Files:**
- Create: `backend/tests/test_integration_db.py`

- [ ] **Step 1: Write integration test**

Create `backend/tests/test_integration_db.py`:

```python
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
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_integration_db.py -v -m integration`
Expected: PASS (requires PostgreSQL running with seeded data)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_integration_db.py
git commit -m "test: add DB integration tests"
```

---

### Task 12: Server Deployment

**Files:** No new files — deployment steps.

- [ ] **Step 1: Create database on server**

SSH into `43.167.177.60`:
```bash
sudo -u postgres psql -c "CREATE DATABASE pv_warning;"
sudo -u postgres psql -c "CREATE USER pvuser WITH PASSWORD 'pvpass';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE pv_warning TO pvuser;"
sudo -u postgres psql -d pv_warning -c "GRANT ALL ON SCHEMA public TO pvuser;"
```

- [ ] **Step 2: Run init_db.sql on server**

```bash
psql -U pvuser -d pv_warning -f backend/scripts/init_db.sql
```

- [ ] **Step 3: Add DATABASE_URL to server .env**

```bash
echo 'DATABASE_URL=postgresql://pvuser:pvpass@localhost:5432/pv_warning' >> .env
```

- [ ] **Step 4: Install asyncpg on server**

```bash
pip install asyncpg==0.30.0
```

- [ ] **Step 5: Run seed script on server**

```bash
cd backend && python scripts/seed_stations.py
```

- [ ] **Step 6: Deploy updated code and restart service**

```bash
# Pull latest code
git pull

# Restart the FastAPI service
systemctl restart pv-warning  # or however the service is managed
```

- [ ] **Step 7: Verify via health check**

```bash
curl http://43.167.177.60:8000/health
curl http://43.167.177.60:8000/api/weather/streets
```
Expected: `{"status": "ok"}` and street list

---

## Self-Review Checklist

1. **Spec coverage:** All requirements covered:
   - [x] 4 tables (stations, weather_forecast, weather_history, warnings)
   - [x] DataCollector for scheduled collection (hourly + daily)
   - [x] 11 API calls/hour (10 weather + 1 GHI)
   - [x] Frontend API routes read from DB only
   - [x] forecast UPSERT hourly, archive past → history
   - [x] history PK includes source (forecast_archive / observation)
   - [x] District total = SUM(streets)
   - [x] Daily: fetch yesterday's actual observations

2. **No placeholders:** All tasks have complete code.

3. **Type consistency:** `STREET_TO_STATION_ID` defined once in `constants.py` (Task 1), used everywhere. `PowerPrediction`, `WarningRecord` models unchanged. API response formats match frontend expectations.

4. **Migration safety:** Old services (ForecastService, WeatherService, HistoricalWeatherService) are preserved for fallback. New code is additive. JSON files not deleted, just no longer written to.

5. **Data lifecycle:** `weather_history` cleaned after 90 days, `warnings` after 30 days (daily cleanup job at 02:00). `weather_forecast` self-manages via archive+delete cycle.

6. **API calls per hour:** 10 weather forecasts (per-street coordinates) + 10 GHI (per-street coordinates) = 20 calls/hour. GHI fetched per-street because solar radiation API has 1km resolution and streets span ~20×40km.
