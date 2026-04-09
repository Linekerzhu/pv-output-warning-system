from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # 和风天气API
    QWEATHER_API_KEY: str = ""
    QWEATHER_API_HOST: str = "https://mh7fc34mwn.re.qweatherapi.com"
    QWEATHER_CREDENTIAL_ID: str = ""

    # 金山地区中心坐标
    LOCATION_LAT: float = 30.7413
    LOCATION_LON: float = 121.3420
    LOCATION_NAME: str = "上海金山"

    # 光伏系统性能比 (Performance Ratio)
    # 综合效率：逆变器(96%) × 系统损耗(86%) × 温度(~97%) ≈ 0.80
    PV_PERFORMANCE_RATIO: float = 0.80

    # 预警阈值 — 出力骤变占装机容量的比例
    # 40%: 只有强对流/极端天气才触发，正常天气不触发
    WARNING_SWING_THRESHOLD: float = 0.40

    # 有效发电时段（晴空模型计算范围，覆盖日出到日落）
    GENERATION_START_HOUR: int = 5
    GENERATION_END_HOUR: int = 19

    # 轮询间隔（秒）
    POLL_INTERVAL_SECONDS: int = 3600

    # 应用配置
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    DEBUG: bool = True

    # 数据文件路径
    PV_USERS_FILE: str = "data/pv_users.json"

    # PostgreSQL
    DATABASE_URL: str = "postgresql://pvuser:pvpass@localhost:5432/pv_warning"

    # JAXA P-Tree FTP (向日葵卫星数据)
    JAXA_FTP_HOST: str = "ftp.ptree.jaxa.jp"
    JAXA_FTP_USER: str = ""
    JAXA_FTP_PASS: str = ""

    model_config = {
        "env_file": [".env", "../.env"],
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


settings = Settings()
