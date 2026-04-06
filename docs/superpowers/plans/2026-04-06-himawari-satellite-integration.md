# 向日葵卫星数据接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 接入 JAXA P-Tree 向日葵-9 卫星数据，实现基于卫星实测的 GHI 空间可视化、出力精算、云运动追踪和超短期骤变预警。

**Architecture:** 每 10 分钟从 FTP 下载卫星 NetCDF → 提取金山区 51 网格的 SWR/云属性 → 写入 PostgreSQL → 驱动前端实时蜂窝色度 + 云追踪预警。

**Tech Stack:** Python (netCDF4, numpy), asyncio FTP, PostgreSQL, 现有 FastAPI + React 框架

---

## 数据源信息

| 参数 | 值 |
|------|-----|
| FTP 地址 | ftp.ptree.jaxa.jp |
| 账号 | linekerzhu_gmail.com / SP+wari8 |
| SWR 产品路径 | /pub/himawari/L2/PAR/021/YYYYMM/DD/HH/ |
| Cloud 产品路径 | /pub/himawari/L2/CLP/010/YYYYMM/DD/HH/ |
| 文件格式 | NetCDF4 (.nc) |
| SWR 文件大小 | ~45 MB (5km 全球) |
| Cloud 文件大小 | ~25 MB (5km 全球) |
| 更新频率 | 每 10 分钟 |
| 数据延迟 | ~20-30 分钟 (卫星→JAXA处理→FTP) |
| 金山区坐标 | lat 30.7-31.0, lon 120.9-121.5 |
| 金山区像素数 | ~12×20 = 240 pixels (5km grid) |

## 已验证的性能指标

| 操作 | 耗时 |
|------|------|
| FTP 下载 SWR 文件 (45MB) | ~15s |
| FTP 下载 Cloud 文件 (25MB) | ~8s |
| NetCDF 解析 + 51 网格 SWR 提取 | 27ms |
| NetCDF 解析 + 51 网格云属性提取 | 59ms |
| 金山区域原始波段裁切 | 12ms |
| **总 10 分钟周期** | **~25s (下载) + <200ms (解析)** |

---

## Phase 1 (P0): SWR 替代和风 GHI — 基础接入

### 目标
- 每 10 分钟获取卫星实测 SWR，替代和风 API 的 GHI 数据
- 51 个蜂窝网格显示真实卫星 GHI（替代 mock 数据）
- 免费 + 10 分钟更新 + 5km 真实分辨率

### DB Schema

```sql
-- 卫星观测数据（每 10 分钟，51 网格）
CREATE TABLE satellite_ghi (
    grid_id     TEXT NOT NULL,          -- 'H-2-5' 蜂窝格ID
    obs_time    TIMESTAMPTZ NOT NULL,   -- 卫星观测时间
    swr         DOUBLE PRECISION,       -- 原始 SWR (W/m²)
    ghi         DOUBLE PRECISION,       -- 校正后 GHI = SWR × 0.98
    qa_flag     INTEGER,                -- 质量标志 (0=陆地, 3=云, etc.)
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (grid_id, obs_time)
);

CREATE INDEX idx_sat_ghi_time ON satellite_ghi (obs_time DESC);
```

### 后端

**新建 `app/services/satellite_collector.py`:**

```
class SatelliteCollector:
    """每 10 分钟从 P-Tree FTP 下载向日葵数据"""

    async def collect_swr(self) -> int:
        """下载最新 SWR NetCDF → 提取 51 网格 → 写入 satellite_ghi 表"""
        1. 计算最新可用时间 (当前时间 - 30min, 向下取整到 10min)
        2. 构造 FTP 路径: /pub/himawari/L2/PAR/021/YYYYMM/DD/HH/
        3. 下载 H09_YYYYMMDD_HHMM_RFL021_FLDK.02801_02401.nc
        4. 打开 NetCDF, 读取 SWR 变量
        5. 对 51 个蜂窝格坐标, 找最近像素, 提取 SWR 值
        6. GHI = SWR × 0.98 (校正系数)
        7. UPSERT 到 satellite_ghi 表
        8. 返回成功行数
```

**新建 `app/repositories/satellite_repo.py`:**

```
class SatelliteRepo:
    async def upsert_ghi(grid_id, obs_time, swr, ghi, qa_flag)
    async def get_latest_ghi() -> list[dict]  # 最新一帧的 51 格
    async def get_ghi_history(grid_id, hours=6) -> list[dict]
    async def get_district_ghi_summary() -> dict  # 区级均值/极值
```

**新增 API 端点:**

```
GET /api/satellite/ghi/latest    → 51 格最新 GHI + 观测时间
GET /api/satellite/ghi/{grid_id} → 单格 6 小时历史
```

**调度器:** `main.py` 新增 10 分钟定时任务

### 前端

- `GhiGridOverlay`: mock GHI 替换为 `/api/satellite/ghi/latest` 真实数据
- 蜂窝色度实时反映卫星 GHI
- 左侧面板显示最新观测时间 + 数据源标识 "HIMAWARI-9"

### 数据流

```
每 10 分钟:
  FTP → 下载 SWR NetCDF (45MB, ~15s)
      → 解析提取 51 格 GHI (~27ms)
      → UPSERT satellite_ghi 表
      → 前端轮询 API 更新色度
```

---

## Phase 2 (P1): 云属性分析 + 强对流检测

### 目标
- 获取云类型、云顶高度、云顶温度、光学厚度
- 检测积雨云发展（云顶温度 10 分钟内急降 >10K）
- 生成"强对流发展中"预警，提前 30-60 分钟

### DB Schema

```sql
-- 云属性（每 10 分钟，51 网格）
CREATE TABLE satellite_cloud (
    grid_id         TEXT NOT NULL,
    obs_time        TIMESTAMPTZ NOT NULL,
    cloud_type      INTEGER,            -- ISCCP 云分类 (0-9)
    optical_thickness DOUBLE PRECISION, -- 云光学厚度
    top_height_km   DOUBLE PRECISION,   -- 云顶高度 (km)
    top_temp_k      DOUBLE PRECISION,   -- 云顶温度 (K)
    effective_radius DOUBLE PRECISION,  -- 云粒子有效半径 (μm)
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (grid_id, obs_time)
);
```

### 强对流检测算法

```python
def detect_convective_development(grid_id: str,
                                   history: list[CloudObs]) -> Alert | None:
    """检测积雨云发展 — 云顶温度急降"""
    if len(history) < 3:  # 需要至少 30min 历史
        return None

    recent = history[-1]  # 最新
    prev = history[-3]    # 20 分钟前

    temp_drop = prev.top_temp_k - recent.top_temp_k  # 温度下降量
    height_rise = recent.top_height_km - prev.top_height_km  # 高度上升量

    if temp_drop > 10 and height_rise > 2 and recent.top_height_km > 8:
        return Alert(
            type="convective_development",
            grid_id=grid_id,
            message=f"积雨云发展中，云顶{recent.top_height_km:.0f}km，"
                    f"20min内温降{temp_drop:.0f}K，预计30-60min影响出力",
            severity="warning",
        )
    return None
```

### 前端

- 蜂窝格 tooltip 增加云属性信息（云类型图标、云顶高度）
- 有强对流发展时，对应网格边框变红脉冲
- 左侧面板显示对流预警信息

---

## Phase 3 (P2): 云运动矢量追踪 + 空间传播预测

### 目标
- 分析连续 3 帧卫星图像，计算云移动方向和速度
- 预测未来 10-30 分钟各网格 GHI 变化
- 告诉调度员："东贤变电站 10 分钟后将被云团覆盖"

### 算法：光流法云运动矢量

```python
def compute_cloud_motion_vector(
    frame_t0: np.ndarray,   # SWR grid at T-20min
    frame_t1: np.ndarray,   # SWR grid at T-10min
    frame_t2: np.ndarray,   # SWR grid at T (current)
) -> tuple[float, float]:  # (dlat_per_10min, dlon_per_10min)
    """
    对金山区 ~12×20 像素区域做光流计算

    方法:
      1. 对 frame_t1 和 frame_t2 做块匹配 (block matching)
      2. 或用 Lucas-Kanade 光流
      3. 提取主导运动方向和速度

    输出: 云团每 10 分钟在 lat/lon 方向的位移
    """
```

### GHI 外推预测

```python
def nowcast_ghi(
    current_ghi: dict[str, float],    # {grid_id: ghi}
    motion_vector: tuple[float, float],  # (dlat, dlon) per 10min
    minutes_ahead: int = 30,
) -> dict[str, float]:                # {grid_id: predicted_ghi}
    """
    将当前 GHI 场沿运动矢量平移，得到未来 GHI 预测

    例: 云从西向东移动 5km/10min
        → 当前被云遮挡的网格，30min 后云已移走 → GHI 恢复
        → 当前晴空的东侧网格，30min 后将被云覆盖 → GHI 骤降
    """
```

### 变电站级预警

```python
def predict_substation_impact(
    nowcast: dict[str, float],        # 预测 GHI per grid
    user_grid_map: dict[str, str],    # PV user → grid mapping
    user_substation: dict[str, str],  # PV user → substation
) -> list[SubstationAlert]:
    """
    聚合: 预测 GHI → PV 用户出力 → 变电站总出力
    对比当前出力, 如果变化 >40% capacity → 预警

    输出: "东贤变电站 10min 后预计出力从 3.8MW 降至 1.2MW"
    """
```

### 前端

- 地图上显示云运动方向箭头
- 网格显示"预测 GHI"（渐变色，当前→预测）
- 变电站标注显示预测出力变化

---

## Phase 4 (P3): 高级分析

### 波动指数

```python
def daily_volatility_index(ghi_series: list[float]) -> str:
    """
    一天 144 个 GHI 数据点 (10min × 24h, 白天约 84 个)
    CV = std / mean

    CV < 0.1  → "稳定" (晴天或阴天)
    CV 0.1-0.3 → "轻度波动"
    CV > 0.3  → "剧烈波动" (M形曲线)
    """
```

### 霾天衰减分析

利用 SWR 文件中已有的 `TAOT_02`（气溶胶光学厚度）：
- AOT < 0.2 → "大气洁净"
- AOT 0.2-0.5 → "轻度霾, GHI 衰减 ~10%"
- AOT > 0.5 → "重度霾, GHI 衰减 ~25%"

### 云影面积监控

```python
def cloud_shadow_fraction(ghi_grid: dict[str, float]) -> float:
    """
    被云遮挡的网格比例 = count(GHI < clearsky * 0.5) / total_grids
    → 前端显示: "当前金山区 35% 面积被云覆盖"
    """
```

---

## 和风 API 保留策略

| 数据 | 来源变更 |
|------|---------|
| 实时 GHI | 和风 → **向日葵 SWR** |
| 天气预报文字 (晴/雨/多云) | **保留和风** — 卫星无此产品 |
| 72h 天气预报 | **保留和风** — 卫星只有实测无预报 |
| 温度/湿度/风速 | **保留和风** |
| 历史天气观测 | **保留和风** 历史 API |
| DNI/DHI | 和风 → **删除** — 我们只用 GHI 算出力 |

和风 API 调用量变化: 60次/小时 → **10次/小时**（只保留天气预报，去掉 50 次 GHI 调用）

---

## 实施节奏

| Phase | 工作量 | 依赖 | 产出 |
|-------|--------|------|------|
| P0: SWR 接入 | 1 天 | 无 | 免费实时 GHI, 前端真实色度 |
| P1: 云分析 + 对流检测 | 1 天 | P0 | 强对流提前 30-60min 预警 |
| P2: 云运动追踪 | 2 天 | P1 | 变电站级 10-30min 超短期预警 |
| P3: 高级分析 | 1 天 | P0 | 波动指数、霾天分析 |

**建议执行顺序: P0 → P1 → P3 → P2**
（P2 依赖光流算法，技术复杂度最高，放最后）

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| FTP 不稳定/超时 | 10min 数据缺失 | 重试 3 次, 失败则用上一帧数据 |
| 卫星维护/异常 | 数小时无数据 | 自动回退到和风 API GHI |
| 5km 分辨率不足 | 相邻网格共享像素 | 可接受, 强对流尺度 >10km |
| 服务器磁盘占用 | 每天 6.5GB NetCDF | 下载→解析→删除, 不保留原始文件 |
| 夜间无 SWR 数据 | 夜间无太阳辐射 | 正常, 夜间 GHI=0 不影响 |
| 数据使用合规 | JAXA 条款限制 | 2026.2后可商用, 不可转发原始数据 |
