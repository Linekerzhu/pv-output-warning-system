from pydantic import BaseModel


class WarningRecord(BaseModel):
    """预警记录"""
    id: str
    level: str                  # red/orange/yellow/blue
    label: str                  # I级（红色）等
    type: str                   # ramp_down / ramp_up
    street: str                 # 预警街道
    action: str                 # 建议措施
    change_rate: float          # weather_ratio 变化率 (0-1)
    abs_change_kw: float        # 绝对出力变化量 kW
    from_time: str
    to_time: str
    from_power_kw: float
    to_power_kw: float
    issued_at: str
    weather_from: str
    weather_to: str


class PowerPrediction(BaseModel):
    """单时段出力预测 — 基于GHI"""
    time: str
    ghi: float                  # 预测/实测 GHI (W/m²)
    clearsky_ghi: float         # 晴空理论 GHI (W/m²)
    weather_ratio: float        # ghi / clearsky_ghi (0-1)，天气对出力的衰减比
    power_kw: float             # 预测出力 = capacity × GHI / 1000
    clearsky_power_kw: float    # 晴空出力 = capacity × clearsky_GHI / 1000
    weather_text: str           # 天气描述（来自天气预报，仅展示用）
    weather_icon: int           # 天气代码（仅展示用）
    is_estimated: bool = False  # True=历史回测估算值, False=来自辐射预报API
