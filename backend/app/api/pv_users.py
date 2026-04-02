from fastapi import APIRouter

from app.services.aggregation import AggregationService

router = APIRouter()
agg_service = AggregationService()


@router.get("/list")
async def get_all_users():
    """获取所有光伏用户"""
    return [u.model_dump() for u in agg_service.get_all_users()]


@router.get("/street/{street}")
async def get_users_by_street(street: str):
    """获取指定街道的光伏用户"""
    users = agg_service.get_users_by_street(street)
    return [u.model_dump() for u in users]


@router.get("/aggregation")
async def get_all_aggregations():
    """获取所有街道聚合数据"""
    return [a.model_dump() for a in agg_service.get_all_street_aggregations()]


@router.get("/summary")
async def get_summary():
    """获取全区光伏概况"""
    aggs = agg_service.get_all_street_aggregations()
    users = agg_service.get_all_users()
    return {
        "total_users": len(users),
        "active_users": sum(1 for u in users if u.status == "运行"),
        "total_capacity_kw": round(agg_service.get_total_capacity_kw(), 2),
        "streets": len(aggs),
        "by_street": [a.model_dump() for a in aggs],
    }
