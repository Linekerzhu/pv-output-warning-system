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


@router.get("/summary")
async def get_weather_summary():
    """获取所有街道的轻量天气摘要，用于地图展示"""
    all_forecasts = await weather_service.get_all_streets_forecast()
    summary = []
    for street, forecast in all_forecasts.items():
        hourly = forecast.hourly
        if not hourly:
            continue

        current = hourly[0]
        next_hour = hourly[1] if len(hourly) > 1 else None

        # 判断未来2小时内天气是否变化（比较前2个小时的天气文字）
        weather_change = False
        for i in range(1, min(len(hourly), 3)):
            if hourly[i].text != current.text:
                weather_change = True
                break

        entry = {
            "street": street,
            "current_text": current.text,
            "current_icon": current.icon,
        }
        if next_hour:
            entry["next_hour_text"] = next_hour.text
            entry["next_hour_icon"] = next_hour.icon
        else:
            entry["next_hour_text"] = None
            entry["next_hour_icon"] = None
        entry["weather_change"] = weather_change

        summary.append(entry)
    return summary


@router.get("/streets")
async def get_streets():
    """获取金山区所有街道列表"""
    return {
        name: {"lat": info["lat"], "lon": info["lon"]}
        for name, info in JINSHAN_STREETS.items()
    }
