from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.core.constants import JINSHAN_STREETS
from app.services.forecast import ForecastService
from app.services.solar import SolarService

router = APIRouter()
forecast_service = ForecastService()
solar_service = SolarService()


@router.get("/power/{street}")
async def get_street_power(street: str, target_date: date | None = None):
    """获取指定街道的逐小时出力预测"""
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")
    predictions = await forecast_service.predict_street_power(street, target_date)
    return {"street": street, "predictions": [p.model_dump() for p in predictions]}


@router.get("/power")
async def get_all_power(target_date: date | None = None):
    """获取所有街道的出力预测"""
    all_data = await forecast_service.predict_all_streets(target_date)
    return {
        street: [p.model_dump() for p in predictions]
        for street, predictions in all_data.items()
    }


@router.get("/total")
async def get_district_total(target_date: date | None = None):
    """获取全区汇总出力预测"""
    return await forecast_service.get_district_total_prediction(target_date)


@router.get("/curve")
async def get_clearsky_curve(target_date: date | None = None):
    """获取晴空理论发电曲线"""
    target_date = target_date or date.today()
    curve = solar_service.get_clearsky_curve_default(target_date)
    return {"date": str(target_date), "curve": curve}
