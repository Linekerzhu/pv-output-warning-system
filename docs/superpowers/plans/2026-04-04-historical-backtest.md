# Historical Backtest & Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import April 1st–today historical weather data, backtest the warning algorithm against actual (not forecast) weather, and add a historical review feature to the UI.

**Architecture:** New `HistoricalWeatherService` fetches from QWeather's `/v7/historical/weather` API (uses LocationID, returns actual observed data). Historical data is cached to `data/history/` as JSON files (one per date per street). A backtest endpoint runs the existing warning engine against historical data. The frontend gets a date picker to review past warnings and power curves.

**Tech Stack:** Python/FastAPI, QWeather Historical API (`/v7/historical/weather`), React/TypeScript

**Critical Design Decision:** Historical API uses LocationID (not lon,lat). Only last 10 days available. Historical data has NO `cloud` or `pop` fields (unlike forecast), but has `icon`, `text`, `temp`, `humidity`, `precip`, `windSpeed` — which is sufficient since our warning algorithm only uses `icon` → `weather_factor`.

---

## Key API Differences: Forecast vs Historical

| Aspect | Forecast (`/v7/weather/72h`) | Historical (`/v7/historical/weather`) |
|--------|------------------------------|---------------------------------------|
| Location | `lon,lat` string | LocationID (e.g. `101020700`) |
| Time param | N/A (returns next 72h) | `date=yyyyMMdd` (one day) |
| Time field | `fxTime` | `time` |
| Has `cloud` | Yes | **No** |
| Has `pop` | Yes | **No** |
| Has `icon` | Yes | Yes |
| Data range | Future 72h | Past 10 days (excl. today) |

金山 LocationID: `101020700` (via GeoAPI lookup of `121.34,30.74`)

---

## File Structure

### Backend New Files
| File | Responsibility |
|------|---------------|
| `backend/app/services/history.py` | Fetch & cache historical weather, run backtest |
| `backend/app/api/history.py` | REST endpoints for historical data & backtest |
| `backend/tests/test_history.py` | Tests for historical service |

### Backend Modified Files
| File | Change |
|------|--------|
| `backend/app/core/constants.py` | Add LocationID to `JINSHAN_STREETS` |
| `backend/app/main.py` | Register history router |

### Frontend Modified Files
| File | Change |
|------|--------|
| `frontend/src/api.ts` | Add history API types and methods |
| `frontend/src/App.tsx` | Add history panel option |
| `frontend/src/components/SideMenu.tsx` | Add history menu item |

### Frontend New Files
| File | Responsibility |
|------|---------------|
| `frontend/src/components/HistoryPanel.tsx` | Date picker + historical warnings/power review |

### Data Files
| File | Purpose |
|------|---------|
| `data/history/{date}_{street}.json` | Cached historical weather per day per street |

---

## Task 1: Add LocationID to Street Constants

**Files:**
- Modify: `backend/app/core/constants.py`

- [ ] **Step 1: Look up LocationIDs for all Jinshan streets**

Run on server to discover which streets have distinct LocationIDs vs sharing the district-level one:

```bash
for name in "石化" "朱泾" "枫泾" "张堰" "亭林" "吕巷" "廊下" "金山卫" "漕泾" "山阳" "金山工业区"; do
  echo -n "$name: "
  curl -s --compressed "https://mh7fc34mwn.re.qweatherapi.com/geo/v2/city/lookup?location=$name&adm=上海&key=7ec0531e326d4595b254beeda71b7f3b" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('location',[{}])[0].get('id','NOT_FOUND') if d.get('location') else 'NOT_FOUND')"
done
```

Most of these streets/towns are too small for individual LocationIDs. The historical API will use the district-level ID `101020700` (金山) for all streets, since QWeather has city-level historical data, not street-level.

- [ ] **Step 2: Add location_id to JINSHAN_STREETS**

```python
# In constants.py, update JINSHAN_STREETS to add the district-level location_id
# All streets share the same LocationID since historical data is city-level
JINSHAN_LOCATION_ID = "101020700"
```

Add this constant below the existing `JINSHAN_STREETS` dict. The individual street `location_id` fields are already empty strings — we don't populate them because historical data is district-level.

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/constants.py
git commit -m "feat: add Jinshan district LocationID for historical API"
```

---

## Task 2: Historical Weather Service

**Files:**
- Create: `backend/app/services/history.py`
- Create: `backend/tests/test_history.py`

- [ ] **Step 1: Write tests**

```python
# backend/tests/test_history.py
"""Tests for historical weather service"""

import pytest
import json
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

from app.services.history import HistoricalWeatherService


# Sample API response matching real QWeather historical format
SAMPLE_HISTORICAL_RESPONSE = {
    "code": "200",
    "weatherDaily": {
        "date": "2026-04-03",
        "sunrise": "05:42",
        "sunset": "18:15",
        "tempMax": "16",
        "tempMin": "13",
    },
    "weatherHourly": [
        {
            "time": "2026-04-03T09:00+08:00",
            "temp": "14",
            "icon": "104",
            "text": "阴",
            "precip": "0.0",
            "wind360": "120",
            "windDir": "东南风",
            "windScale": "3",
            "windSpeed": "12",
            "humidity": "70",
            "pressure": "1014",
        },
        {
            "time": "2026-04-03T10:00+08:00",
            "temp": "14",
            "icon": "305",
            "text": "小雨",
            "precip": "0.5",
            "wind360": "120",
            "windDir": "东南风",
            "windScale": "3",
            "windSpeed": "15",
            "humidity": "85",
            "pressure": "1013",
        },
        {
            "time": "2026-04-03T11:00+08:00",
            "temp": "14",
            "icon": "306",
            "text": "中雨",
            "precip": "2.0",
            "wind360": "150",
            "windDir": "东南风",
            "windScale": "4",
            "windSpeed": "20",
            "humidity": "90",
            "pressure": "1012",
        },
    ],
}


class TestFetchHistorical:
    def setup_method(self):
        self.svc = HistoricalWeatherService()

    @pytest.mark.asyncio
    async def test_fetch_and_parse(self):
        """Should parse QWeather historical response into HourlyWeather list"""
        mock_resp = MagicMock()
        mock_resp.json.return_value = SAMPLE_HISTORICAL_RESPONSE
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.AsyncClient") as MockClient:
            mock_client = AsyncMock()
            mock_client.get.return_value = mock_resp
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            MockClient.return_value = mock_client

            result = await self.svc.fetch_historical_weather(date(2026, 4, 3))

        assert result is not None
        assert len(result) == 3
        assert result[0].icon == 104
        assert result[0].text == "阴"
        assert result[1].icon == 305
        assert result[1].text == "小雨"
        # time should be converted to "yyyy-MM-dd HH:mm"
        assert result[0].time == "2026-04-03 09:00"


class TestCaching:
    def setup_method(self):
        self.svc = HistoricalWeatherService()

    def test_cache_path(self):
        """Cache file path should be data/history/20260403.json"""
        p = self.svc._cache_path(date(2026, 4, 3))
        assert p == Path("data/history/20260403.json")

    @pytest.mark.asyncio
    async def test_loads_from_cache(self, tmp_path):
        """Should load from cache file if it exists"""
        cache_data = [
            {"time": "2026-04-03 09:00", "icon": 104, "text": "阴",
             "temp": 14.0, "humidity": 70, "cloud": 0, "pop": 0,
             "wind_speed": 12.0, "precip": 0.0},
        ]
        cache_file = tmp_path / "20260403.json"
        cache_file.write_text(json.dumps(cache_data, ensure_ascii=False))

        with patch.object(self.svc, '_cache_path', return_value=cache_file):
            result = await self.svc.get_historical_weather(date(2026, 4, 3))

        assert len(result) == 1
        assert result[0].icon == 104


class TestBacktest:
    def setup_method(self):
        self.svc = HistoricalWeatherService()

    @pytest.mark.asyncio
    async def test_backtest_returns_warnings_and_predictions(self):
        """Backtest should return both predictions and warnings for a date"""
        # Mock historical weather with a weather change (阴→暴雨)
        from app.models.weather_data import HourlyWeather
        mock_hourly = [
            HourlyWeather(time=f"2026-04-03 {h:02d}:00", icon=104, text="阴",
                         temp=14, humidity=70, cloud=0, pop=0, wind_speed=10, precip=0)
            for h in range(9, 12)
        ] + [
            HourlyWeather(time=f"2026-04-03 {h:02d}:00", icon=306, text="中雨",
                         temp=13, humidity=90, cloud=0, pop=0, wind_speed=20, precip=2)
            for h in range(12, 17)
        ]

        with patch.object(self.svc, 'get_historical_weather',
                         new_callable=AsyncMock, return_value=mock_hourly):
            result = await self.svc.backtest_date(date(2026, 4, 3))

        assert "predictions" in result
        assert "warnings" in result
        assert len(result["predictions"]) > 0
        # 阴(0.40) → 中雨(0.10) should trigger a warning
        assert len(result["warnings"]) > 0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/zjz/Documents/pv-output-warning-system/backend
python3 -m pytest tests/test_history.py -v
```

Expected: FAIL — `app.services.history` does not exist

- [ ] **Step 3: Implement HistoricalWeatherService**

```python
# backend/app/services/history.py
"""历史天气数据服务：获取实际天气（非预报），用于回测和历史回看

关键设计：
  - 使用和风天气 /v7/historical/weather API
  - 该API使用 LocationID（非lon,lat），返回实际观测数据
  - 历史数据无 cloud/pop 字段，但有 icon/text，足够驱动预警算法
  - 数据缓存到 data/history/ 目录，避免重复请求（API只保留10天）
"""

import json
from datetime import date, timedelta, timezone, datetime
from pathlib import Path

import httpx
from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_LOCATION_ID, JINSHAN_STREETS, get_weather_output_factor
from app.models.weather_data import HourlyWeather
from app.models.warning_record import PowerPrediction, WarningRecord
from app.services.solar import SolarService
from app.services.aggregation import AggregationService
from app.services.warning import WarningService

HISTORY_DIR = Path("data/history")


class HistoricalWeatherService:
    """历史天气数据获取与回测"""

    def __init__(self):
        self.api_key = settings.QWEATHER_API_KEY
        self.base_url = settings.QWEATHER_API_HOST
        self.solar_service = SolarService()
        self.aggregation_service = AggregationService()

    def _cache_path(self, target_date: date) -> Path:
        return HISTORY_DIR / f"{target_date.strftime('%Y%m%d')}.json"

    async def fetch_historical_weather(self, target_date: date) -> list[HourlyWeather] | None:
        """从和风天气API获取指定日期的历史天气（实际观测数据）"""
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
                # Handle error response format
                error = data.get("error", {})
                logger.error(f"历史天气API错误: {error.get('title', data.get('code'))} date={date_str}")
                return None

            hourly = []
            for item in data.get("weatherHourly", []):
                # time format: "2026-04-03T09:00+08:00" → "2026-04-03 09:00"
                raw_time = item["time"]
                time_str = raw_time[:16].replace("T", " ")

                hourly.append(HourlyWeather(
                    time=time_str,
                    icon=int(item["icon"]),
                    text=item["text"],
                    temp=float(item["temp"]),
                    humidity=int(item.get("humidity", 50)),
                    cloud=0,   # 历史API无cloud字段
                    pop=0,     # 历史API无pop字段
                    wind_speed=float(item.get("windSpeed", 0)),
                    precip=float(item.get("precip", 0)),
                ))

            return hourly

        except Exception as e:
            logger.error(f"获取历史天气失败 date={date_str}: {e}")
            return None

    async def get_historical_weather(self, target_date: date) -> list[HourlyWeather] | None:
        """获取历史天气，优先从缓存读取"""
        cache_file = self._cache_path(target_date)

        # 从缓存读取
        if cache_file.exists():
            try:
                data = json.loads(cache_file.read_text(encoding="utf-8"))
                return [HourlyWeather(**item) for item in data]
            except Exception as e:
                logger.warning(f"缓存读取失败 {cache_file}: {e}")

        # 从API获取
        hourly = await self.fetch_historical_weather(target_date)
        if hourly is None:
            return None

        # 写入缓存
        cache_file.parent.mkdir(parents=True, exist_ok=True)
        cache_data = [h.model_dump() for h in hourly]
        cache_file.write_text(
            json.dumps(cache_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info(f"历史天气已缓存: {cache_file} ({len(hourly)} 条)")

        return hourly

    def _build_predictions_from_history(
        self, target_date: date, hourly: list[HourlyWeather], capacity_kw: float,
        center_lat: float, center_lon: float,
    ) -> list[PowerPrediction]:
        """基于历史天气数据构建出力预测（用于回测）"""
        clearsky = self.solar_service.get_clearsky_curve(target_date, center_lat, center_lon)
        date_str = str(target_date)

        # 构建 hour → weather 映射
        weather_map: dict[int, HourlyWeather] = {}
        for h in hourly:
            try:
                hour = int(h.time.split(" ")[1].split(":")[0])
                weather_map[hour] = h
            except (IndexError, ValueError):
                continue

        predictions = []
        for hour, ratio in sorted(clearsky.items()):
            hw = weather_map.get(hour)
            if hw is None:
                continue

            factor = get_weather_output_factor(hw.icon)
            clearsky_kw = capacity_kw * ratio
            predicted = clearsky_kw * factor

            predictions.append(PowerPrediction(
                time=f"{date_str} {hour:02d}:00",
                clearsky_ratio=round(ratio, 4),
                clearsky_power_kw=round(clearsky_kw, 2),
                weather_factor=factor,
                predicted_power_kw=round(predicted, 2),
                weather_text=hw.text,
                weather_icon=hw.icon,
            ))

        return predictions

    async def backtest_date(self, target_date: date) -> dict:
        """对指定日期进行回测：用历史天气跑预警算法"""
        hourly = await self.get_historical_weather(target_date)
        if not hourly:
            return {"date": str(target_date), "predictions": {}, "warnings": [],
                    "error": "无法获取历史天气数据"}

        all_predictions: dict[str, list[dict]] = {}
        all_warnings: list[WarningRecord] = []

        warning_service = WarningService()

        for street, info in JINSHAN_STREETS.items():
            agg = self.aggregation_service.get_street_aggregation(street)
            if not agg or agg.total_capacity_kw == 0:
                continue

            predictions = self._build_predictions_from_history(
                target_date, hourly, agg.total_capacity_kw,
                agg.center_lat, agg.center_lon,
            )
            all_predictions[street] = [p.model_dump() for p in predictions]

            # 跑预警算法（直接复用 _determine_level 和检测逻辑）
            warnings = self._evaluate_historical_warnings(
                warning_service, street, predictions, target_date,
            )
            all_warnings.extend(warnings)

        # 按等级排序
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
        }

    def _evaluate_historical_warnings(
        self, warning_service: WarningService, street: str,
        predictions: list[PowerPrediction], target_date: date,
    ) -> list[WarningRecord]:
        """对历史数据运行预警检测（同步版，不过滤"未来时段"）"""
        if len(predictions) < 2:
            return []

        warnings: list[WarningRecord] = []
        seen_pairs: set[str] = set()
        now_str = datetime.now(timezone(timedelta(hours=8))).isoformat()

        for window in [1, 2]:
            for i in range(len(predictions) - window):
                curr = predictions[i]
                target = predictions[i + window]

                curr_date = curr.time.split(" ")[0]
                target_date_str = target.time.split(" ")[0]
                if curr_date != target_date_str:
                    continue

                factor_from = curr.weather_factor
                factor_to = target.weather_factor
                factor_delta = abs(factor_from - factor_to)

                if factor_delta == 0:
                    continue

                denominator = max(factor_from, factor_to)
                if denominator <= 0:
                    continue

                change_rate = factor_delta / denominator
                clearsky_avg = (curr.clearsky_power_kw + target.clearsky_power_kw) / 2
                abs_change_kw = clearsky_avg * factor_delta

                level = warning_service._determine_level(change_rate, abs_change_kw)
                if level is None:
                    continue

                pair_key = f"{curr.time}-{target.time}"
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                from app.core.constants import WARNING_LEVELS
                warn_type = "ramp_down" if factor_to < factor_from else "ramp_up"
                level_info = WARNING_LEVELS[level]

                warnings.append(WarningRecord(
                    id=f"BT-{street[:2]}-{curr.time.replace(' ', '').replace(':', '')}-{window}h",
                    level=level,
                    label=level_info["label"],
                    type=warn_type,
                    street=street,
                    action=level_info["action"],
                    change_rate=round(change_rate, 3),
                    abs_change_kw=round(abs_change_kw, 2),
                    from_time=curr.time,
                    to_time=target.time,
                    from_power_kw=curr.predicted_power_kw,
                    to_power_kw=target.predicted_power_kw,
                    issued_at=now_str,
                    weather_from=curr.weather_text,
                    weather_to=target.weather_text,
                ))

        return warnings

    async def backtest_range(self, start_date: date, end_date: date) -> list[dict]:
        """对日期范围进行批量回测"""
        results = []
        current = start_date
        while current <= end_date:
            result = await self.backtest_date(current)
            results.append(result)
            current += timedelta(days=1)
        return results
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/zjz/Documents/pv-output-warning-system/backend
python3 -m pytest tests/test_history.py -v
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/history.py backend/tests/test_history.py
git commit -m "feat: add historical weather service with caching and backtest"
```

---

## Task 3: History API Endpoints

**Files:**
- Create: `backend/app/api/history.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create history API router**

```python
# backend/app/api/history.py
"""历史天气与回测API"""

from datetime import date, timedelta

from fastapi import APIRouter, Query

from app.services.history import HistoricalWeatherService

router = APIRouter()
history_service = HistoricalWeatherService()


@router.get("/weather/{target_date}")
async def get_historical_weather(target_date: date):
    """获取指定日期的历史天气数据（实际观测）"""
    hourly = await history_service.get_historical_weather(target_date)
    if hourly is None:
        return {"error": "无法获取历史天气数据", "date": str(target_date)}
    return {
        "date": str(target_date),
        "hourly": [h.model_dump() for h in hourly],
    }


@router.get("/backtest/{target_date}")
async def backtest_date(target_date: date):
    """对指定日期进行回测"""
    return await history_service.backtest_date(target_date)


@router.get("/backtest-range")
async def backtest_range(
    start: date = Query(..., description="起始日期 yyyy-MM-dd"),
    end: date = Query(..., description="结束日期 yyyy-MM-dd"),
):
    """对日期范围进行批量回测"""
    # 限制最多30天
    if (end - start).days > 30:
        return {"error": "范围不能超过30天"}
    results = await history_service.backtest_range(start, end)
    return {
        "start": str(start),
        "end": str(end),
        "days": len(results),
        "results": results,
    }


@router.post("/fetch-range")
async def fetch_and_cache_range(
    start: date = Query(..., description="起始日期"),
    end: date = Query(..., description="结束日期"),
):
    """批量获取并缓存历史天气数据"""
    fetched = []
    failed = []
    current = start
    while current <= end:
        hourly = await history_service.get_historical_weather(current)
        if hourly:
            fetched.append(str(current))
        else:
            failed.append(str(current))
        current += timedelta(days=1)
    return {"fetched": fetched, "failed": failed}
```

- [ ] **Step 2: Register router in main.py**

Add this import and router registration to `backend/app/main.py`:

```python
# Add import
from app.api import weather, forecast, warning, pv_users, history

# Add router (after existing routers)
app.include_router(history.router, prefix="/api/history", tags=["历史回测"])
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/history.py backend/app/main.py
git commit -m "feat: add history API endpoints for backtest and historical review"
```

---

## Task 4: Frontend — History API Types and Methods

**Files:**
- Modify: `frontend/src/api.ts`

- [ ] **Step 1: Add history types and API methods**

Add to the end of `frontend/src/api.ts`, before the closing of the `api` object:

```typescript
// Add these interfaces after existing ones:

export interface BacktestResult {
  date: string
  weather_hourly: HourlyWeather[]
  predictions: Record<string, PowerPrediction[]>
  warnings: WarningRecord[]
  summary: {
    total_warnings: number
    by_level: Record<string, number>
  }
}

// Add these methods to the api object:
  getHistoricalWeather: (date: string) =>
    fetchJSON<{ date: string; hourly: HourlyWeather[] }>(`/history/weather/${date}`),
  getBacktest: (date: string) =>
    fetchJSON<BacktestResult>(`/history/backtest/${date}`),
  getBacktestRange: (start: string, end: string) =>
    fetchJSON<{ start: string; end: string; days: number; results: BacktestResult[] }>(
      `/history/backtest-range?start=${start}&end=${end}`
    ),
  fetchHistoryRange: (start: string, end: string) =>
    fetchJSON<{ fetched: string[]; failed: string[] }>(
      `/history/fetch-range?start=${start}&end=${end}`, 'POST'
    ),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.ts
git commit -m "feat: add history API types and methods to frontend"
```

---

## Task 5: Frontend — History Panel Component

**Files:**
- Create: `frontend/src/components/HistoryPanel.tsx`
- Modify: `frontend/src/components/SideMenu.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Create HistoryPanel**

```tsx
// frontend/src/components/HistoryPanel.tsx
import { memo, useState, useCallback } from 'react'
import { api, BacktestResult, WarningRecord } from '../api'

interface Props {
  onClose: () => void
  onStreetClick: (street: string) => void
}

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  red:    { color: 'var(--solar-coral)', bg: 'rgba(224,100,86,0.06)' },
  orange: { color: 'var(--solar-amber)', bg: 'rgba(219,161,74,0.06)' },
  yellow: { color: 'var(--solar-yellow)', bg: 'rgba(232,200,74,0.06)' },
  blue:   { color: 'var(--solar-teal)', bg: 'rgba(82,196,184,0.06)' },
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

export default memo(function HistoryPanel({ onClose, onStreetClick }: Props) {
  const today = new Date()
  const minDate = new Date(today)
  minDate.setDate(today.getDate() - 9)

  const [selectedDate, setSelectedDate] = useState(formatDate(new Date(today.getTime() - 86400000)))
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runBacktest = useCallback(async (dateStr: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getBacktest(dateStr)
      setResult(data)
    } catch (e) {
      setError('回测失败，请重试')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedDate(e.target.value)
  }

  const fmtPower = (kw: number) => kw >= 1000 ? `${(kw / 1000).toFixed(1)}MW` : `${Math.round(kw)}kW`

  return (
    <section aria-label="历史回测" className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-1 h-5 rounded-full" style={{ background: 'var(--solar-gold)', boxShadow: '0 0 12px rgba(245,194,82,0.3)' }} />
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, color: 'var(--text-bright)', margin: 0 }}>
            历史回测
          </h2>
        </div>
        <button onClick={onClose} aria-label="关闭" className="cursor-pointer w-11 h-11 flex items-center justify-center rounded-lg transition-colors active:scale-95 -mr-2"
          style={{ color: 'var(--text-muted)', fontSize: 16 }}>
          <span className="w-6 h-6 flex items-center justify-center rounded-lg" style={{ background: 'var(--bg-surface)' }}>&times;</span>
        </button>
      </div>

      <div className="px-4 pb-2">
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--text-muted)' }}>
          基于历史实际天气数据（非预报），验证预警算法效果
        </div>
      </div>

      {/* Date picker + run */}
      <div className="px-4 pb-3 flex items-center gap-2">
        <input
          type="date"
          value={selectedDate}
          min={formatDate(minDate)}
          max={formatDate(new Date(today.getTime() - 86400000))}
          onChange={handleDateChange}
          className="flex-1 px-2 py-1.5 rounded"
          style={{
            fontFamily: 'var(--font-data)', fontSize: 11,
            background: 'var(--bg-surface)', color: 'var(--text-bright)',
            border: '1px solid var(--border-subtle)', outline: 'none',
          }}
        />
        <button
          onClick={() => runBacktest(selectedDate)}
          disabled={loading}
          className="px-3 py-1.5 rounded transition-all active:scale-95"
          style={{
            fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 600,
            background: 'var(--solar-amber)', color: 'var(--bg-deep)',
            border: 'none', cursor: loading ? 'wait' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>
          {loading ? '分析中...' : '运行回测'}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {error && (
          <div className="py-4 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--solar-coral)' }}>
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="py-8 text-center" style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--text-muted)' }}>
            选择日期并运行回测
          </div>
        )}

        {result && (
          <>
            {/* Summary */}
            <div className="mb-3 p-3 rounded" style={{ background: 'var(--bg-surface)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>
                  {result.date} 回测结果
                </span>
                <span className="data-value" style={{ fontSize: 10, color: result.summary.total_warnings > 0 ? 'var(--solar-coral)' : 'var(--solar-green)' }}>
                  {result.summary.total_warnings} 条预警
                </span>
              </div>
              <div className="flex gap-2">
                {Object.entries(result.summary.by_level).map(([level, count]) => {
                  if (count === 0) return null
                  const s = LEVEL_STYLE[level]
                  return (
                    <span key={level} className="data-value px-2 py-0.5 rounded"
                      style={{ fontSize: 9, background: s?.bg, color: s?.color, border: `1px solid ${s?.color}` }}>
                      {level === 'red' ? '红' : level === 'orange' ? '橙' : level === 'yellow' ? '黄' : '蓝'} {count}
                    </span>
                  )
                })}
              </div>
            </div>

            {/* Weather timeline */}
            {result.weather_hourly && result.weather_hourly.length > 0 && (
              <div className="mb-3">
                <div className="tag-label mb-1.5 px-1" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  当日实际天气（发电时段）
                </div>
                <div className="flex gap-0.5 overflow-x-auto pb-1">
                  {result.weather_hourly
                    .filter(h => {
                      const hr = parseInt(h.time.split(' ')[1]?.split(':')[0] || '0')
                      return hr >= 6 && hr <= 18
                    })
                    .map(h => {
                      const hr = h.time.split(' ')[1]?.slice(0, 5)
                      return (
                        <div key={h.time} className="text-center px-1 py-1 rounded"
                          style={{ minWidth: 36, background: 'var(--bg-surface)', fontSize: 8 }}>
                          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{hr}</div>
                          <div style={{ fontSize: 10, lineHeight: 1.4 }}>{h.text}</div>
                          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>{h.temp}°</div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}

            {/* Warning list */}
            {result.warnings.length === 0 ? (
              <div className="py-6 text-center">
                <div style={{ fontSize: 24, marginBottom: 8 }}>✓</div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--solar-green)' }}>
                  当日无预警触发
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                  天气变化未达到预警阈值
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="tag-label mb-1 px-1" style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                  回测预警详情
                </div>
                {result.warnings.map((w: WarningRecord, i: number) => {
                  const s = LEVEL_STYLE[w.level] || LEVEL_STYLE.blue
                  const fromH = w.from_time.split(' ')[1]?.slice(0, 5)
                  const toH = w.to_time.split(' ')[1]?.slice(0, 5)
                  return (
                    <div key={w.id}
                      className="px-3 py-2 animate-in cursor-pointer"
                      style={{
                        background: s.bg,
                        borderLeft: `2.5px solid ${s.color}`,
                        animationDelay: `${0.02 + i * 0.015}s`,
                      }}
                      onClick={() => onStreetClick(w.street)}>
                      <div className="flex items-center gap-2">
                        <span className="data-value" style={{ fontSize: 9, color: s.color }}>{w.label}</span>
                        <span className="data-value" style={{
                          fontSize: 9,
                          color: w.type === 'ramp_down' ? 'var(--solar-coral)' : 'var(--solar-green)',
                        }}>
                          {w.type === 'ramp_down' ? '↓ 骤降' : '↑ 骤增'} {Math.round(w.change_rate * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1" style={{ fontFamily: 'var(--font-data)', fontSize: 10 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{w.street}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fromH}→{toH}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.from_power_kw)}</span>
                        <span style={{ color: s.color }}>{w.type === 'ramp_down' ? '▾' : '▴'}</span>
                        <span style={{ color: 'var(--text-bright)' }}>{fmtPower(w.to_power_kw)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5" style={{ fontFamily: 'var(--font-data)', fontSize: 9 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{w.weather_from}→{w.weather_to}</span>
                        <span style={{ color: s.color }}>
                          Δ{w.abs_change_kw >= 1000 ? `${(w.abs_change_kw / 1000).toFixed(1)}MW` : `${Math.round(w.abs_change_kw)}kW`}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
})
```

- [ ] **Step 2: Add 'history' to SideMenu**

Read `SideMenu.tsx` to find the PanelType definition and menu items. Add `'history'` to the PanelType union and a new menu button for it.

In `SideMenu.tsx`, update `PanelType`:
```typescript
export type PanelType = 'weather' | 'warnings' | 'history' | null
```

Add a history button after the existing menu items, using a clock/history icon.

- [ ] **Step 3: Add HistoryPanel to App.tsx**

In `App.tsx`:
- Import HistoryPanel: `import HistoryPanel from './components/HistoryPanel'`
- Add rendering in the side panel section (alongside weather and warnings panels):

```tsx
{activePanel === 'history' && (
  <HistoryPanel
    onClose={() => setActivePanel(null)}
    onStreetClick={handleStreetClick}
  />
)}
```

- [ ] **Step 4: Build and verify**

```bash
cd frontend && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vite build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/HistoryPanel.tsx frontend/src/components/SideMenu.tsx frontend/src/App.tsx
git commit -m "feat: add history panel with backtest UI"
```

---

## Task 6: Fetch and Cache April 1–3 Data, Deploy & Verify

**Files:** None (deployment + data fetching)

- [ ] **Step 1: Deploy backend to server**

```bash
cd /Users/zjz/Documents/pv-output-warning-system
scp backend/app/core/constants.py test-vps:/opt/pv-warning/backend/app/core/constants.py
scp backend/app/services/history.py test-vps:/opt/pv-warning/backend/app/services/history.py
scp backend/app/api/history.py test-vps:/opt/pv-warning/backend/app/api/history.py
scp backend/app/main.py test-vps:/opt/pv-warning/backend/app/main.py
ssh test-vps "systemctl restart pv-warning"
```

- [ ] **Step 2: Deploy frontend**

```bash
cd frontend && ./node_modules/.bin/vite build
scp -r dist/* test-vps:/var/www/pv-warning/
```

- [ ] **Step 3: Fetch and cache April 1–3 historical data**

```bash
ssh test-vps "curl -s --compressed 'http://localhost:8800/api/history/fetch-range?start=2026-04-01&end=2026-04-03' -X POST" | python3 -m json.tool
```

Expected: `{"fetched": ["2026-04-01", "2026-04-02", "2026-04-03"], "failed": []}`

- [ ] **Step 4: Run backtest on April 1–3**

```bash
ssh test-vps "curl -s 'http://localhost:8800/api/history/backtest-range?start=2026-04-01&end=2026-04-03'" | python3 -m json.tool | head -60
```

Verify: Each day returns predictions and any warnings that the algorithm detected.

- [ ] **Step 5: Verify in browser**

Open http://43.167.177.60/pv, click the history icon in the side menu, select a date, run backtest.

- [ ] **Step 6: Commit cached data**

```bash
git add data/history/
git commit -m "data: cache April 1-3 historical weather for backtest"
```
