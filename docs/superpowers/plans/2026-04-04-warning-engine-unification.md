# Warning Engine Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the warning system into a single server-side engine that considers both change rate and absolute power impact, with persistent storage.

**Architecture:** Remove the frontend warning engine entirely. Redesign the backend engine to use a dual-criterion algorithm (change rate + absolute impact on grid). Persist warnings to a JSON file. Frontend becomes a pure consumer of `/api/warning/*` endpoints.

**Tech Stack:** Python/FastAPI (backend), React/TypeScript (frontend), JSON file persistence

---

## Current State Analysis

**Two independent warning engines exist:**
- **Backend** (`services/warning.py`): Compares adjacent-hour weather factor drop ratio. Only detects decreases. Stored in memory (lost on restart).
- **Frontend** (`lib/warningEngine.ts`): GHI second-derivative algorithm. Detects both ramp_down and ramp_up. Also in memory.

**Frontend usage of local engine:**
- `WarningPanel.tsx` (line 66): calls `computeWarnings()` with solar radiation data
- `WeatherPanel.tsx` (line 151): calls `computeWarnings()` with solar radiation data
- `OutputChart.tsx` (line 3): imports `Warning` type only

**Frontend usage of backend engine:**
- `App.tsx` (line 59): calls `api.evaluateWarnings()` → stores result in `warnings` state, passes to `MapView` for map markers

**Result:** Two sets of warnings displayed in different parts of the UI with different algorithms. Confusing and inconsistent.

---

## File Structure

### Backend Changes
| Action | File | Responsibility |
|--------|------|----------------|
| Rewrite | `backend/app/services/warning.py` | New dual-criterion warning engine |
| Modify | `backend/app/models/warning_record.py` | Add `type` (ramp_down/ramp_up), `abs_change_kw` fields |
| Modify | `backend/app/core/constants.py` | Update `WARNING_LEVELS` with dual thresholds |
| Modify | `backend/app/core/config.py` | Add absolute-impact thresholds to Settings |
| Modify | `backend/app/api/warning.py` | Add persistence, return enriched data |
| Create | `backend/tests/test_warning.py` | Unit tests for new warning engine |

### Frontend Changes
| Action | File | Responsibility |
|--------|------|----------------|
| Delete | `frontend/src/lib/warningEngine.ts` | Remove entirely |
| Modify | `frontend/src/api.ts` | Update `WarningRecord` type to match new backend fields |
| Rewrite | `frontend/src/components/WarningPanel.tsx` | Consume backend API instead of local computation |
| Modify | `frontend/src/components/WeatherPanel.tsx` | Remove local warning computation |
| Modify | `frontend/src/components/OutputChart.tsx` | Use backend `WarningRecord` type |
| Modify | `frontend/src/App.tsx` | Pass backend warnings to WarningPanel |

---

## New Warning Algorithm Design

**Core principle:** A warning should fire when weather change causes a power swing large enough to impact grid stability. This requires BOTH:
1. **Significant rate of change** — the swing is fast (within 1-2 hours)
2. **Significant absolute impact** — the swing is large in MW terms

**Algorithm:**

For each street, for each pair of adjacent forecast hours (t, t+1):

```
predicted_power_t  = clearsky_kw(t) × weather_factor(t)
predicted_power_t1 = clearsky_kw(t+1) × weather_factor(t+1)

delta_kw = predicted_power_t1 - predicted_power_t
change_rate = |delta_kw| / max(predicted_power_t, predicted_power_t1)  # avoid div-by-zero when both small

type = "ramp_down" if delta_kw < 0 else "ramp_up"
```

**Dual-criterion grading:**

| Level | Change Rate (%) | AND Absolute Impact (kW) |
|-------|-----------------|--------------------------|
| Red (I) | ≥60 | ≥2000 |
| Orange (II) | ≥45 | ≥1000 |
| Yellow (III) | ≥30 | ≥500 |
| Blue (IV) | ≥20 | ≥200 |

Both conditions must be met. This prevents:
- High rate but tiny absolute change (e.g., 5kW→1kW = 80% drop but only 4kW, irrelevant to grid)
- Large absolute change but low rate (e.g., normal sunrise ramp from 0→5000kW over hours)

**Sliding window enhancement:** Also check 2-hour windows (t vs t+2) to catch gradual but significant drops (e.g., 晴→多云→雨, each step <20% but total is 90%).

---

## Task 1: Backend — Update Models and Config

**Files:**
- Modify: `backend/app/models/warning_record.py`
- Modify: `backend/app/core/config.py`
- Modify: `backend/app/core/constants.py`

- [ ] **Step 1: Update WarningRecord model**

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
    change_rate: float          # 变化率 (0-1)
    abs_change_kw: float        # 绝对变化量 kW
    from_time: str              # 起始时间
    to_time: str                # 结束时间
    from_power_kw: float        # 变化前出力
    to_power_kw: float          # 变化后出力
    issued_at: str              # 预警发布时间
    weather_from: str           # 天气：从
    weather_to: str             # 天气：到


class PowerPrediction(BaseModel):
    """单时段出力预测"""
    time: str
    clearsky_ratio: float       # 晴空理论出力比(0-1)
    clearsky_power_kw: float    # 晴空理论出力绝对值 kW
    weather_factor: float       # 天气出力系数
    predicted_power_kw: float   # 预测出力 kW
    weather_text: str           # 天气描述
    weather_icon: int           # 天气代码
```

- [ ] **Step 2: Update config with dual thresholds**

In `backend/app/core/config.py`, replace the four single thresholds with dual thresholds:

```python
    # 预警阈值 — 变化率 (占当前出力比例)
    WARNING_RATE_BLUE: float = 0.20
    WARNING_RATE_YELLOW: float = 0.30
    WARNING_RATE_ORANGE: float = 0.45
    WARNING_RATE_RED: float = 0.60

    # 预警阈值 — 绝对变化量 (kW)
    WARNING_ABS_BLUE: float = 200
    WARNING_ABS_YELLOW: float = 500
    WARNING_ABS_ORANGE: float = 1000
    WARNING_ABS_RED: float = 2000
```

Remove the old `WARNING_LEVEL_BLUE/YELLOW/ORANGE/RED` fields.

- [ ] **Step 3: Update WARNING_LEVELS in constants.py**

```python
WARNING_LEVELS = {
    "red":    {"label": "I级（红色）",  "action": "紧急调度，切换备用电源"},
    "orange": {"label": "II级（橙色）", "action": "启动备用电源，调整负荷分配"},
    "yellow": {"label": "III级（黄色）", "action": "启动备用电源预热"},
    "blue":   {"label": "IV级（蓝色）", "action": "关注气象变化，做好调度准备"},
}
```

(Remove threshold values from here — they now live in config.py)

- [ ] **Step 4: Commit**

```bash
git add backend/app/models/warning_record.py backend/app/core/config.py backend/app/core/constants.py
git commit -m "refactor: update warning models with dual-criterion fields (rate + absolute)"
```

---

## Task 2: Backend — Rewrite Warning Engine

**Files:**
- Rewrite: `backend/app/services/warning.py`
- Create: `backend/tests/test_warning.py`

- [ ] **Step 1: Write tests for the new warning engine**

```python
# backend/tests/test_warning.py
"""Tests for dual-criterion warning engine"""

import pytest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.models.warning_record import PowerPrediction
from app.services.warning import WarningService


def make_prediction(hour: int, weather_factor: float, clearsky_ratio: float,
                    capacity_kw: float = 10000, weather_text: str = "晴",
                    target_date: str | None = None) -> PowerPrediction:
    """Helper to build a PowerPrediction for testing"""
    d = target_date or str(date.today() + timedelta(days=1))
    clearsky_kw = capacity_kw * clearsky_ratio
    predicted_kw = clearsky_kw * weather_factor
    return PowerPrediction(
        time=f"{d} {hour:02d}:00",
        clearsky_ratio=clearsky_ratio,
        clearsky_power_kw=round(clearsky_kw, 2),
        weather_factor=weather_factor,
        predicted_power_kw=round(predicted_kw, 2),
        weather_text=weather_text,
        weather_icon=100,
    )


class TestDetermineLevel:
    """Test dual-criterion level determination"""

    def setup_method(self):
        self.svc = WarningService()

    def test_no_warning_low_rate_low_abs(self):
        """Small change in both dimensions — no warning"""
        assert self.svc._determine_level(0.10, 100) is None

    def test_no_warning_high_rate_low_abs(self):
        """High rate but tiny absolute change — no warning (e.g. 5kW→1kW)"""
        assert self.svc._determine_level(0.80, 50) is None

    def test_no_warning_low_rate_high_abs(self):
        """Large absolute but low rate — no warning (e.g. normal sunrise)"""
        assert self.svc._determine_level(0.10, 3000) is None

    def test_blue_warning(self):
        assert self.svc._determine_level(0.25, 300) == "blue"

    def test_yellow_warning(self):
        assert self.svc._determine_level(0.35, 600) == "yellow"

    def test_orange_warning(self):
        assert self.svc._determine_level(0.50, 1200) == "orange"

    def test_red_warning(self):
        assert self.svc._determine_level(0.70, 3000) == "red"

    def test_rate_met_abs_not_met_no_warning(self):
        """Rate meets orange but abs only meets yellow — should be yellow"""
        assert self.svc._determine_level(0.50, 600) == "yellow"


class TestEvaluateStreet:
    """Test street-level warning evaluation"""

    def setup_method(self):
        self.svc = WarningService()

    @pytest.mark.asyncio
    async def test_sunny_to_rain_triggers_warning(self):
        """晴(1.0) → 降雨(0.1) at noon — should trigger high-level warning"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(11, 1.0, 0.9, 10000, "晴", tomorrow),
            make_prediction(12, 1.0, 1.0, 10000, "晴", tomorrow),
            make_prediction(13, 0.1, 0.95, 10000, "暴雨", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        assert len(warnings) >= 1
        assert warnings[0].type == "ramp_down"
        assert warnings[0].abs_change_kw > 0

    @pytest.mark.asyncio
    async def test_rain_to_sunny_triggers_ramp_up(self):
        """降雨(0.1) → 晴(1.0) — should trigger ramp_up warning"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(11, 0.1, 0.9, 10000, "暴雨", tomorrow),
            make_prediction(12, 0.1, 1.0, 10000, "暴雨", tomorrow),
            make_prediction(13, 1.0, 0.95, 10000, "晴", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        assert any(w.type == "ramp_up" for w in warnings)

    @pytest.mark.asyncio
    async def test_no_warning_for_gradual_sunrise(self):
        """Normal sunrise ramp — low rate, should not trigger"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(9, 1.0, 0.15, 10000, "晴", tomorrow),
            make_prediction(10, 1.0, 0.45, 10000, "晴", tomorrow),
            make_prediction(11, 1.0, 0.75, 10000, "晴", tomorrow),
            make_prediction(12, 1.0, 0.95, 10000, "晴", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        # Normal sunrise ramp: clearsky changes but weather_factor stays 1.0
        # The absolute change is large but rate is 0 (same factor) so no warning
        assert len(warnings) == 0

    @pytest.mark.asyncio
    async def test_estimated_values_skipped(self):
        """推算值(带*)不触发预警"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(12, 1.0, 1.0, 10000, "晴*", tomorrow),
            make_prediction(13, 0.1, 0.95, 10000, "暴雨", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        assert len(warnings) == 0

    @pytest.mark.asyncio
    async def test_cross_day_skipped(self):
        """跨日不预警"""
        today = str(date.today())
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(16, 1.0, 0.3, 10000, "晴", today),
            make_prediction(9, 0.1, 0.15, 10000, "暴雨", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        assert len(warnings) == 0


class TestSlidingWindow:
    """Test 2-hour sliding window for gradual drops"""

    def setup_method(self):
        self.svc = WarningService()

    @pytest.mark.asyncio
    async def test_gradual_drop_caught_by_window(self):
        """晴(1.0) → 多云(0.7) → 暴雨(0.1): each step <30% but 2h window catches it"""
        tomorrow = str(date.today() + timedelta(days=1))
        predictions = [
            make_prediction(11, 1.0, 0.95, 10000, "晴", tomorrow),
            make_prediction(12, 0.7, 1.0, 10000, "多云", tomorrow),
            make_prediction(13, 0.1, 0.95, 10000, "暴雨", tomorrow),
        ]
        with patch.object(self.svc.forecast_service, 'predict_street_power',
                         new_callable=AsyncMock, return_value=predictions):
            warnings = await self.svc.evaluate_street("石化街道")
        # The 2-hour window should catch the 1.0 → 0.1 total drop
        assert len(warnings) >= 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_warning.py -v`
Expected: FAIL (old warning engine doesn't match new interface)

- [ ] **Step 3: Rewrite warning engine**

```python
# backend/app/services/warning.py
"""预警引擎：双判据检测光伏出力骤变（变化率 + 绝对变化量）

设计初衷：天气骤变（晴→雨、阴→晴）导致大量负荷/发电能力突然变化，
对电网潮流造成冲击。因此预警必须同时满足：
  1. 变化率足够大（变化剧烈）
  2. 绝对变化量足够大（对电网有实际影响）
"""

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS, WARNING_LEVELS
from app.models.warning_record import WarningRecord
from app.services.forecast import ForecastService

WARNINGS_FILE = Path("data/warnings.json")


class WarningService:
    """双判据预警引擎"""

    def __init__(self):
        self.forecast_service = ForecastService()
        self._active_warnings: list[WarningRecord] = []
        self._history: list[WarningRecord] = self._load_history()

    # ── Persistence ──────────────────────────────────────

    def _load_history(self) -> list[WarningRecord]:
        if WARNINGS_FILE.exists():
            try:
                data = json.loads(WARNINGS_FILE.read_text(encoding="utf-8"))
                return [WarningRecord(**w) for w in data]
            except Exception as e:
                logger.warning(f"加载预警历史失败: {e}")
        return []

    def _save_history(self) -> None:
        WARNINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = [w.model_dump() for w in self._history]
        WARNINGS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ── Level Determination ──────────────────────────────

    def _determine_level(self, change_rate: float, abs_change_kw: float) -> str | None:
        """
        双判据分级：变化率和绝对变化量都必须达到对应等级的阈值。
        取两个维度各自能达到的最高等级中较低的那个。
        """
        rate_level = None
        if change_rate >= settings.WARNING_RATE_RED:
            rate_level = "red"
        elif change_rate >= settings.WARNING_RATE_ORANGE:
            rate_level = "orange"
        elif change_rate >= settings.WARNING_RATE_YELLOW:
            rate_level = "yellow"
        elif change_rate >= settings.WARNING_RATE_BLUE:
            rate_level = "blue"

        abs_level = None
        if abs_change_kw >= settings.WARNING_ABS_RED:
            abs_level = "red"
        elif abs_change_kw >= settings.WARNING_ABS_ORANGE:
            abs_level = "orange"
        elif abs_change_kw >= settings.WARNING_ABS_YELLOW:
            abs_level = "yellow"
        elif abs_change_kw >= settings.WARNING_ABS_BLUE:
            abs_level = "blue"

        if rate_level is None or abs_level is None:
            return None

        # 取两者中较低的等级（短板原则）
        ORDER = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}
        return max(rate_level, abs_level, key=lambda l: ORDER[l])

    # ── Evaluation ───────────────────────────────────────

    async def evaluate_street(
        self, street: str, target_date: date | None = None
    ) -> list[WarningRecord]:
        """评估指定街道的出力骤变预警（1小时窗口 + 2小时窗口）"""
        predictions = await self.forecast_service.predict_street_power(street, target_date)
        if len(predictions) < 2:
            return []

        now_shanghai = datetime.now(timezone(timedelta(hours=8)))
        now_hour = now_shanghai.hour
        warnings: list[WarningRecord] = []
        seen_pairs: set[str] = set()  # 去重

        # 检测窗口：1小时和2小时
        for window in [1, 2]:
            for i in range(len(predictions) - window):
                curr = predictions[i]
                target = predictions[i + window]

                # 提取日期
                curr_date = curr.time.split(" ")[0]
                target_date_str = target.time.split(" ")[0]

                # 跨日不预警
                if curr_date != target_date_str:
                    continue

                # 只对未来时段预警
                try:
                    curr_hour = int(curr.time.split(" ")[1].split(":")[0])
                except (IndexError, ValueError):
                    continue
                curr_date_obj = date.fromisoformat(curr_date)
                if curr_date_obj == now_shanghai.date() and curr_hour < now_hour:
                    continue

                # 推算值不预警
                if curr.weather_text.endswith("*") or target.weather_text.endswith("*"):
                    continue

                # 计算变化
                power_from = curr.predicted_power_kw
                power_to = target.predicted_power_kw
                delta_kw = power_to - power_from
                abs_delta = abs(delta_kw)
                denominator = max(power_from, power_to)

                if denominator <= 0:
                    continue

                change_rate = abs_delta / denominator
                warn_type = "ramp_down" if delta_kw < 0 else "ramp_up"

                level = self._determine_level(change_rate, abs_delta)
                if level is None:
                    continue

                # 去重：同一个时间对只取最高等级
                pair_key = f"{curr.time}-{target.time}"
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                level_info = WARNING_LEVELS[level]
                warning = WarningRecord(
                    id=f"W-{street[:2]}-{now_shanghai.strftime('%Y%m%d%H%M%S')}-{i}-{window}h",
                    level=level,
                    label=level_info["label"],
                    type=warn_type,
                    street=street,
                    action=level_info["action"],
                    change_rate=round(change_rate, 3),
                    abs_change_kw=round(abs_delta, 2),
                    from_time=curr.time,
                    to_time=target.time,
                    from_power_kw=power_from,
                    to_power_kw=power_to,
                    issued_at=now_shanghai.isoformat(),
                    weather_from=curr.weather_text,
                    weather_to=target.weather_text,
                )
                warnings.append(warning)
                logger.warning(
                    f"预警: {street} {level_info['label']} {warn_type} | "
                    f"{curr.time}→{target.time} ({window}h窗口) | "
                    f"变化率{change_rate:.0%} 绝对量{abs_delta:.0f}kW | "
                    f"{curr.weather_text}→{target.weather_text}"
                )

        return warnings

    async def evaluate_all(
        self, target_date: date | None = None
    ) -> list[WarningRecord]:
        """评估所有街道"""
        all_warnings: list[WarningRecord] = []
        for street in JINSHAN_STREETS:
            warnings = await self.evaluate_street(street, target_date)
            all_warnings.extend(warnings)

        # 按等级排序
        ORDER = {"red": 0, "orange": 1, "yellow": 2, "blue": 3}
        all_warnings.sort(key=lambda w: (ORDER.get(w.level, 9), w.from_time))

        self._active_warnings = all_warnings
        self._history.extend(all_warnings)
        self._save_history()

        if all_warnings:
            logger.warning(f"本轮评估产生 {len(all_warnings)} 条预警")
        else:
            logger.info("本轮评估无预警")

        return all_warnings

    def get_active_warnings(self) -> list[WarningRecord]:
        return self._active_warnings

    def get_history(self) -> list[WarningRecord]:
        return self._history
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/backend && python -m pytest tests/test_warning.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/warning.py backend/tests/test_warning.py
git commit -m "feat: rewrite warning engine with dual-criterion algorithm (rate + absolute impact)"
```

---

## Task 3: Backend — Update API Layer

**Files:**
- Modify: `backend/app/api/warning.py`

- [ ] **Step 1: Read current warning API**

Read `backend/app/api/warning.py` to see current endpoints.

- [ ] **Step 2: Update the API to return new fields**

The API should already work since we kept `evaluate_all()` and `get_active_warnings()` signatures the same. But verify the response schema matches by checking the route handlers return the updated `WarningRecord` with new fields (`type`, `change_rate`, `abs_change_kw`).

If the route does manual dict construction, update it to pass through the new fields. If it returns `WarningRecord` objects directly (via Pydantic), no change needed.

- [ ] **Step 3: Update .env on server**

SSH to server and add the new config values to `/opt/pv-warning/.env`:

```bash
# 预警阈值 — 变化率
WARNING_RATE_BLUE=0.20
WARNING_RATE_YELLOW=0.30
WARNING_RATE_ORANGE=0.45
WARNING_RATE_RED=0.60
# 预警阈值 — 绝对变化量 (kW)
WARNING_ABS_BLUE=200
WARNING_ABS_YELLOW=500
WARNING_ABS_ORANGE=1000
WARNING_ABS_RED=2000
```

Remove old `WARNING_LEVEL_*` entries.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/warning.py
git commit -m "fix: update warning API for new dual-criterion fields"
```

---

## Task 4: Frontend — Remove Local Engine, Consume Backend API

**Files:**
- Delete: `frontend/src/lib/warningEngine.ts`
- Modify: `frontend/src/api.ts`
- Rewrite: `frontend/src/components/WarningPanel.tsx`
- Modify: `frontend/src/components/WeatherPanel.tsx`
- Modify: `frontend/src/components/OutputChart.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Update WarningRecord type in api.ts**

```typescript
// Replace existing WarningRecord with:
export interface WarningRecord {
  id: string
  level: string              // red/orange/yellow/blue
  label: string              // I级（红色）等
  type: string               // ramp_down / ramp_up
  street: string
  action: string
  change_rate: number         // 变化率 (0-1)
  abs_change_kw: number       // 绝对变化量 kW
  from_time: string
  to_time: string
  from_power_kw: number
  to_power_kw: number
  issued_at: string
  weather_from: string
  weather_to: string
}
```

- [ ] **Step 2: Delete frontend warning engine**

Delete `frontend/src/lib/warningEngine.ts` entirely.

- [ ] **Step 3: Rewrite WarningPanel to consume backend API**

Replace all `computeWarnings()` usage. The component should receive `warnings: WarningRecord[]` as a prop from App.tsx instead of computing locally. Key changes:

- Remove `import { computeWarnings }` and all solar radiation fetching
- Add `warnings: WarningRecord[]` to Props
- Remove `radiation`, `loading`, `currentSource` state
- Remove `computeWarnings()` useMemo
- Use `warnings` prop directly for filtering and display
- Update card rendering to use `change_rate`, `abs_change_kw` fields
- Keep existing filter UI (level + type filters)
- Replace `w.rampRatePercent` with `Math.round(w.change_rate * 100)`
- Replace `w.ghiChange` display with `abs_change_kw` display (e.g., "Δ1200kW")

- [ ] **Step 4: Update WeatherPanel — remove computeWarnings usage**

In `frontend/src/components/WeatherPanel.tsx`:
- Remove `import { computeWarnings }`
- Remove the `computeWarnings()` call (around line 151) and any related warning display
- If WeatherPanel shows warnings inline, replace with a note like "详见预警中心" or remove the section

- [ ] **Step 5: Update OutputChart — fix Warning type import**

In `frontend/src/components/OutputChart.tsx`:
- Replace `import type { Warning } from '../lib/warningEngine'` with `import type { WarningRecord } from '../api'`
- Update any references from `Warning` type to `WarningRecord`
- Update field names: `rampRatePercent` → `Math.round(change_rate * 100)`, `fromPowerKw/toPowerKw` → `from_power_kw/to_power_kw` (already snake_case from backend)

- [ ] **Step 6: Update App.tsx — pass warnings to WarningPanel**

In `App.tsx`, WarningPanel should receive backend warnings:
- The `warnings` state already comes from `api.evaluateWarnings()` (line 59)
- Pass `warnings={warnings}` to `<WarningPanel>`
- Remove any solar radiation data passing if present

- [ ] **Step 7: Verify build**

Run: `cd /Users/zjz/Documents/pv-output-warning-system/frontend && npm run build`
Expected: Build succeeds with no TypeScript errors

- [ ] **Step 8: Commit**

```bash
git add -A frontend/
git commit -m "feat: unify frontend to use backend warning API, remove local warning engine"
```

---

## Task 5: Integration Test and Deploy

**Files:** None (testing + deployment)

- [ ] **Step 1: Run backend tests**

```bash
cd /Users/zjz/Documents/pv-output-warning-system/backend
python -m pytest tests/ -v
```

- [ ] **Step 2: Test locally**

```bash
cd /Users/zjz/Documents/pv-output-warning-system/backend
python -m uvicorn app.main:app --port 8800 &
curl -s http://localhost:8800/api/warning/evaluate -X POST | python -m json.tool
curl -s http://localhost:8800/api/warning/current | python -m json.tool
kill %1
```

Verify response contains `type`, `change_rate`, `abs_change_kw` fields.

- [ ] **Step 3: Deploy to server**

```bash
# Sync code
scp -r backend/ test-vps:/opt/pv-warning/backend/

# Sync frontend build
cd frontend && npm run build
scp -r dist/* test-vps:/var/www/pv-warning/

# Restart backend service
ssh test-vps "systemctl restart pv-warning && sleep 2 && systemctl status pv-warning --no-pager"
```

- [ ] **Step 4: Verify on server**

```bash
ssh test-vps "curl -s http://localhost:8800/api/warning/evaluate -X POST | python3 -m json.tool | head -30"
```

Then open http://43.167.177.60/pv in browser to verify.

- [ ] **Step 5: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: integration fixes after deployment"
```
