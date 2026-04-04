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
    dni             DOUBLE PRECISION,
    dhi             DOUBLE PRECISION,
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
