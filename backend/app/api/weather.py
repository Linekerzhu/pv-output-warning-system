"""Weather API routes — read from weather_forecast table."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from app.core.constants import JINSHAN_STREETS, SHANGHAI_TZ, STREET_TO_STATION_ID
from app.repositories.weather_repo import WeatherRepo

router = APIRouter()
weather_repo = WeatherRepo()


def _fmt_time(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(SHANGHAI_TZ).strftime("%Y-%m-%d %H:%M")


def _row_to_hourly(row) -> dict:
    return {
        "time": _fmt_time(row["forecast_time"]),
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
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")

    station_id = STREET_TO_STATION_ID[street]
    rows = await weather_repo.get_street_forecast(station_id)

    if not rows:
        raise HTTPException(status_code=503, detail="暂无气象数据，请稍后再试")

    return {
        "street": street,
        "update_time": _fmt_time(rows[0]["forecast_time"]),
        "hourly": [_row_to_hourly(r) for r in rows],
    }


@router.get("/forecast")
async def get_all_forecasts():
    rows = await weather_repo.get_all_forecasts()

    result: dict = {}
    for row in rows:
        street = row["street"]
        if street not in result:
            result[street] = {
                "street": street,
                "update_time": _fmt_time(row["forecast_time"]),
                "hourly": [],
            }
        result[street]["hourly"].append(_row_to_hourly(row))

    return result


@router.get("/summary")
async def get_weather_summary():
    now = datetime.now(tz=SHANGHAI_TZ)
    rows = await weather_repo.get_weather_summary_rows(now - timedelta(hours=1))

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
        weather_change = any(
            h["weather_text"] != current["weather_text"] for h in hours[1:]
        )
        summary.append({
            "street": street,
            "current_text": current["weather_text"] or "--",
            "current_icon": current["weather_icon"] or 100,
            "next_hour_text": next_hour["weather_text"] if next_hour else None,
            "next_hour_icon": next_hour["weather_icon"] if next_hour else None,
            "weather_change": weather_change,
        })

    return summary


# 金山区天气/辐照度 = 山阳镇（区政府所在地）
DISTRICT_STATION_ID = STREET_TO_STATION_ID["山阳镇"]
DISTRICT_COORDS = JINSHAN_STREETS["山阳镇"]


@router.get("/solar-radiation")
async def get_solar_radiation(hours: int = 24):
    now = datetime.now(tz=SHANGHAI_TZ)
    rows = await weather_repo.get_solar_radiation(
        DISTRICT_STATION_ID, now - timedelta(hours=1), hours
    )

    forecasts = [
        {
            "time": _fmt_time(r["forecast_time"]),
            "ghi": r["ghi"] or 0,
            "dni": r["dni"] or 0,
            "dhi": r["dhi"] or 0,
            "elevation": 0,
        }
        for r in rows
    ]

    return {"lat": DISTRICT_COORDS["lat"], "lon": DISTRICT_COORDS["lon"], "forecasts": forecasts}


@router.get("/streets")
async def get_streets():
    return {
        name: {"lat": info["lat"], "lon": info["lon"]}
        for name, info in JINSHAN_STREETS.items()
    }
