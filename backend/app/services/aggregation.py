"""按街道聚合光伏用户数据"""

import json
from pathlib import Path

from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS
from app.models.pv_user import PVUser, StreetAggregation


class AggregationService:
    """光伏用户数据管理与街道聚合"""

    def __init__(self):
        self._users: list[PVUser] = []
        self._load_users()

    def _load_users(self):
        """从JSON文件加载光伏用户数据"""
        file_path = Path(settings.PV_USERS_FILE)
        if not file_path.exists():
            # 尝试相对于backend目录
            file_path = Path(__file__).parent.parent.parent.parent / settings.PV_USERS_FILE
        if not file_path.exists():
            logger.warning(f"光伏用户数据文件不存在: {file_path}")
            return

        with open(file_path, encoding="utf-8") as f:
            data = json.load(f)
        self._users = [PVUser(**item) for item in data]
        logger.info(f"加载 {len(self._users)} 个光伏用户")

    def get_all_users(self) -> list[PVUser]:
        return self._users

    def get_users_by_street(self, street: str) -> list[PVUser]:
        return [u for u in self._users if u.street == street]

    def get_street_aggregation(self, street: str) -> StreetAggregation | None:
        """获取指定街道的聚合数据"""
        users = self.get_users_by_street(street)
        if not users:
            return None

        active = [u for u in users if u.status == "运行"]
        street_info = JINSHAN_STREETS.get(street, {})

        return StreetAggregation(
            street=street,
            total_capacity_kw=sum(u.capacity_kw for u in active),
            active_users=len(active),
            total_users=len(users),
            center_lat=street_info.get("lat", 0),
            center_lon=street_info.get("lon", 0),
        )

    def get_all_street_aggregations(self) -> list[StreetAggregation]:
        """获取所有街道的聚合数据"""
        results = []
        for street in JINSHAN_STREETS:
            agg = self.get_street_aggregation(street)
            if agg:
                results.append(agg)
        return results

    def get_total_capacity_kw(self) -> float:
        """获取全区总装机容量（运行中）"""
        return sum(
            u.capacity_kw for u in self._users if u.status == "运行"
        )
