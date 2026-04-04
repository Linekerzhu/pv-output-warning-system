from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query

from app.core.constants import JINSHAN_STREETS, SHANGHAI_TZ, STREET_TO_STATION_ID
from app.repositories.forecast_repo import ForecastRepo
from app.services.solar import SolarService

router = APIRouter()
solar_service = SolarService()
forecast_repo = ForecastRepo()


def _date_range(target_date: date | None) -> tuple[datetime, datetime]:
    """Return [start, end) datetime range in Shanghai TZ for DB filtering."""
    today = datetime.now(SHANGHAI_TZ).date()
    start_date = target_date if target_date is not None else today
    start = datetime(start_date.year, start_date.month, start_date.day, tzinfo=SHANGHAI_TZ)
    end = start + timedelta(days=2)
    return start, end


def _fmt_row(row) -> dict:
    """Convert a DB row from weather_forecast to prediction dict."""
    ft: datetime = row["forecast_time"]
    if ft.tzinfo is None:
        ft = ft.replace(tzinfo=timezone.utc)
    ft_sh = ft.astimezone(SHANGHAI_TZ)
    return {
        "time": ft_sh.strftime("%Y-%m-%d %H:00"),
        "ghi": row["ghi"],
        "clearsky_ghi": row["clearsky_ghi"],
        "weather_ratio": row["weather_ratio"],
        "power_kw": row["power_kw"],
        "clearsky_power_kw": row["clearsky_power_kw"],
        "weather_text": row["weather_text"],
        "weather_icon": row["weather_icon"],
        "is_estimated": False,
    }


@router.get("/power/{street}")
async def get_street_power(street: str, target_date: date | None = None):
    """获取指定街道的逐小时出力预测"""
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")

    station_id = STREET_TO_STATION_ID[street]
    start, end = _date_range(target_date)
    rows = await forecast_repo.get_street_power(station_id, start, end)

    predictions = [_fmt_row(r) for r in rows]
    return {"street": street, "predictions": predictions}


@router.get("/power")
async def get_all_power(target_date: date | None = None):
    """获取所有街道的出力预测"""
    start, end = _date_range(target_date)
    rows = await forecast_repo.get_all_street_power(start, end)

    result: dict[str, list] = {}
    for r in rows:
        street_name = r["street_name"]
        if street_name not in result:
            result[street_name] = []
        result[street_name].append(_fmt_row(r))

    return result


@router.get("/total")
async def get_district_total(target_date: date | None = None):
    """获取全区汇总出力预测"""
    start, end = _date_range(target_date)
    rows, total_capacity_kw = await forecast_repo.get_district_total(start, end)

    result = []
    for r in rows:
        ft: datetime = r["forecast_time"]
        if ft.tzinfo is None:
            ft = ft.replace(tzinfo=timezone.utc)
        ft_sh = ft.astimezone(SHANGHAI_TZ)
        result.append(
            {
                "time": ft_sh.strftime("%Y-%m-%d %H:00"),
                "predicted_power_kw": r["total_power_kw"],
                "clearsky_power_kw": r["total_clearsky_power_kw"],
                "total_capacity_kw": total_capacity_kw,
            }
        )

    return result


@router.get("/curve")
async def get_clearsky_curve(target_date: date | None = None):
    """获取晴空理论发电曲线"""
    target_date = target_date or date.today()
    curve = solar_service.get_clearsky_curve_default(target_date)
    return {"date": str(target_date), "curve": curve}
