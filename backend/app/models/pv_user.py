from pydantic import BaseModel


class PVUser(BaseModel):
    """光伏用户数据模型"""
    id: str
    name: str                  # 用户/项目名称
    address: str               # 详细地址
    street: str                # 所属街镇
    lat: float                 # 纬度
    lon: float                 # 经度
    capacity_kw: float         # 装机容量 (kW)
    status: str = "运行"       # 状态: 运行/停运


class StreetAggregation(BaseModel):
    """街道聚合数据"""
    street: str
    total_capacity_kw: float
    active_users: int
    total_users: int
    center_lat: float
    center_lon: float
