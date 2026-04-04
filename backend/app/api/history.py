"""History API: weather history and backtest endpoints backed by PostgreSQL.

All read endpoints only read from DB. If data is missing, returns error with
guidance to use fetch-range to pull data first.
"""

from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Query
from loguru import logger

from app.core.constants import JINSHAN_STREETS, SHANGHAI_TZ, STATION_ID_TO_STREET, STREET_TO_STATION_ID
from app.core.database import get_pool
from app.models.warning_record import PowerPrediction
from app.services.aggregation import AggregationService
from app.services.data_collector import DataCollector
from app.services.warning import WarningService

router = APIRouter()
warning_service = WarningService()
aggregation_service = AggregationService()


# ── Helpers ─────────────────────────────────────────────────────────────────

def _date_range(start: date, end: date) -> list[date]:
    result = []
    current = start
    while current <= end:
        result.append(current)
        current += timedelta(days=1)
    return result


async def _has_history_data(target_date: date) -> bool:
    """Return True if we have any data for target_date.

    Checks: weather_history (observation/forecast_archive) + weather_forecast
    (past hours not yet archived).
    """
    pool = get_pool()
    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         tzinfo=SHANGHAI_TZ)
    day_end = day_start + timedelta(days=1)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT 1 FROM weather_history
            WHERE time >= $1 AND time < $2
            LIMIT 1
            """,
            day_start,
            day_end,
        )
        if row:
            return True
        # Also check forecast table for today's past hours (not yet archived)
        row = await conn.fetchrow(
            """
            SELECT 1 FROM weather_forecast
            WHERE forecast_time >= $1 AND forecast_time < $2
            LIMIT 1
            """,
            day_start,
            day_end,
        )
    return row is not None


def _union_weather_sql(now: datetime) -> tuple[str, list]:
    """Build SQL that merges history + forecast (past hours only).

    Returns (sql, extra_params) — caller provides $1=day_start, $2=day_end.
    $3 is the current time cutoff for forecast rows.
    """
    sql = """
        SELECT time, weather_icon, weather_text, temp, humidity,
               cloud, pop, wind_speed, precip, source, station_id
        FROM (
            -- 1. weather_history (observation + forecast_archive)
            SELECT time, weather_icon, weather_text, temp, humidity,
                   cloud, pop, wind_speed, precip, source, station_id
            FROM weather_history
            WHERE time >= $1 AND time < $2
            UNION ALL
            -- 2. weather_forecast (past hours only, not yet archived)
            SELECT forecast_time AS time, weather_icon, weather_text, temp, humidity,
                   cloud, pop, wind_speed, precip, 'forecast_current' AS source, station_id
            FROM weather_forecast
            WHERE forecast_time >= $1 AND forecast_time < $2
              AND forecast_time <= $3
        ) combined
        ORDER BY time,
                 CASE source
                     WHEN 'observation' THEN 0
                     WHEN 'forecast_archive' THEN 1
                     ELSE 2
                 END
    """
    return sql, now


async def _fetch_history_weather(target_date: date) -> list[dict]:
    """Fetch hourly weather for target_date.

    Merges: observation > forecast_archive > forecast_current (past hours only).
    Deduplicated by hour.
    """
    pool = get_pool()
    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         tzinfo=SHANGHAI_TZ)
    day_end = day_start + timedelta(days=1)
    now = datetime.now(SHANGHAI_TZ)
    sql, cutoff = _union_weather_sql(now)

    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, day_start, day_end, cutoff)

    seen_hours: set[int] = set()
    result = []
    for r in rows:
        t: datetime = r["time"]
        t_sh = t.astimezone(SHANGHAI_TZ)
        if t_sh.hour in seen_hours:
            continue
        seen_hours.add(t_sh.hour)
        result.append({
            "time": t_sh.strftime("%Y-%m-%d %H:00"),
            "icon": r["weather_icon"] or 100,
            "text": r["weather_text"] or "",
            "temp": r["temp"] or 0.0,
            "humidity": r["humidity"] or 0,
            "cloud": r["cloud"] or 0,
            "pop": r["pop"] or 0,
            "wind_speed": r["wind_speed"] or 0.0,
            "precip": r["precip"] or 0.0,
        })
    return result


async def _fetch_predictions_from_db(target_date: date) -> dict[str, list[PowerPrediction]]:
    """Build per-street PowerPrediction lists.

    Merges: observation > forecast_archive > forecast_current (past hours only).
    """
    pool = get_pool()
    day_start = datetime(target_date.year, target_date.month, target_date.day,
                         tzinfo=SHANGHAI_TZ)
    day_end = day_start + timedelta(days=1)
    now = datetime.now(SHANGHAI_TZ)

    predictions: dict[str, list[PowerPrediction]] = {}

    for street, station_id in STREET_TO_STATION_ID.items():
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT DISTINCT ON (time)
                       time, weather_icon, weather_text,
                       ghi, clearsky_ghi, weather_ratio,
                       power_kw, clearsky_power_kw, source
                FROM (
                    SELECT time, weather_icon, weather_text,
                           ghi, clearsky_ghi, weather_ratio,
                           power_kw, clearsky_power_kw, source
                    FROM weather_history
                    WHERE station_id = $1 AND time >= $2 AND time < $3
                    UNION ALL
                    SELECT forecast_time AS time, weather_icon, weather_text,
                           ghi, clearsky_ghi, weather_ratio,
                           power_kw, clearsky_power_kw, 'forecast_current' AS source
                    FROM weather_forecast
                    WHERE station_id = $1 AND forecast_time >= $2 AND forecast_time < $3
                      AND forecast_time <= $4
                ) combined
                ORDER BY time,
                         CASE source
                             WHEN 'observation' THEN 0
                             WHEN 'forecast_archive' THEN 1
                             ELSE 2
                         END
                """,
                station_id,
                day_start,
                day_end,
                now,
            )

        if not rows:
            continue

        preds: list[PowerPrediction] = []
        for r in rows:
            t: datetime = r["time"]
            t_sh = t.astimezone(SHANGHAI_TZ)
            preds.append(PowerPrediction(
                time=t_sh.strftime("%Y-%m-%d %H:00"),
                ghi=r["ghi"] or 0.0,
                clearsky_ghi=r["clearsky_ghi"] or 0.0,
                weather_ratio=r["weather_ratio"] or 0.0,
                power_kw=r["power_kw"] or 0.0,
                clearsky_power_kw=r["clearsky_power_kw"] or 0.0,
                weather_text=r["weather_text"] or "",
                weather_icon=r["weather_icon"] or 100,
                is_estimated=r["source"] != "observation",
            ))

        if preds:
            predictions[street] = preds

    return predictions


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/weather/{target_date}")
async def get_historical_weather(target_date: date):
    """Return hourly weather for target_date.

    Checks weather_history (source='observation') first; falls back to API.
    """
    try:
        has_db_data = await _has_history_data(target_date)
    except Exception as e:
        logger.warning(f"DB check failed for {target_date}, falling back to API: {e}")
        has_db_data = False

    if not has_db_data:
        return {"error": "该日期暂无历史数据，请先通过 fetch-range 接口拉取", "date": str(target_date)}

    hourly = await _fetch_history_weather(target_date)
    if not hourly:
        return {"error": "该日期暂无历史数据", "date": str(target_date)}
    return {"date": str(target_date), "hourly": hourly}


@router.get("/backtest/{target_date}")
async def backtest_date(target_date: date):
    """Run backtest for target_date.

    If DB has observation data, builds predictions from DB and runs WarningService.
    Returns error if DB has no observation data for the date.
    """
    try:
        has_db_data = await _has_history_data(target_date)
    except Exception as e:
        logger.warning(f"DB check failed for {target_date}, falling back to API: {e}")
        has_db_data = False

    if not has_db_data:
        return {
            "date": str(target_date),
            "error": "该日期暂无历史数据，请先通过 fetch-range 接口拉取",
            "predictions": {},
            "warnings": [],
            "summary": {"total_warnings": 0, "by_level": {}},
            "data_source": "none",
        }

    # Fetch weather hourly for display
    weather_hourly = await _fetch_history_weather(target_date)

    # Build per-street predictions from DB
    street_predictions = await _fetch_predictions_from_db(target_date)

    all_warnings = []
    all_predictions_serialized: dict[str, list[dict]] = {}

    for street, preds in street_predictions.items():
        all_predictions_serialized[street] = [p.model_dump() for p in preds]
        agg = aggregation_service.get_street_aggregation(street)
        capacity = agg.total_capacity_kw if agg else 0
        warnings = warning_service.evaluate_predictions(
            street, preds, capacity, is_historical=True
        )
        all_warnings.extend(warnings)

    level_order = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}
    all_warnings.sort(key=lambda w: (level_order.get(w.level, 9), w.from_time))

    return {
        "date": str(target_date),
        "weather_hourly": weather_hourly,
        "predictions": all_predictions_serialized,
        "warnings": [w.model_dump() for w in all_warnings],
        "summary": {
            "total_warnings": len(all_warnings),
            "by_level": {
                level: sum(1 for w in all_warnings if w.level == level)
                for level in ["red", "orange", "yellow", "blue"]
            },
        },
        "data_source": "observation (PostgreSQL weather_history)",
    }


@router.get("/backtest-range")
async def backtest_range(
    start: date = Query(...),
    end: date = Query(...),
):
    """Run backtest for a date range. Maximum 30 days."""
    if (end - start).days > 30:
        return {"error": "范围不能超过30天"}

    results = []
    for d in _date_range(start, end):
        results.append(await backtest_date(d))
    return {"results": results}


@router.post("/fetch-range")
async def fetch_and_cache(
    start: date = Query(...),
    end: date = Query(...),
):
    """Fetch historical observation data for a date range and store in PostgreSQL.

    Uses DataCollector.collect_observations() for each date.
    Returns {fetched: [...], failed: [...]}.
    """
    collector = DataCollector()
    fetched: list[str] = []
    failed: list[str] = []

    for d in _date_range(start, end):
        try:
            count = await collector.collect_observations(target_date=d)
            if count > 0:
                fetched.append(str(d))
            else:
                failed.append(str(d))
        except Exception as e:
            logger.error(f"collect_observations failed for {d}: {e}")
            failed.append(str(d))

    return {"fetched": fetched, "failed": failed}
