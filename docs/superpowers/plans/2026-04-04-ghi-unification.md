# GHI Unification + Historical Backtest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the entire system to use GHI (Global Horizontal Irradiance) as the single source of truth for power prediction and warning detection. Remove the legacy icon→factor mapping from the real-time path. Add historical backtest using estimated GHI.

**Architecture:** Backend fetches GHI from QWeather solar radiation forecast API, computes `power = capacity × GHI / 1000`, derives `weather_ratio = GHI / clearsky_GHI` for warning detection. Frontend becomes pure display. For historical backtest (no GHI API available), estimate GHI from pvlib clearsky × icon-based reduction factor, clearly marked as estimation.

**Tech Stack:** Python/FastAPI, QWeather Solar Radiation API, pvlib, React/TypeScript

---

## Why This Refactor

### Current broken state

| Component | Data Source | Power Formula | Warning Basis |
|-----------|-----------|--------------|---------------|
| PowerChart (backend) | icon→factor mapping | clearsky × factor | weather_factor change |
| OutputChart (frontend) | Solar radiation API GHI | area × GHI / 1000 | (deleted engine) |

**These are two different calculations showing different numbers to the same user.**

### Target state

| Component | Data Source | Power Formula | Warning Basis |
|-----------|-----------|--------------|---------------|
| Everything (backend) | Solar radiation API GHI | capacity × GHI / 1000 | weather_ratio change |
| Frontend | Display only | N/A | N/A |
| Historical backtest | pvlib × icon reduction | capacity × estimated_GHI / 1000 | weather_ratio change |

### Key formula

```
power_kw = capacity_kw × GHI / 1000

At STC (GHI=1000 W/m²): power = capacity_kw × 1.0 = rated capacity ✓
At GHI=500 (cloudy noon): power = capacity_kw × 0.5 ✓

weather_ratio = forecast_GHI / clearsky_GHI
  - Clear sky: ratio ≈ 1.0
  - Overcast:  ratio ≈ 0.3-0.5
  - Rain:      ratio ≈ 0.05-0.15
  - Sunrise/sunset: ratio stays ~same (both GHI and clearsky drop together)
```

**NOTE: The frontend's existing formula `panelAreaM2 × GHI / 1000` is wrong — it gives total solar irradiance, not electrical output (missing ×efficiency). The correct formula `capacity × GHI / 1000` already includes efficiency through the capacity rating.**

---

## File Structure

### Backend — Rewrite
| File | Change |
|------|--------|
| `models/warning_record.py` | Replace `weather_factor` with `ghi`, `clearsky_ghi`, `weather_ratio` |
| `services/forecast.py` | Rewrite: fetch GHI from solar radiation API, compute power from GHI |
| `services/warning.py` | Update: use `weather_ratio` (from GHI) instead of `weather_factor` (from icon) |
| `core/constants.py` | Move icon→factor to `HISTORICAL_WEATHER_REDUCTION` section |
| `core/config.py` | Add `PANEL_EFFICIENCY` |
| `tests/test_warning.py` | Update test fixtures to use GHI-based predictions |

### Backend — New (History)
| File | Responsibility |
|------|---------------|
| `services/history.py` | Fetch historical weather, estimate GHI, run backtest |
| `api/history.py` | REST endpoints for backtest |

### Backend — Modify
| File | Change |
|------|--------|
| `main.py` | Register history router |

### Frontend — Update
| File | Change |
|------|--------|
| `api.ts` | Update `PowerPrediction`, `WarningRecord` types |
| `components/PowerChart.tsx` | Update field names |
| `components/WeatherPanel.tsx` | Remove local GHI computation, use backend power data |
| `components/OutputChart.tsx` | Use backend WarningRecord (already done, minor field name update) |
| `components/StreetPanel.tsx` | `weather_factor` → `weather_ratio` |

### Frontend — New
| File | Responsibility |
|------|---------------|
| `components/HistoryPanel.tsx` | Date picker + backtest results |

### Delete
| What | Why |
|------|-----|
| `WEATHER_OUTPUT_MAP` main usage | Replaced by GHI |
| `get_weather_output_factor()` main usage | Replaced by GHI |
| Frontend local power calculation | Backend is source of truth |

---

## Task 1: Update PowerPrediction Model

**Files:**
- Modify: `backend/app/models/warning_record.py`

- [ ] **Step 1: Rewrite PowerPrediction to GHI-based**

```python
# backend/app/models/warning_record.py
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
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/models/warning_record.py
git commit -m "refactor: PowerPrediction model based on GHI instead of icon-factor"
```

---

## Task 2: Rewrite ForecastService to Use GHI

**Files:**
- Rewrite: `backend/app/services/forecast.py`
- Modify: `backend/app/services/weather.py` (add helper)

- [ ] **Step 1: Rewrite ForecastService**

```python
# backend/app/services/forecast.py
"""光伏出力预测服务 — 基于GHI太阳辐射数据

核心公式: power_kw = capacity_kw × GHI / 1000
  - GHI来自和风太阳辐射预报API（实时路径）
  - 或来自pvlib晴空模型×天气衰减估算（历史回测路径）

weather_ratio = forecast_GHI / clearsky_GHI
  - 接近1.0: 晴空，光伏满发
  - 0.3-0.5: 多云/阴天
  - <0.15: 降雨/浓雾
  - 日出日落时ratio保持稳定（两者同步变化），不会误触预警
"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.constants import JINSHAN_STREETS
from app.models.warning_record import PowerPrediction
from app.models.weather_data import HourlyWeather
from app.services.aggregation import AggregationService
from app.services.solar import SolarService
from app.services.weather import WeatherService


class ForecastService:
    """基于GHI的光伏出力预测"""

    def __init__(self):
        self.weather_service = WeatherService()
        self.solar_service = SolarService()
        self.aggregation_service = AggregationService()

    # ── 唯一的预测计算入口 ─────────────────────────────

    def predict_from_weather(
        self, street: str, hourly: list[HourlyWeather],
        ghi_values: dict[int, float], target_date: date,
        is_estimated: bool = False,
    ) -> list[PowerPrediction]:
        """基于给定天气和GHI数据预测出力 — 实时和历史的唯一计算入口

        Args:
            street: 街道名
            hourly: 天气数据（仅用于 text/icon 展示）
            ghi_values: {hour: ghi_value} 映射
            target_date: 目标日期
            is_estimated: True=历史估算GHI, False=来自辐射预报API
        """
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        capacity = agg.total_capacity_kw
        clearsky_curve = self.solar_service.get_clearsky_ghi(
            target_date, agg.center_lat, agg.center_lon
        )
        date_str = str(target_date)

        # 天气文字映射（仅展示用）
        weather_map: dict[int, tuple[str, int]] = {}
        for hw in hourly:
            try:
                hour = int(hw.time.split(" ")[1].split(":")[0])
                weather_map[hour] = (hw.text, hw.icon)
            except (IndexError, ValueError):
                continue

        predictions = []
        for hour, clearsky_ghi in sorted(clearsky_curve.items()):
            ghi = ghi_values.get(hour)
            if ghi is None or clearsky_ghi <= 0:
                continue

            weather_ratio = min(ghi / clearsky_ghi, 1.5)
            power_kw = capacity * ghi / 1000
            clearsky_power_kw = capacity * clearsky_ghi / 1000
            weather_text, weather_icon = weather_map.get(hour, ("--", 999))

            predictions.append(PowerPrediction(
                time=f"{date_str} {hour:02d}:00",
                ghi=round(ghi, 1),
                clearsky_ghi=round(clearsky_ghi, 1),
                weather_ratio=round(weather_ratio, 4),
                power_kw=round(power_kw, 2),
                clearsky_power_kw=round(clearsky_power_kw, 2),
                weather_text=weather_text,
                weather_icon=weather_icon,
                is_estimated=is_estimated,
            ))

        return predictions

    # ── 实时预测（获取数据 → 调用 predict_from_weather）────

    async def _fetch_district_ghi(self, hours: int = 48) -> dict[str, float]:
        """获取全区GHI辐射预报（只调一次，所有街道共用）

        Returns:
            {"YYYY-MM-DD HH": ghi_wm2} 映射，失败返回空dict
        """
        from app.core.config import settings
        radiation = await self.weather_service.get_solar_radiation(
            lat=settings.LOCATION_LAT, lon=settings.LOCATION_LON, hours=hours
        )
        ghi_map: dict[str, float] = {}
        if radiation and radiation.forecasts:
            for r in radiation.forecasts:
                try:
                    parts = r.time.split(" ")
                    hour = int(parts[1].split(":")[0])
                    key = f"{parts[0]} {hour:02d}"
                    ghi_map[key] = r.ghi
                except (IndexError, ValueError):
                    continue
        if not ghi_map:
            logger.error("太阳辐射API无数据或请求失败")
        return ghi_map

    async def predict_street_power(
        self, street: str, target_date: date | None = None,
        ghi_map: dict[str, float] | None = None,
    ) -> list[PowerPrediction]:
        """预测指定街道出力

        Args:
            ghi_map: 预获取的GHI数据，如果为None则自行获取
        """
        agg = self.aggregation_service.get_street_aggregation(street)
        if not agg or agg.total_capacity_kw == 0:
            return []

        now_shanghai = datetime.now(timezone(timedelta(hours=8)))
        today = target_date or now_shanghai.date()
        tomorrow = today + timedelta(days=1)

        # GHI：使用传入的或自行获取（单街道调用场景）
        if ghi_map is None:
            ghi_map = await self._fetch_district_ghi(hours=48)

        # 天气预报（仅用于展示 text/icon，不参与出力计算）
        weather_forecast = await self.weather_service.get_hourly_forecast(street)
        hourly = weather_forecast.hourly if weather_forecast else []

        # 对今天和明天分别调用唯一计算入口
        predictions = []
        for d in [today, tomorrow]:
            # 提取当天的 {hour: ghi}
            date_str = str(d)
            day_ghi: dict[int, float] = {}
            for key, ghi in ghi_map.items():
                if key.startswith(date_str):
                    try:
                        hour = int(key.split(" ")[1])
                        day_ghi[hour] = ghi
                    except (IndexError, ValueError):
                        continue

            predictions.extend(
                self.predict_from_weather(street, hourly, day_ghi, d)
            )

        return predictions

    async def predict_all_streets(
        self, target_date: date | None = None
    ) -> dict[str, list[PowerPrediction]]:
        """预测所有街道 — GHI只获取一次，分发给所有街道"""
        ghi_map = await self._fetch_district_ghi(hours=48)

        results = {}
        for street in JINSHAN_STREETS:
            predictions = await self.predict_street_power(
                street, target_date, ghi_map=ghi_map
            )
            if predictions:
                results[street] = predictions
        return results

    async def get_district_total_prediction(
        self, target_date: date | None = None
    ) -> list[dict]:
        all_predictions = await self.predict_all_streets(target_date)

        hour_totals: dict[str, float] = {}
        hour_clearsky: dict[str, float] = {}

        for street, predictions in all_predictions.items():
            for p in predictions:
                hour_totals[p.time] = hour_totals.get(p.time, 0) + p.power_kw
                hour_clearsky[p.time] = hour_clearsky.get(p.time, 0) + p.clearsky_power_kw

        total_capacity = self.aggregation_service.get_total_capacity_kw()

        return [
            {
                "time": time,
                "predicted_power_kw": round(power, 2),
                "clearsky_power_kw": round(hour_clearsky.get(time, 0), 2),
                "total_capacity_kw": total_capacity,
            }
            for time, power in sorted(hour_totals.items())
        ]
```

- [ ] **Step 2: Add `get_clearsky_ghi` to SolarService**

The existing `get_clearsky_curve` returns normalized ratios (0-1). We need actual GHI values (W/m²).

Add to `backend/app/services/solar.py`:

```python
    def get_clearsky_ghi(
        self, target_date: date, lat: float, lon: float
    ) -> dict[int, float]:
        """
        计算指定日期和位置的晴空GHI曲线（绝对值 W/m²）。

        Returns:
            dict[int, float]: {hour: ghi_wm2}，仅包含有效发电时段
        """
        site = pvloc.Location(lat, lon, tz="Asia/Shanghai", altitude=4)

        times = pd.date_range(
            start=f"{target_date} 00:00",
            periods=24,
            freq="h",
            tz="Asia/Shanghai",
        )

        clearsky = site.get_clearsky(times, model="ineichen")
        ghi = clearsky["ghi"]

        result = {}
        for ts, val in ghi.items():
            hour = ts.hour
            if self.start_hour <= hour <= self.end_hour and val > 0:
                result[hour] = round(float(val), 1)

        return result
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/forecast.py backend/app/services/solar.py
git commit -m "refactor: ForecastService uses GHI from solar radiation API"
```

---

## Task 3: Update WarningService for GHI-based weather_ratio

**Files:**
- Modify: `backend/app/services/warning.py`
- Rewrite: `backend/tests/test_warning.py`

- [ ] **Step 1: Update WarningService**

The core detection logic structure stays the same — only the field names change:
- `weather_factor` → `weather_ratio`
- Both represent the same concept: "how much does weather reduce output from theoretical max"
- But `weather_ratio` comes from real GHI physics, not icon lookup

In `backend/app/services/warning.py`, change all references:

```python
# Line 136-152: Replace weather_factor with weather_ratio
                factor_from = curr.weather_ratio
                factor_to = target.weather_ratio
                factor_delta = abs(factor_from - factor_to)

                if factor_delta == 0:
                    continue

                denominator = max(factor_from, factor_to)
                if denominator <= 0:
                    continue

                change_rate = factor_delta / denominator

                clearsky_avg = (curr.clearsky_power_kw + target.clearsky_power_kw) / 2
                abs_change_kw = clearsky_avg * factor_delta
```

Also extract the detection loop into a shared method:

```python
    def evaluate_predictions(
        self, street: str, predictions: list[PowerPrediction],
        is_historical: bool = False,
    ) -> list[WarningRecord]:
        """评估预测数据中的预警 — 唯一的检测入口

        Args:
            is_historical: True时跳过"仅未来时段"的过滤
        """
        if len(predictions) < 2:
            return []

        now_shanghai = datetime.now(timezone(timedelta(hours=8)))
        now_hour = now_shanghai.hour
        warnings: list[WarningRecord] = []
        seen_pairs: set[str] = set()

        for window in [1, 2]:
            for i in range(len(predictions) - window):
                curr = predictions[i]
                target = predictions[i + window]

                curr_date = curr.time.split(" ")[0]
                target_date_str = target.time.split(" ")[0]

                if curr_date != target_date_str:
                    continue

                # 仅未来时段（历史回测跳过此过滤）
                if not is_historical:
                    try:
                        curr_hour = int(curr.time.split(" ")[1].split(":")[0])
                    except (IndexError, ValueError):
                        continue
                    curr_date_obj = date.fromisoformat(curr_date)
                    if curr_date_obj == now_shanghai.date() and curr_hour < now_hour:
                        continue

                # 核心：weather_ratio 变化检测
                ratio_from = curr.weather_ratio
                ratio_to = target.weather_ratio
                ratio_delta = abs(ratio_from - ratio_to)

                if ratio_delta < 0.01:
                    continue

                denominator = max(ratio_from, ratio_to)
                if denominator <= 0:
                    continue

                change_rate = ratio_delta / denominator
                clearsky_avg = (curr.clearsky_power_kw + target.clearsky_power_kw) / 2
                abs_change_kw = clearsky_avg * ratio_delta

                level = self._determine_level(change_rate, abs_change_kw)
                if level is None:
                    continue

                pair_key = f"{curr.time}-{target.time}"
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                warn_type = "ramp_down" if ratio_to < ratio_from else "ramp_up"
                level_info = WARNING_LEVELS[level]

                warning = WarningRecord(
                    id=f"W-{street[:2]}-{now_shanghai.strftime('%Y%m%d%H%M%S')}-{i}-{window}h",
                    level=level,
                    label=level_info["label"],
                    type=warn_type,
                    street=street,
                    action=level_info["action"],
                    change_rate=round(change_rate, 3),
                    abs_change_kw=round(abs_change_kw, 2),
                    from_time=curr.time,
                    to_time=target.time,
                    from_power_kw=curr.power_kw,
                    to_power_kw=target.power_kw,
                    issued_at=now_shanghai.isoformat(),
                    weather_from=curr.weather_text,
                    weather_to=target.weather_text,
                )
                warnings.append(warning)

        return warnings

    async def evaluate_street(
        self, street: str, target_date: date | None = None
    ) -> list[WarningRecord]:
        """评估指定街道 — 调用 predict + evaluate_predictions"""
        predictions = await self.forecast_service.predict_street_power(street, target_date)
        return self.evaluate_predictions(street, predictions)
```

- [ ] **Step 2: Update tests**

```python
# backend/tests/test_warning.py
"""Tests for GHI-based dual-criterion warning engine"""

import pytest
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

from app.models.warning_record import PowerPrediction
from app.services.warning import WarningService


def make_prediction(hour: int, ghi: float, clearsky_ghi: float,
                    capacity_kw: float = 10000, weather_text: str = "晴",
                    target_date: str | None = None,
                    is_estimated: bool = False) -> PowerPrediction:
    d = target_date or str(date.today() + timedelta(days=1))
    weather_ratio = ghi / clearsky_ghi if clearsky_ghi > 0 else 0
    power_kw = capacity_kw * ghi / 1000
    clearsky_power_kw = capacity_kw * clearsky_ghi / 1000
    return PowerPrediction(
        time=f"{d} {hour:02d}:00",
        ghi=ghi,
        clearsky_ghi=clearsky_ghi,
        weather_ratio=round(weather_ratio, 4),
        power_kw=round(power_kw, 2),
        clearsky_power_kw=round(clearsky_power_kw, 2),
        weather_text=weather_text,
        weather_icon=100,
        is_estimated=is_estimated,
    )


class TestDetermineLevel:
    def setup_method(self):
        self.svc = WarningService()

    def test_no_warning_low_rate_low_abs(self):
        assert self.svc._determine_level(0.10, 100) is None

    def test_no_warning_high_rate_low_abs(self):
        assert self.svc._determine_level(0.80, 50) is None

    def test_no_warning_low_rate_high_abs(self):
        assert self.svc._determine_level(0.10, 3000) is None

    def test_blue(self):
        assert self.svc._determine_level(0.25, 300) == "blue"

    def test_yellow(self):
        assert self.svc._determine_level(0.35, 600) == "yellow"

    def test_orange(self):
        assert self.svc._determine_level(0.50, 1200) == "orange"

    def test_red(self):
        assert self.svc._determine_level(0.70, 3000) == "red"

    def test_shortboard_principle(self):
        assert self.svc._determine_level(0.50, 600) == "yellow"


class TestEvaluatePredictions:
    def setup_method(self):
        self.svc = WarningService()

    def test_clear_to_rain_ramp_down(self):
        """GHI drops from 800→80 while clearsky stays ~800 → weather_ratio 1.0→0.1"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(12, ghi=800, clearsky_ghi=820, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
            make_prediction(13, ghi=80, clearsky_ghi=800, capacity_kw=10000,
                          weather_text="暴雨", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        assert len(warnings) >= 1
        assert warnings[0].type == "ramp_down"

    def test_fog_to_clear_ramp_up(self):
        """GHI rises from 50→600 (fog clearing) → ramp_up"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(10, ghi=50, clearsky_ghi=500, capacity_kw=10000,
                          weather_text="雾", target_date=tomorrow),
            make_prediction(11, ghi=600, clearsky_ghi=650, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        assert any(w.type == "ramp_up" for w in warnings)

    def test_no_warning_clear_sky_all_day(self):
        """GHI follows clearsky curve perfectly → ratio ~1.0 throughout → no warning"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(9, ghi=300, clearsky_ghi=310, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
            make_prediction(10, ghi=550, clearsky_ghi=560, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
            make_prediction(11, ghi=750, clearsky_ghi=760, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
            make_prediction(12, ghi=850, clearsky_ghi=860, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        assert len(warnings) == 0

    def test_no_warning_steady_overcast(self):
        """Constant overcast (ratio ~0.35 all day) → no warning"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(10, ghi=180, clearsky_ghi=560, capacity_kw=10000,
                          weather_text="阴", target_date=tomorrow),
            make_prediction(11, ghi=260, clearsky_ghi=760, capacity_kw=10000,
                          weather_text="阴", target_date=tomorrow),
            make_prediction(12, ghi=300, clearsky_ghi=860, capacity_kw=10000,
                          weather_text="阴", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        assert len(warnings) == 0

    def test_cross_day_skipped(self):
        today = str(date.today())
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(16, ghi=300, clearsky_ghi=310, capacity_kw=10000,
                          target_date=today),
            make_prediction(9, ghi=30, clearsky_ghi=310, capacity_kw=10000,
                          target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        assert len(warnings) == 0

    def test_2h_window_gradual_drop(self):
        """GHI drops gradually: 800→500→100. 1h steps may be sub-threshold, 2h catches it."""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(11, ghi=800, clearsky_ghi=820, capacity_kw=10000,
                          weather_text="晴", target_date=tomorrow),
            make_prediction(12, ghi=500, clearsky_ghi=860, capacity_kw=10000,
                          weather_text="多云", target_date=tomorrow),
            make_prediction(13, ghi=100, clearsky_ghi=800, capacity_kw=10000,
                          weather_text="暴雨", target_date=tomorrow),
        ]
        warnings = self.svc.evaluate_predictions("石化街道", predictions, is_historical=True)
        # 2h window: ratio goes from ~0.98 to ~0.125, should trigger
        assert any(w.from_time.endswith("11:00") and w.to_time.endswith("13:00")
                   for w in warnings)
```

- [ ] **Step 3: Run tests**

```bash
cd backend && python3 -m pytest tests/test_warning.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/warning.py backend/tests/test_warning.py
git commit -m "refactor: WarningService uses weather_ratio from GHI"
```

---

## Task 4: Clean Up Constants + Config

**Files:**
- Modify: `backend/app/core/constants.py`
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Reorganize constants.py**

Move `WEATHER_OUTPUT_MAP` and `get_weather_output_factor` under a clearly labeled section for historical estimation only. Add `JINSHAN_LOCATION_ID`.

```python
# At the top of constants.py, add:
JINSHAN_LOCATION_ID = "101020700"

# Rename the section header for the icon→factor mapping:
# ── 历史回测用：天气图标→GHI衰减估算系数 ──────────────
# 仅在无真实GHI数据时（历史回测）使用，不用于实时预测
HISTORICAL_WEATHER_REDUCTION: dict[int, float] = {
    # (same content as WEATHER_OUTPUT_MAP)
    ...
}

def get_historical_weather_reduction(icon_code: int) -> float:
    """历史回测用：根据天气图标估算GHI相对晴空的衰减比"""
    # (same logic as get_weather_output_factor, renamed)
```

Remove old names `WEATHER_OUTPUT_MAP` and `get_weather_output_factor`.

- [ ] **Step 2: Verify no remaining references to old names**

```bash
cd backend && grep -r "WEATHER_OUTPUT_MAP\|get_weather_output_factor" app/ tests/
```

Fix any remaining references to use `HISTORICAL_WEATHER_REDUCTION` / `get_historical_weather_reduction`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/constants.py backend/app/core/config.py
git commit -m "refactor: rename icon-factor mapping to historical-only, add JINSHAN_LOCATION_ID"
```

---

## Task 5: Historical Weather Service + Backtest

**Files:**
- Create: `backend/app/services/history.py`
- Create: `backend/app/api/history.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create HistoricalWeatherService**

```python
# backend/app/services/history.py
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
                street, hourly, estimated_ghi, target_date,
            )
            # 标记为估算值
            for p in predictions:
                p.is_estimated = True

            all_predictions[street] = [p.model_dump() for p in predictions]

            # 通过 WarningService 的唯一检测入口检测预警
            warnings = self.warning_service.evaluate_predictions(
                street, predictions, is_historical=True,
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
```

- [ ] **Step 2: Create history API**

```python
# backend/app/api/history.py
from datetime import date, timedelta
from fastapi import APIRouter, Query
from app.services.history import HistoricalWeatherService

router = APIRouter()
history_service = HistoricalWeatherService()


@router.get("/weather/{target_date}")
async def get_historical_weather(target_date: date):
    hourly = await history_service.get_historical_weather(target_date)
    if hourly is None:
        return {"error": "无法获取历史天气数据", "date": str(target_date)}
    return {"date": str(target_date), "hourly": [h.model_dump() for h in hourly]}


@router.get("/backtest/{target_date}")
async def backtest_date(target_date: date):
    return await history_service.backtest_date(target_date)


@router.get("/backtest-range")
async def backtest_range(
    start: date = Query(...), end: date = Query(...),
):
    if (end - start).days > 30:
        return {"error": "范围不能超过30天"}
    return {"results": await history_service.backtest_range(start, end)}


@router.post("/fetch-range")
async def fetch_and_cache(
    start: date = Query(...), end: date = Query(...),
):
    fetched, failed = [], []
    current = start
    while current <= end:
        hourly = await history_service.get_historical_weather(current)
        (fetched if hourly else failed).append(str(current))
        current += timedelta(days=1)
    return {"fetched": fetched, "failed": failed}
```

- [ ] **Step 3: Register in main.py**

Add `from app.api import history` and `app.include_router(history.router, prefix="/api/history", tags=["历史回测"])`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/history.py backend/app/api/history.py backend/app/main.py
git commit -m "feat: historical weather service + backtest with estimated GHI"
```

---

## Task 6: Frontend — Update Types and Components

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/components/PowerChart.tsx`
- Modify: `frontend/src/components/WeatherPanel.tsx`
- Modify: `frontend/src/components/StreetPanel.tsx`
- Modify: `frontend/src/components/OutputChart.tsx`
- Create: `frontend/src/components/HistoryPanel.tsx`
- Modify: `frontend/src/components/SideMenu.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update PowerPrediction type in api.ts**

```typescript
export interface PowerPrediction {
  time: string
  ghi: number                 // GHI W/m²
  clearsky_ghi: number        // clearsky GHI W/m²
  weather_ratio: number       // ghi / clearsky_ghi
  power_kw: number            // predicted power
  clearsky_power_kw: number   // clearsky power
  weather_text: string
  weather_icon: number
  is_estimated: boolean
}
```

Update `WarningRecord`: rename `change_rate` description, keep field names.

Add history API methods and `BacktestResult` type (same as previous plan).

- [ ] **Step 2: Update PowerChart**

Replace `p.predicted_power_kw` with `p.power_kw` in the `buildDayCharts` function:

```typescript
predicted: Math.round(p.power_kw),
clearsky: Math.round(p.clearsky_power_kw),
```

- [ ] **Step 3: Update WeatherPanel — remove local GHI calculation**

Remove:
- `const AREA_SPECIFIC_CAPACITY = 0.21`
- `const panelAreaM2 = capacityKw / AREA_SPECIFIC_CAPACITY`
- The `outputData` useMemo that computes `panelAreaM2 * r.ghi / 1000`
- The `outputMap` useMemo

The OutputChart in WeatherPanel should no longer be rendered (it was showing locally-computed power that's now obsolete). Or if kept, it should use backend `PowerPrediction` data instead. Since PowerChart already shows backend data, the OutputChart in WeatherPanel can be removed.

- [ ] **Step 4: Update StreetPanel**

Replace `w.weather_factor` references with `w.weather_ratio` (if any remain after prior task).

- [ ] **Step 5: Create HistoryPanel**

Same component as previous plan — date picker, run backtest, show results. Reference the history API types.

- [ ] **Step 6: Add HistoryPanel to SideMenu + App.tsx**

Add `'history'` to PanelType, render HistoryPanel when active.

- [ ] **Step 7: Build and verify**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build
```

- [ ] **Step 8: Commit**

```bash
git add -A frontend/
git commit -m "feat: frontend unified to backend GHI data, add history panel"
```

---

## Task 7: Deploy + Fetch Historical Data + Verify

- [ ] **Step 1: Run backend tests**
- [ ] **Step 2: Deploy backend to server**
- [ ] **Step 3: Deploy frontend to server**
- [ ] **Step 4: Restart service, verify startup**
- [ ] **Step 5: Fetch and cache April 1-3 historical data**

```bash
ssh test-vps "curl -s 'http://localhost:8800/api/history/fetch-range?start=2026-04-01&end=2026-04-03' -X POST"
```

- [ ] **Step 6: Run backtest on April 1-3**

```bash
ssh test-vps "curl -s 'http://localhost:8800/api/history/backtest/2026-04-01'" | python3 -m json.tool | head -40
```

Expected for April 1: ramp_up warning around 10→11时 (fog clearing, GHI jumps)

- [ ] **Step 7: Verify real-time path**

```bash
ssh test-vps "curl -s 'http://localhost:8800/api/forecast/total'" | python3 -m json.tool | head -20
```

Verify response contains `predicted_power_kw` (from GHI, not from icon→factor).

- [ ] **Step 8: Verify in browser** at http://43.167.177.60/pv

---

## Data Flow Summary (Final State)

```
实时路径:
  QWeather太阳辐射API → GHI (W/m²)  ← 全区只调一次，所有街道共用
  QWeather天气预报API → text/icon (仅展示，不参与计算)
  pvlib → clearsky_GHI (理论值)
    ↓
  ForecastService._fetch_district_ghi()        ← 获取GHI，一次
  ForecastService.predict_street_power()        ← 接收ghi_map参数
    → ForecastService.predict_from_weather()    ← 唯一计算入口
      power = capacity × GHI / 1000
      weather_ratio = GHI / clearsky_GHI
    ↓
  WarningService.evaluate_predictions()         ← 唯一检测入口
    比较 weather_ratio 变化 + 绝对量双判据
    ↓
  前端纯展示

历史回测路径:
  QWeather历史天气API → icon (实际观测，用LocationID)
  pvlib → clearsky_GHI (理论值)
    ↓
  HistoricalService.estimate_ghi_from_weather()
    estimated_ghi = clearsky_GHI × icon_reduction  ← icon→factor 唯一存活处
    ↓
  ForecastService.predict_from_weather(is_estimated=True)  ← 同一计算入口
    power = capacity × estimated_GHI / 1000
    weather_ratio = estimated_GHI / clearsky_GHI
    ↓
  WarningService.evaluate_predictions(is_historical=True)  ← 同一检测入口
    ↓
  前端标注 "估算数据"
```

**关键保证:**
1. **零逻辑重复** — predict_from_weather 是唯一计算入口，evaluate_predictions 是唯一检测入口
2. **GHI API 只调一次** — _fetch_district_ghi 获取后通过 ghi_map 参数分发
3. **icon→factor 仅在历史路径存活** — 明确标注为 HISTORICAL_WEATHER_REDUCTION
4. **前端零计算** — 所有出力数据来自后端，前端只做展示
