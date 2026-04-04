"""历史天气数据服务 + 回测

历史路径没有真实GHI数据（和风无历史太阳辐射API），
因此使用 pvlib晴空GHI × 天气图标衰减系数 来估算GHI。
这是 icon→factor 映射在系统中唯一的使用场景。
"""

import json
from datetime import date, timedelta, timezone, datetime
from pathlib import Path

import httpx
from loguru import logger

from app.core.config import settings
from app.core.constants import (
    JINSHAN_LOCATION_ID, JINSHAN_STREETS,
    get_historical_weather_reduction,
)
from app.models.weather_data import HourlyWeather
from app.models.warning_record import PowerPrediction, WarningRecord
from app.services.forecast import ForecastService
from app.services.solar import SolarService
from app.services.warning import WarningService

HISTORY_DIR = Path("data/history")


class HistoricalWeatherService:
    """历史天气获取、GHI估算、回测"""

    def __init__(self):
        self.api_key = settings.QWEATHER_API_KEY
        self.base_url = settings.QWEATHER_API_HOST
        self.solar_service = SolarService()
        self.forecast_service = ForecastService()
        self.warning_service = WarningService()

    def _cache_path(self, target_date: date) -> Path:
        return HISTORY_DIR / f"{target_date.strftime('%Y%m%d')}.json"

    async def fetch_historical_weather(self, target_date: date) -> list[HourlyWeather] | None:
        """从和风历史天气API获取实际观测数据"""
        date_str = target_date.strftime("%Y%m%d")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    f"{self.base_url}/v7/historical/weather",
                    params={
                        "location": JINSHAN_LOCATION_ID,
                        "date": date_str,
                        "key": self.api_key,
                    },
                    headers={"Accept-Encoding": "gzip"},
                )
                resp.raise_for_status()
                data = resp.json()

            if data.get("code") != "200":
                error = data.get("error", {})
                logger.error(f"历史天气API错误: {error.get('title', data.get('code'))}")
                return None

            hourly = []
            for item in data.get("weatherHourly", []):
                time_str = item["time"][:16].replace("T", " ")
                hourly.append(HourlyWeather(
                    time=time_str,
                    icon=int(item["icon"]),
                    text=item["text"],
                    temp=float(item["temp"]),
                    humidity=int(item.get("humidity", 50)),
                    cloud=0,
                    pop=0,
                    wind_speed=float(item.get("windSpeed", 0)),
                    precip=float(item.get("precip", 0)),
                ))
            return hourly

        except Exception as e:
            logger.error(f"获取历史天气失败 date={date_str}: {e}")
            return None

    async def get_historical_weather(self, target_date: date) -> list[HourlyWeather] | None:
        """获取历史天气，优先缓存"""
        cache_file = self._cache_path(target_date)
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                return [HourlyWeather(**item) for item in data]
            except Exception as e:
                logger.warning(f"缓存读取失败: {e}")

        hourly = await self.fetch_historical_weather(target_date)
        if hourly is None:
            return None

        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_file.write_text(
            json.dumps([h.model_dump() for h in hourly], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return hourly

    def estimate_ghi_from_weather(
        self, target_date: date, hourly: list[HourlyWeather],
        lat: float, lon: float,
    ) -> dict[int, float]:
        """用pvlib晴空GHI × 天气图标衰减系数 估算历史GHI

        这是 icon→reduction 映射在系统中唯一的使用场景。
        """
        clearsky = self.solar_service.get_clearsky_ghi(target_date, lat, lon)

        weather_map: dict[int, int] = {}  # hour → icon
        for h in hourly:
            try:
                hour = int(h.time.split(" ")[1].split(":")[0])
                weather_map[hour] = h.icon
            except (IndexError, ValueError):
                continue

        estimated: dict[int, float] = {}
        for hour, clearsky_ghi in clearsky.items():
            icon = weather_map.get(hour)
            if icon is None:
                continue
            reduction = get_historical_weather_reduction(icon)
            estimated[hour] = round(clearsky_ghi * reduction, 1)

        return estimated

    async def backtest_date(self, target_date: date) -> dict:
        """对指定日期进行回测"""
        hourly = await self.get_historical_weather(target_date)
        if not hourly:
            return {"date": str(target_date), "predictions": {},
                    "warnings": [], "error": "无法获取历史天气数据"}

        all_predictions: dict[str, list[dict]] = {}
        all_warnings: list[WarningRecord] = []

        for street in JINSHAN_STREETS:
            agg = self.forecast_service.aggregation_service.get_street_aggregation(street)
            if not agg or agg.total_capacity_kw == 0:
                continue

            # 估算 GHI
            estimated_ghi = self.estimate_ghi_from_weather(
                target_date, hourly, agg.center_lat, agg.center_lon,
            )

            # 通过 ForecastService 的通用方法构建预测
            predictions = self.forecast_service.predict_from_weather(
                street, hourly, estimated_ghi, target_date, is_estimated=True,
            )

            all_predictions[street] = [p.model_dump() for p in predictions]

            # 通过 WarningService 的唯一检测入口检测预警
            capacity = agg.total_capacity_kw if agg else 0
            warnings = self.warning_service.evaluate_predictions(
                street, predictions, capacity, is_historical=True,
            )
            all_warnings.extend(warnings)

        level_order = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}
        all_warnings.sort(key=lambda w: (level_order.get(w.level, 9), w.from_time))

        return {
            "date": str(target_date),
            "weather_hourly": [h.model_dump() for h in hourly],
            "predictions": all_predictions,
            "warnings": [w.model_dump() for w in all_warnings],
            "summary": {
                "total_warnings": len(all_warnings),
                "by_level": {
                    level: sum(1 for w in all_warnings if w.level == level)
                    for level in ["red", "orange", "yellow", "blue"]
                },
            },
            "data_source": "estimated_ghi (pvlib clearsky × icon reduction)",
        }

    async def backtest_range(self, start_date: date, end_date: date) -> list[dict]:
        results = []
        current = start_date
        while current <= end_date:
            results.append(await self.backtest_date(current))
            current += timedelta(days=1)
        return results
