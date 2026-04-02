from fastapi import APIRouter, HTTPException

from app.core.constants import JINSHAN_STREETS
from app.services.weather import WeatherService

router = APIRouter()
weather_service = WeatherService()


@router.get("/forecast/{street}")
async def get_street_forecast(street: str):
    """获取指定街道未来24小时逐小时天气预报"""
    if street not in JINSHAN_STREETS:
        raise HTTPException(status_code=404, detail=f"未知街道: {street}")
    data = await weather_service.get_hourly_forecast(street)
    if not data:
        raise HTTPException(status_code=503, detail="气象数据获取失败")
    return data


@router.get("/forecast")
async def get_all_forecasts():
    """获取所有街道天气预报"""
    return await weather_service.get_all_streets_forecast()


@router.get("/streets")
async def get_streets():
    """获取金山区所有街道列表"""
    return {
        name: {"lat": info["lat"], "lon": info["lon"]}
        for name, info in JINSHAN_STREETS.items()
    }
