"""天气代码→出力系数映射表及预警等级定义"""

from datetime import timedelta, timezone

SHANGHAI_TZ = timezone(timedelta(hours=8))
TIME_FORMAT = "%Y-%m-%d %H:%M"
HOUR_FORMAT = "%Y-%m-%d %H:00"

JINSHAN_LOCATION_ID = "101020700"

# ── 历史回测专用：天气图标→GHI衰减估算系数 ────────────────
# 仅在无真实GHI数据时（历史回测）使用，实时预测使用太阳辐射API的GHI
HISTORICAL_WEATHER_REDUCTION: dict[int, float] = {
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

# ── 历史回测专用：按代码段批量映射 ────────────────
# 仅在无真实GHI数据时（历史回测）使用
HISTORICAL_RANGE_MAP: list[tuple[int, int, float, str]] = [
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


def get_historical_weather_reduction(icon_code: int) -> float:
    """历史回测用：根据天气图标估算GHI相对晴空的衰减比

    仅在无真实GHI数据时使用。实时路径使用太阳辐射预报API。
    """
    # 精确匹配
    if icon_code in HISTORICAL_WEATHER_REDUCTION:
        return HISTORICAL_WEATHER_REDUCTION[icon_code]

    # 范围匹配
    for start, end, factor, _ in HISTORICAL_RANGE_MAP:
        if start <= icon_code <= end:
            return factor

    return DEFAULT_OUTPUT_FACTOR


# 金山区街镇列表 — 坐标为各镇政府所在地 (WGS84)
JINSHAN_STREETS: dict[str, dict] = {
    "石化街道": {"lat": 30.7145, "lon": 121.3399},  # 卫零路485号
    "朱泾镇":   {"lat": 30.8906, "lon": 121.1711},  # 人民路310号
    "枫泾镇":   {"lat": 30.8908, "lon": 121.0101},  # 新泾路95号
    "张堰镇":   {"lat": 30.8039, "lon": 121.2961},  # 康德路328号
    "亭林镇":   {"lat": 30.8906, "lon": 121.3084},  # 华亭路25号
    "吕巷镇":   {"lat": 30.8339, "lon": 121.2009},  # 朱吕公路6888号
    "廊下镇":   {"lat": 30.7919, "lon": 121.1871},  # 景乐路228号
    "金山卫镇": {"lat": 30.7271, "lon": 121.3094},  # 古城路295号
    "漕泾镇":   {"lat": 30.7930, "lon": 121.4202},  # 漕廊公路398号
    "山阳镇":   {"lat": 30.7630, "lon": 121.3518},  # 龙皓路28号
}

# 预警描述（单级预警）
WARNING_LABEL = "出力骤变预警"
WARNING_ACTION = "关注气象变化，启动调度预案"

# 街道名→station_id映射（用于数据库）
STREET_TO_STATION_ID: dict[str, str] = {
    "石化街道": "shihua",
    "朱泾镇": "zhujing",
    "枫泾镇": "fengjing",
    "张堰镇": "zhangyan",
    "亭林镇": "tinglin",
    "吕巷镇": "lvxiang",
    "廊下镇": "langxia",
    "金山卫镇": "jinshanwei",
    "漕泾镇": "caojing",
    "山阳镇": "shanyang",
}

STATION_ID_TO_STREET: dict[str, str] = {v: k for k, v in STREET_TO_STATION_ID.items()}
