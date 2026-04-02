from pydantic import BaseModel


class WarningRecord(BaseModel):
    """预警记录"""
    id: str
    level: str                  # red/orange/yellow/blue
    label: str                  # I级（红色）等
    street: str                 # 预警街道
    action: str                 # 建议措施
    drop_ratio: float           # 最大下降比例
    from_time: str              # 骤降起始时间
    to_time: str                # 骤降结束时间
    from_power_kw: float        # 骤降前出力
    to_power_kw: float          # 骤降后出力
    issued_at: str              # 预警发布时间
    weather_from: str           # 天气变化：从
    weather_to: str             # 天气变化：到


class PowerPrediction(BaseModel):
    """单时段出力预测"""
    time: str
    clearsky_ratio: float       # 晴空理论出力比(0-1)
    weather_factor: float       # 天气出力系数
    predicted_power_kw: float   # 预测出力 kW
    weather_text: str           # 天气描述
    weather_icon: int           # 天气代码
