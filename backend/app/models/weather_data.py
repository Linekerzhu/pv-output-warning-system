from pydantic import BaseModel


class HourlyWeather(BaseModel):
    """逐小时气象数据"""
    time: str                   # 预报时间 yyyy-MM-dd HH:mm
    icon: int                   # 天气代码
    text: str                   # 天气描述
    temp: float                 # 温度 °C
    humidity: int               # 湿度 %
    cloud: int                  # 云量 %
    pop: int = 0                # 降水概率 %
    wind_speed: float = 0       # 风速 km/h
    precip: float = 0           # 降水量 mm


class WeatherForecast(BaseModel):
    """天气预报响应"""
    street: str
    update_time: str
    hourly: list[HourlyWeather]
