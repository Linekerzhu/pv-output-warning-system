"""Tests for DataCollector service"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timezone, timedelta

from app.services.data_collector import DataCollector
from app.models.weather_data import HourlyWeather, WeatherForecast


def make_hourly(hour: int, text: str = "晴", icon: int = 100) -> HourlyWeather:
    return HourlyWeather(
        time=f"2026-04-04 {hour:02d}:00",
        icon=icon, text=text, temp=25.0,
        humidity=50, cloud=10, pop=0,
        wind_speed=5.0, precip=0.0,
    )


class TestCollectWeatherForecasts:
    @pytest.mark.asyncio
    async def test_fetches_all_streets_and_writes_db(self):
        collector = DataCollector.__new__(DataCollector)
        collector.weather_service = MagicMock()
        collector.solar_service = MagicMock()
        collector.aggregation_service = MagicMock()

        forecast = WeatherForecast(
            street="石化街道",
            update_time="2026-04-04T10:00",
            hourly=[make_hourly(10), make_hourly(11)],
        )
        collector.weather_service.get_hourly_forecast = AsyncMock(return_value=forecast)

        mock_conn = AsyncMock()
        mock_conn.executemany = AsyncMock()
        mock_pool = MagicMock()
        mock_pool.acquire = MagicMock(return_value=AsyncMock(
            __aenter__=AsyncMock(return_value=mock_conn),
            __aexit__=AsyncMock(return_value=False),
        ))

        with patch("app.services.data_collector.get_pool", return_value=mock_pool):
            await collector._collect_street_weather("shihua", "石化街道")

        assert mock_conn.executemany.called
