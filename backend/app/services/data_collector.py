"""DataCollector: hourly pipeline that collects weather, computes GHI/power,
archives past forecasts, and evaluates warnings — all persisted to PostgreSQL.
"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.config import settings
from app.core.constants import (
    JINSHAN_STREETS,
    SHANGHAI_TZ,
    STREET_TO_STATION_ID,
)
from app.core.database import get_pool
from app.models.warning_record import PowerPrediction
from app.repositories.warning_repo import WarningRepo
from app.services.aggregation import AggregationService
from app.services.history import HistoricalWeatherService
from app.services.solar import SolarService
from app.services.warning import WarningService
from app.services.weather import WeatherService


class DataCollector:
    """Hourly data collection pipeline backed by PostgreSQL."""

    def __init__(
        self,
        weather_service: WeatherService | None = None,
        solar_service: SolarService | None = None,
        aggregation_service: AggregationService | None = None,
        warning_service: WarningService | None = None,
        history_service: HistoricalWeatherService | None = None,
        warning_repo: WarningRepo | None = None,
    ):
        self.weather_service = weather_service or WeatherService()
        self.solar_service = solar_service or SolarService()
        self.aggregation_service = aggregation_service or AggregationService()
        self.warning_service = warning_service or WarningService()
        self.history_service = history_service or HistoricalWeatherService()
        self.warning_repo = warning_repo or WarningRepo()

    # ── 1. Collect weather forecasts ────────────────────────

    async def _collect_street_weather(self, station_id: str, street: str) -> int:
        """Fetch hourly forecast for one street and UPSERT into weather_forecast.

        Returns:
            Number of rows upserted.
        """
        forecast = await self.weather_service.get_hourly_forecast(street)
        if forecast is None:
            logger.warning(f"无法获取 {street} 天气预报，跳过")
            return 0

        rows = []
        for hw in forecast.hourly:
            # hw.time format: "2026-04-04 14:00"
            dt = datetime.strptime(hw.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)
            rows.append((
                station_id,
                dt,
                hw.icon,
                hw.text,
                hw.temp,
                hw.humidity,
                hw.cloud,
                hw.pop,
                hw.wind_speed,
                hw.precip,
            ))

        if not rows:
            return 0

        pool = get_pool()
        async with pool.acquire() as conn:
            await conn.executemany(
                """
                INSERT INTO weather_forecast (
                    station_id, forecast_time,
                    weather_icon, weather_text, temp, humidity, cloud, pop, wind_speed, precip
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (station_id, forecast_time)
                DO UPDATE SET
                    weather_icon = EXCLUDED.weather_icon,
                    weather_text = EXCLUDED.weather_text,
                    temp     = EXCLUDED.temp,
                    humidity = EXCLUDED.humidity,
                    cloud    = EXCLUDED.cloud,
                    pop      = EXCLUDED.pop,
                    wind_speed = EXCLUDED.wind_speed,
                    precip   = EXCLUDED.precip,
                    updated_at = now()
                """,
                rows,
            )

        logger.info(f"[{street}] upserted {len(rows)} forecast rows")
        return len(rows)

    # ── 2. Update GHI and power fields ─────────────────────

    async def _update_ghi_and_power(self) -> None:
        """For each street, fetch solar radiation forecast, compute clearsky GHI,
        weather_ratio, power, and UPDATE the weather_forecast rows."""

        pool = get_pool()

        for street, info in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]
            lat, lon = info["lat"], info["lon"]

            # Get aggregated capacity
            agg = self.aggregation_service.get_street_aggregation(street)
            capacity_kw = agg.total_capacity_kw if agg else 0

            # Fetch solar radiation forecast (48h)
            radiation = await self.weather_service.get_solar_radiation(lat, lon, hours=48)
            if radiation is None:
                logger.warning(f"[{street}] 无法获取太阳辐射预报，跳过 GHI 更新")
                continue

            # Build {datetime: (ghi, dni, dhi)} mapping from radiation forecasts
            radiation_map: dict[datetime, tuple[float, float, float]] = {}
            for sr in radiation.forecasts:
                # sr.time format: "2026-04-04 14:00"
                dt = datetime.strptime(sr.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)
                radiation_map[dt] = (sr.ghi, sr.dni, sr.dhi)
            # Backward-compatible alias
            ghi_map = {dt: vals[0] for dt, vals in radiation_map.items()}

            # Collect all dates present in the radiation data
            dates_seen: set[date] = set()
            for dt in ghi_map:
                dates_seen.add(dt.date())

            # Compute clearsky GHI for each date
            clearsky_by_date: dict[date, dict[int, float]] = {}
            for d in dates_seen:
                clearsky_by_date[d] = self.solar_service.get_clearsky_ghi(d, lat, lon)

            # Build update rows
            update_rows = []
            for dt, ghi in ghi_map.items():
                d = dt.date()
                hour = dt.hour
                clearsky_ghi = clearsky_by_date.get(d, {}).get(hour, 0)

                if clearsky_ghi > 0:
                    weather_ratio = min(ghi / clearsky_ghi, 1.5)
                else:
                    weather_ratio = 0.0

                pr = settings.PV_PERFORMANCE_RATIO
                power_kw = capacity_kw * ghi / 1000 * pr
                clearsky_power_kw = capacity_kw * clearsky_ghi / 1000 * pr

                _, dni, dhi = radiation_map[dt]
                update_rows.append((
                    round(ghi, 1),
                    round(dni, 1),
                    round(dhi, 1),
                    round(clearsky_ghi, 1),
                    round(weather_ratio, 4),
                    round(power_kw, 2),
                    round(clearsky_power_kw, 2),
                    station_id,
                    dt,
                ))

            if not update_rows:
                continue

            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    UPDATE weather_forecast
                    SET ghi = $1,
                        dni = $2,
                        dhi = $3,
                        clearsky_ghi = $4,
                        weather_ratio = $5,
                        power_kw = $6,
                        clearsky_power_kw = $7,
                        updated_at = now()
                    WHERE station_id = $8 AND forecast_time = $9
                    """,
                    update_rows,
                )

            logger.info(f"[{street}] updated GHI/power for {len(update_rows)} rows")

    # ── 3. Archive past forecasts ──────────────────────────

    async def _archive_past_forecasts(self) -> int:
        """Move weather_forecast rows older than current hour to weather_history.

        Returns:
            Number of archived rows.
        """
        now_sh = datetime.now(SHANGHAI_TZ)
        current_hour = now_sh.replace(minute=0, second=0, microsecond=0)

        pool = get_pool()
        async with pool.acquire() as conn:
            # Copy to history
            result = await conn.execute(
                """
                INSERT INTO weather_history (
                    station_id, time, source,
                    weather_icon, weather_text, temp, humidity, cloud,
                    pop, wind_speed, precip,
                    ghi, dni, dhi, clearsky_ghi, weather_ratio,
                    power_kw, clearsky_power_kw, is_estimated
                )
                SELECT
                    station_id, forecast_time, 'forecast_archive',
                    weather_icon, weather_text, temp, humidity, cloud,
                    pop, wind_speed, precip,
                    ghi, dni, dhi, clearsky_ghi, weather_ratio,
                    power_kw, clearsky_power_kw, FALSE
                FROM weather_forecast
                WHERE forecast_time < $1
                ON CONFLICT (station_id, time, source) DO NOTHING
                """,
                current_hour,
            )
            # Parse "INSERT 0 N" to get count
            count = int(result.split()[-1]) if result else 0

            # Delete archived rows
            await conn.execute(
                "DELETE FROM weather_forecast WHERE forecast_time < $1",
                current_hour,
            )

        logger.info(f"Archived {count} past forecast rows")
        return count

    # ── 4. Collect historical observations ─────────────────

    async def collect_observations(self, target_date: date | None = None) -> int:
        """Fetch yesterday's observed weather and merge into weather_history.

        Strategy:
          - 天气字段（text/icon/temp/humidity等）：用真实观测（来自历史天气API）
          - GHI/power字段：优先继承 forecast_archive（来自辐射预报API，精度高）
          - 仅当无 forecast_archive 时，才用 icon→clearsky 估算 GHI

        Returns:
            Total rows inserted across all streets.
        """
        if target_date is None:
            target_date = (datetime.now(SHANGHAI_TZ) - timedelta(days=1)).date()

        # 1. Fetch actual weather observations from QWeather historical API
        hourly = await self.history_service.fetch_historical_weather(target_date)
        if hourly is None:
            logger.warning(f"无法获取 {target_date} 历史天气")
            return 0

        pool = get_pool()
        day_start = datetime(target_date.year, target_date.month, target_date.day,
                             tzinfo=SHANGHAI_TZ)
        day_end = day_start + timedelta(days=1)

        # 2. Load existing forecast_archive GHI data (per station, per hour)
        #    These come from the solar radiation forecast API — much more accurate
        #    than icon-based estimation
        archived_ghi: dict[str, dict[int, dict]] = {}  # {station_id: {hour: {ghi, dni, dhi, ...}}}
        async with pool.acquire() as conn:
            archive_rows = await conn.fetch(
                """
                SELECT station_id, time, ghi, dni, dhi,
                       clearsky_ghi, weather_ratio, power_kw, clearsky_power_kw
                FROM weather_history
                WHERE source = 'forecast_archive'
                  AND time >= $1 AND time < $2
                """,
                day_start,
                day_end,
            )
        for r in archive_rows:
            sid = r["station_id"]
            hour = r["time"].astimezone(SHANGHAI_TZ).hour
            if sid not in archived_ghi:
                archived_ghi[sid] = {}
            archived_ghi[sid][hour] = {
                "ghi": r["ghi"],
                "dni": r["dni"],
                "dhi": r["dhi"],
                "clearsky_ghi": r["clearsky_ghi"],
                "weather_ratio": r["weather_ratio"],
                "power_kw": r["power_kw"],
                "clearsky_power_kw": r["clearsky_power_kw"],
            }

        has_archive = len(archived_ghi) > 0
        logger.info(
            f"[{target_date}] forecast_archive: "
            f"{sum(len(v) for v in archived_ghi.values())} rows from {len(archived_ghi)} stations"
        )

        total = 0

        for street, info in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]
            lat, lon = info["lat"], info["lon"]

            agg = self.aggregation_service.get_street_aggregation(street)
            capacity_kw = agg.total_capacity_kw if agg else 0

            # Fallback: icon→GHI estimation (only used when no forecast_archive)
            estimated_ghi = None
            clearsky = None
            if station_id not in archived_ghi:
                estimated_ghi = self.history_service.estimate_ghi_from_weather(
                    target_date, hourly, lat, lon,
                )
                clearsky = self.solar_service.get_clearsky_ghi(target_date, lat, lon)

            station_archive = archived_ghi.get(station_id, {})

            rows = []
            for hw in hourly:
                try:
                    hour = int(hw.time.split(" ")[1].split(":")[0])
                except (IndexError, ValueError):
                    continue

                dt = datetime.strptime(hw.time, "%Y-%m-%d %H:%M").replace(tzinfo=SHANGHAI_TZ)

                # GHI source decision: forecast_archive > icon estimation
                arch = station_archive.get(hour)
                if arch and arch["ghi"] is not None:
                    # Use forecast API GHI (high accuracy)
                    ghi = arch["ghi"]
                    dni = arch["dni"]
                    dhi = arch["dhi"]
                    clearsky_ghi = arch["clearsky_ghi"] or 0.0
                    weather_ratio = arch["weather_ratio"] or 0.0
                    power_kw = arch["power_kw"] or 0.0
                    clearsky_power_kw = arch["clearsky_power_kw"] or 0.0
                    is_estimated = False
                elif estimated_ghi is not None and clearsky is not None:
                    # Fallback: icon-based estimation
                    ghi = estimated_ghi.get(hour, 0.0)
                    dni = None
                    dhi = None
                    clearsky_ghi = clearsky.get(hour, 0.0)
                    if clearsky_ghi > 0:
                        weather_ratio = min(ghi / clearsky_ghi, 1.5)
                    else:
                        weather_ratio = 0.0
                    pr = settings.PV_PERFORMANCE_RATIO
                    power_kw = capacity_kw * ghi / 1000 * pr
                    clearsky_power_kw = capacity_kw * clearsky_ghi / 1000 * pr
                    is_estimated = True
                else:
                    # No GHI data available for this hour
                    ghi = None
                    dni = None
                    dhi = None
                    clearsky_ghi = None
                    weather_ratio = None
                    power_kw = None
                    clearsky_power_kw = None
                    is_estimated = True

                rows.append((
                    station_id, dt, "observation",
                    hw.icon, hw.text, hw.temp, hw.humidity, hw.cloud,
                    hw.pop, hw.wind_speed, hw.precip,
                    round(ghi, 1) if ghi is not None else None,
                    round(dni, 1) if dni is not None else None,
                    round(dhi, 1) if dhi is not None else None,
                    round(clearsky_ghi, 1) if clearsky_ghi is not None else None,
                    round(weather_ratio, 4) if weather_ratio is not None else None,
                    round(power_kw, 2) if power_kw is not None else None,
                    round(clearsky_power_kw, 2) if clearsky_power_kw is not None else None,
                    is_estimated,
                ))

            if not rows:
                continue

            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO weather_history (
                        station_id, time, source,
                        weather_icon, weather_text, temp, humidity, cloud,
                        pop, wind_speed, precip,
                        ghi, dni, dhi, clearsky_ghi, weather_ratio,
                        power_kw, clearsky_power_kw, is_estimated
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                    ON CONFLICT (station_id, time, source) DO NOTHING
                    """,
                    rows,
                )
            total += len(rows)

        # Delete forecast_archive for this date (observation now has the data)
        if total > 0:
            async with pool.acquire() as conn:
                deleted = await conn.execute(
                    """
                    DELETE FROM weather_history
                    WHERE source = 'forecast_archive'
                      AND time >= $1 AND time < $2
                    """,
                    day_start,
                    day_end,
                )
            logger.info(f"Cleaned up forecast_archive for {target_date}: {deleted}")

        logger.info(f"Collected {total} observation rows for {target_date}")
        return total

    # ── 5. Evaluate warnings ───────────────────────────────

    async def _evaluate_warnings(self) -> None:
        """Read forecast data from DB, evaluate warnings at two levels:
        1. Per-street (镇级) — thresholds relative to street capacity
        2. District-wide (区级) — SUM of all streets, thresholds relative to total capacity
        """
        pool = get_pool()
        now_sh = datetime.now(SHANGHAI_TZ)
        all_warn_rows: list[tuple] = []

        # Collect per-street predictions + aggregate for district
        district_hourly: dict[str, dict] = {}  # {time_str: {power, clearsky, weather_text, ...}}

        for street, info in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]

            async with pool.acquire() as conn:
                records = await conn.fetch(
                    """
                    SELECT forecast_time, ghi, clearsky_ghi, weather_ratio,
                           power_kw, clearsky_power_kw, weather_text, weather_icon
                    FROM weather_forecast
                    WHERE station_id = $1
                      AND ghi IS NOT NULL
                    ORDER BY forecast_time
                    """,
                    station_id,
                )

            if not records:
                continue

            # Get street capacity
            agg = self.aggregation_service.get_street_aggregation(street)
            capacity_kw = agg.total_capacity_kw if agg else 0

            predictions = []
            for r in records:
                ft: datetime = r["forecast_time"]
                time_str = ft.astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M")
                predictions.append(PowerPrediction(
                    time=time_str,
                    ghi=r["ghi"],
                    clearsky_ghi=r["clearsky_ghi"],
                    weather_ratio=r["weather_ratio"],
                    power_kw=r["power_kw"],
                    clearsky_power_kw=r["clearsky_power_kw"],
                    weather_text=r["weather_text"] or "",
                    weather_icon=r["weather_icon"] or 100,
                    is_estimated=False,
                ))

                # Accumulate for district total
                if time_str not in district_hourly:
                    district_hourly[time_str] = {
                        "power_kw": 0, "clearsky_power_kw": 0,
                        "ghi_sum": 0, "clearsky_ghi_sum": 0, "count": 0,
                        "weather_text": r["weather_text"] or "",
                        "weather_icon": r["weather_icon"] or 100,
                    }
                d = district_hourly[time_str]
                d["power_kw"] += r["power_kw"]
                d["clearsky_power_kw"] += r["clearsky_power_kw"]
                d["ghi_sum"] += r["ghi"]
                d["clearsky_ghi_sum"] += r["clearsky_ghi"]
                d["count"] += 1

            # ── 镇级预警 ──
            warnings = self.warning_service.evaluate_predictions(
                street, predictions, capacity_kw,
            )
            for w in warnings:
                issued_dt = datetime.fromisoformat(w.issued_at)
                all_warn_rows.append((
                    w.id, w.level, w.label, w.type, w.street, w.action,
                    w.change_rate, w.abs_change_kw,
                    w.from_time, w.to_time, w.from_power_kw, w.to_power_kw,
                    issued_dt, w.weather_from, w.weather_to,
                ))

            if warnings:
                logger.info(f"[{street}] {len(warnings)} warnings (capacity={capacity_kw:.0f}kW)")

        # ── 区级预警 ──
        if district_hourly:
            total_capacity = self.aggregation_service.get_total_capacity_kw()
            district_predictions = []
            for time_str in sorted(district_hourly.keys()):
                d = district_hourly[time_str]
                avg_ghi = d["ghi_sum"] / d["count"] if d["count"] > 0 else 0
                avg_clearsky = d["clearsky_ghi_sum"] / d["count"] if d["count"] > 0 else 0
                weather_ratio = min(avg_ghi / avg_clearsky, 1.5) if avg_clearsky > 0 else 0

                district_predictions.append(PowerPrediction(
                    time=time_str,
                    ghi=round(avg_ghi, 1),
                    clearsky_ghi=round(avg_clearsky, 1),
                    weather_ratio=round(weather_ratio, 4),
                    power_kw=round(d["power_kw"], 2),
                    clearsky_power_kw=round(d["clearsky_power_kw"], 2),
                    weather_text=d["weather_text"],
                    weather_icon=d["weather_icon"],
                    is_estimated=False,
                ))

            district_warnings = self.warning_service.evaluate_predictions(
                "金山区", district_predictions, total_capacity,
            )
            for w in district_warnings:
                issued_dt = datetime.fromisoformat(w.issued_at)
                all_warn_rows.append((
                    w.id, w.level, w.label, w.type, w.street, w.action,
                    w.change_rate, w.abs_change_kw,
                    w.from_time, w.to_time, w.from_power_kw, w.to_power_kw,
                    issued_dt, w.weather_from, w.weather_to,
                ))

            if district_warnings:
                logger.warning(
                    f"[金山区] {len(district_warnings)} district warnings "
                    f"(capacity={total_capacity:.0f}kW)"
                )

        # Write all warnings to DB
        if all_warn_rows:
            await self.warning_repo.insert_warnings(all_warn_rows)
        await self.warning_repo.deactivate_old_warnings(now_sh - timedelta(hours=24))

        logger.info(f"Warnings total: {len(all_warn_rows)} (street + district)")

    # ── 6. Main hourly entry point ─────────────────────────

    async def collect_and_evaluate(self) -> None:
        """Main hourly pipeline:
        1. Collect weather forecasts for all streets
        2. Update GHI + power calculations
        3. Archive past forecasts
        4. Evaluate and persist warnings
        """
        logger.info("=== DataCollector: starting hourly pipeline ===")

        # Step 1: collect weather for all streets
        total_weather = 0
        for street, _ in JINSHAN_STREETS.items():
            station_id = STREET_TO_STATION_ID[street]
            count = await self._collect_street_weather(station_id, street)
            total_weather += count
        logger.info(f"Step 1 done: collected {total_weather} weather forecast rows")

        # Step 2: update GHI + power
        await self._update_ghi_and_power()
        logger.info("Step 2 done: GHI and power updated")

        # Step 3: archive past forecasts
        archived = await self._archive_past_forecasts()
        logger.info(f"Step 3 done: archived {archived} rows")

        # Step 4: evaluate warnings
        await self._evaluate_warnings()
        logger.info("Step 4 done: warnings evaluated")

        logger.info("=== DataCollector: hourly pipeline complete ===")

    # ── 7. Cleanup old data ────────────────────────────────

    async def cleanup_old_data(self) -> None:
        """Delete weather_history older than 90 days and warnings older than 30 days."""
        now_sh = datetime.now(SHANGHAI_TZ)
        pool = get_pool()

        async with pool.acquire() as conn:
            result_history = await conn.execute(
                "DELETE FROM weather_history WHERE time < $1",
                now_sh - timedelta(days=90),
            )
            result_warnings = await conn.execute(
                "DELETE FROM warnings WHERE issued_at < $1",
                now_sh - timedelta(days=30),
            )

        logger.info(f"Cleanup: history={result_history}, warnings={result_warnings}")
