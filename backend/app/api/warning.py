from datetime import date

from fastapi import APIRouter

from app.services.warning import WarningService

router = APIRouter()
warning_service = WarningService()


@router.get("/current")
async def get_current_warnings():
    """获取当前有效预警"""
    return [w.model_dump() for w in warning_service.get_active_warnings()]


@router.get("/history")
async def get_warning_history():
    """获取历史预警记录"""
    return [w.model_dump() for w in warning_service.get_history()]


@router.post("/evaluate")
async def evaluate_warnings(target_date: date | None = None):
    """手动触发全区预警评估"""
    warnings = await warning_service.evaluate_all(target_date)
    return {
        "total_warnings": len(warnings),
        "warnings": [w.model_dump() for w in warnings],
    }
