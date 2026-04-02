from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 和风天气API
    QWEATHER_API_KEY: str = ""
    QWEATHER_API_HOST: str = "https://devapi.qweather.com"
    QWEATHER_CREDENTIAL_ID: str = ""

    # 金山地区中心坐标
    LOCATION_LAT: float = 30.7413
    LOCATION_LON: float = 121.3420
    LOCATION_NAME: str = "上海金山"

    # 预警阈值（出力下降比例）
    WARNING_LEVEL_BLUE: float = 0.30
    WARNING_LEVEL_YELLOW: float = 0.50
    WARNING_LEVEL_ORANGE: float = 0.70
    WARNING_LEVEL_RED: float = 0.85

    # 有效发电时段
    GENERATION_START_HOUR: int = 9
    GENERATION_END_HOUR: int = 16

    # 预警提前量（小时）
    WARNING_LEAD_HOURS: int = 2

    # 轮询间隔（秒）
    POLL_INTERVAL_SECONDS: int = 3600

    # 应用配置
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    DEBUG: bool = True

    # 数据文件路径
    PV_USERS_FILE: str = "data/pv_users.json"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
