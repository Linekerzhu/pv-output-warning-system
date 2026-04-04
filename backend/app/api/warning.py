from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from app.core.constants import SHANGHAI_TZ
from app.repositories.warning_repo import WarningRepo
from app.services.data_collector import DataCollector

router = APIRouter()
warning_repo = WarningRepo()


def _row_to_dict(row) -> dict:
    issued_at: datetime = row["issued_at"]
    issued_at_sh = issued_at.astimezone(SHANGHAI_TZ).isoformat()
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
        "issued_at": issued_at_sh,
        "weather_from": row["weather_from"],
        "weather_to": row["weather_to"],
    }


@router.get("/current")
async def get_current_warnings():
    """获取当前有效预警"""
    rows = await warning_repo.get_active_warnings()
    return [_row_to_dict(r) for r in rows]


@router.get("/history")
async def get_warning_history():
    """获取历史预警记录（最近7天）"""
    cutoff = datetime.now(SHANGHAI_TZ) - timedelta(days=7)
    rows = await warning_repo.get_warning_history(cutoff)
    return [_row_to_dict(r) for r in rows]


@router.post("/evaluate")
async def evaluate_warnings():
    """手动触发全区预警评估，返回当前有效预警"""
    collector = DataCollector()
    await collector.collect_and_evaluate()

    rows = await warning_repo.get_active_warnings()
    warnings = [_row_to_dict(r) for r in rows]
    return {
        "total_warnings": len(warnings),
        "warnings": warnings,
    }
