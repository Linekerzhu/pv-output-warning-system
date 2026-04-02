"""天气代码→出力系数映射表及预警等级定义"""

# 和风天气代码 → 光伏出力系数
# 参考: https://dev.qweather.com/docs/resource/icons/
WEATHER_OUTPUT_MAP: dict[int, float] = {
    # 晴
    100: 1.0,
    150: 1.0,
    # 少云
    101: 0.85,
    151: 0.85,
    # 晴间多云
    102: 0.75,
    152: 0.75,
    # 多云
    103: 0.70,
    153: 0.70,
    # 阴
    104: 0.40,
}

# 按代码段批量映射
WEATHER_RANGE_MAP: list[tuple[int, int, float, str]] = [
    # (起始代码, 结束代码, 出力系数, 类型描述)
    (300, 318, 0.10, "降雨"),
    (350, 351, 0.10, "降雨"),
    (399, 399, 0.10, "降雨"),
    (400, 410, 0.10, "降雪"),
    (456, 457, 0.10, "降雪"),
    (499, 499, 0.10, "降雪"),
    (500, 515, 0.15, "雾霾沙尘"),
]

# 默认出力系数（未知天气）
DEFAULT_OUTPUT_FACTOR = 0.50


def get_weather_output_factor(icon_code: int) -> float:
    """根据和风天气代码获取光伏出力系数"""
    # 精确匹配
    if icon_code in WEATHER_OUTPUT_MAP:
        return WEATHER_OUTPUT_MAP[icon_code]

    # 范围匹配
    for start, end, factor, _ in WEATHER_RANGE_MAP:
        if start <= icon_code <= end:
            return factor

    return DEFAULT_OUTPUT_FACTOR


# 金山区街镇列表及中心坐标
JINSHAN_STREETS: dict[str, dict] = {
    "石化街道": {"lat": 30.7279, "lon": 121.3425, "location_id": ""},
    "朱泾镇": {"lat": 30.8947, "lon": 121.1736, "location_id": ""},
    "枫泾镇": {"lat": 30.8911, "lon": 121.0072, "location_id": ""},
    "张堰镇": {"lat": 30.8456, "lon": 121.2017, "location_id": ""},
    "亭林镇": {"lat": 30.8839, "lon": 121.2833, "location_id": ""},
    "吕巷镇": {"lat": 30.8494, "lon": 121.1056, "location_id": ""},
    "廊下镇": {"lat": 30.7806, "lon": 121.0750, "location_id": ""},
    "金山卫镇": {"lat": 30.7375, "lon": 121.2750, "location_id": ""},
    "漕泾镇": {"lat": 30.7806, "lon": 121.3639, "location_id": ""},
    "山阳镇": {"lat": 30.7500, "lon": 121.3833, "location_id": ""},
    "金山工业区": {"lat": 30.7533, "lon": 121.2500, "location_id": ""},
}

# 预警等级描述
WARNING_LEVELS = {
    "red": {"label": "I级（红色）", "threshold": 0.85, "action": "紧急调度，切换备用电源"},
    "orange": {"label": "II级（橙色）", "threshold": 0.70, "action": "启动备用电源，调整负荷分配"},
    "yellow": {"label": "III级（黄色）", "threshold": 0.50, "action": "启动备用电源预热"},
    "blue": {"label": "IV级（蓝色）", "threshold": 0.30, "action": "关注气象变化，做好调度准备"},
}
