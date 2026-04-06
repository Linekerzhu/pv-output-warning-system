# 第一座山：卫星数据 → 网格 GHI 工程化方案

## 一、方法论

### 目标

每 10 分钟从向日葵-9 卫星获取金山区 51 个蜂窝网格的真实 GHI 观测值，写入数据库，驱动前端实时可视化。

### 数据链路

```
JAXA P-Tree FTP
  → 下载 SWR NetCDF (5km全球, ~45MB)
  → 提取金山区像素 (lat 30.6-31.0, lon 120.9-121.5)
  → 51个蜂窝格 ← 匹配最近卫星像素
  → SWR × 0.98 = GHI (校正)
  → QA 标志检查 (云/陆地/异常)
  → UPSERT satellite_ghi 表
  → 清理临时 NetCDF 文件
```

### 核心原则

1. **下载即删除** — NetCDF 文件 45MB，解析后删除，不占磁盘
2. **幂等写入** — UPSERT，重复运行不产生脏数据
3. **故障静默** — FTP 超时/文件缺失 → 记日志跳过，不影响系统
4. **数据标注** — 每条记录标明 QA 状态，消费者按需过滤

---

## 二、技术栈

| 组件 | 技术 | 说明 |
|------|------|------|
| FTP 客户端 | `ftplib` (标准库) | 在 `asyncio.to_thread` 中运行，不阻塞事件循环 |
| NetCDF 解析 | `netCDF4` + `numpy` | pip install netCDF4 (自带 HDF5 wheel) |
| 定时调度 | APScheduler (已有) | 新增 10 分钟 interval job |
| 数据库 | asyncpg (已有) | 新增 satellite_ghi 表 |
| 坐标匹配 | numpy.argmin | 蜂窝格中心 → 最近卫星像素 |
| 临时文件 | tempfile | 下载到 /tmp，解析后删除 |

### 服务器安装

```bash
pip3 install netCDF4
# netCDF4 的 wheel 包自带编译好的 libhdf5 和 libnetcdf
# 不需要 yum install hdf5-devel
```

---

## 三、数据库设计

```sql
CREATE TABLE satellite_ghi (
    grid_id     TEXT NOT NULL,
    obs_time    TIMESTAMPTZ NOT NULL,
    swr         DOUBLE PRECISION,       -- 原始 SWR (W/m²)
    ghi         DOUBLE PRECISION,       -- GHI = SWR × 0.98
    qa_flag     INTEGER,                -- 0:陆地 3:云 6:高天顶角 7:高太阳角
    is_valid    BOOLEAN DEFAULT TRUE,   -- qa_flag 筛选后的可用标记
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (grid_id, obs_time)
);

CREATE INDEX idx_sat_ghi_time ON satellite_ghi (obs_time DESC);
CREATE INDEX idx_sat_ghi_grid_time ON satellite_ghi (grid_id, obs_time DESC);

-- 定期清理：保留 30 天
-- 由 cleanup_old_data() 执行
```

### QA 标志含义 (来自 JAXA README)

| bit | 含义 | 对 GHI 的影响 |
|-----|------|-------------|
| 0 | 陆地 | ✅ 正常使用 |
| 1 | 内陆水体 | ✅ 正常使用 |
| 2 | 太阳耀斑 >0.05 | ⚠️ GHI 可能偏高 |
| 3 | 云 | ✅ GHI 已考虑云衰减 |
| 4 | AOT>1 | ⚠️ 重霾，GHI 不确定性大 |
| 5 | 超出气溶胶模型 | ⚠️ 标记但仍可用 |
| 6 | 卫星天顶角 >70° | ❌ 数据不可靠 |
| 7 | 太阳天顶角 >67° | ❌ 日出日落边缘，不可靠 |

**is_valid 规则：** `qa_flag` 的 bit6 和 bit7 均为 0 时 `is_valid = TRUE`

---

## 四、后端实现

### 文件结构

```
backend/app/services/
  satellite_collector.py    # 新增: FTP下载 + NetCDF解析
backend/app/repositories/
  satellite_repo.py         # 新增: satellite_ghi 表读写
backend/app/api/
  satellite.py              # 新增: API 端点
backend/scripts/
  init_satellite.sql        # 新增: DDL
backend/requirements.txt    # 新增: netCDF4
```

### SatelliteCollector 核心方法

```python
class SatelliteCollector:
    """每 10 分钟从 P-Tree FTP 下载向日葵 SWR 数据"""

    FTP_HOST = "ftp.ptree.jaxa.jp"
    FTP_USER = "linekerzhu_gmail.com"
    FTP_PASS = "SP+wari8"
    SWR_PATH = "/pub/himawari/L2/PAR/021/{yyyymm}/{dd}/{hh}/"
    SWR_FNAME = "H09_{yyyymmdd}_{hhmm}_RFL021_FLDK.02801_02401.nc"
    GHI_CORRECTION = 0.98

    async def collect(self) -> int:
        """主入口：下载 → 解析 → 存储。返回成功行数。"""
        # 1. 计算最新可用文件时间 (当前 UTC - 20min, 取整到 10min)
        target_time = self._latest_available_time()

        # 2. FTP 下载到临时文件
        nc_path = await asyncio.to_thread(
            self._ftp_download, target_time
        )
        if nc_path is None:
            return 0

        try:
            # 3. 解析 NetCDF，提取 51 网格 SWR
            grid_data = self._extract_grid_swr(nc_path, target_time)

            # 4. 写入数据库
            count = await self._save_to_db(grid_data)
            return count
        finally:
            # 5. 删除临时文件
            Path(nc_path).unlink(missing_ok=True)

    def _latest_available_time(self) -> datetime:
        """计算 FTP 上最新可用文件的时间"""
        now_utc = datetime.now(timezone.utc)
        # 数据延迟约 20 分钟
        available = now_utc - timedelta(minutes=20)
        # 取整到 10 分钟
        minute = (available.minute // 10) * 10
        return available.replace(minute=minute, second=0, microsecond=0)

    def _ftp_download(self, target_time: datetime) -> str | None:
        """同步 FTP 下载 (在线程池中运行)"""
        # 构造路径
        # 超时 30s, 重试 2 次
        # 下载到 tempfile
        # 返回临时文件路径，失败返回 None

    def _extract_grid_swr(self, nc_path: str,
                           obs_time: datetime) -> list[dict]:
        """从 NetCDF 提取 51 网格的 SWR 值"""
        # 打开 NetCDF
        # 预计算: 51 个蜂窝格中心 → 最近像素索引 (首次缓存)
        # 提取 SWR + QA_flag
        # GHI = SWR × 0.98
        # is_valid = not (qa_flag & 0b11000000)
        # 返回 [{grid_id, obs_time, swr, ghi, qa_flag, is_valid}, ...]

    async def _save_to_db(self, grid_data: list[dict]) -> int:
        """UPSERT 到 satellite_ghi 表"""
```

### 像素匹配策略

```python
# 预计算一次，之后缓存复用
def _build_pixel_index(self, lat: np.ndarray, lon: np.ndarray):
    """51 个蜂窝格 → 最近卫星像素的索引映射"""
    self._pixel_map = {}
    for cell in GHI_GRID:
        lat_idx = np.argmin(np.abs(lat - cell.lat))
        lon_idx = np.argmin(np.abs(lon - cell.lon))
        self._pixel_map[cell.id] = (lat_idx, lon_idx)

    # 检查: 多少个蜂窝格共享同一个像素?
    unique_pixels = len(set(self._pixel_map.values()))
    logger.info(f"51 grids mapped to {unique_pixels} unique satellite pixels")
    # 预期: ~30-40 个唯一像素 (5km卫星 vs 2.7km蜂窝)
```

### API 端点

```python
GET /api/satellite/ghi/latest
  → {obs_time, grids: [{grid_id, ghi, qa_flag, is_valid}, ...]}

GET /api/satellite/ghi/history?grid_id=H-2-5&hours=6
  → {grid_id, data: [{obs_time, ghi, is_valid}, ...]}

GET /api/satellite/status
  → {last_update, delay_minutes, total_grids, valid_grids, coverage_pct}
```

### 调度器 (main.py)

```python
# 新增 10 分钟定时任务
scheduler.add_job(
    satellite_job,
    "interval",
    minutes=10,
    id="satellite_collect",
)
```

---

## 五、验收标准

### 5.1 功能验收

| 编号 | 验收项 | 标准 |
|------|--------|------|
| F1 | FTP 下载成功率 | 连续 24h 测试，成功率 >95% (最多 7 次/144 次失败) |
| F2 | 数据延迟 | 观测时间到入库时间 <3 分钟 |
| F3 | 网格覆盖率 | 白天 (6:00-18:00) 51 格中 is_valid >90% |
| F4 | 数据完整性 | 24h 内无重复行、无 NULL ghi (valid 行) |
| F5 | 临时文件清理 | /tmp 下无残留 .nc 文件 |
| F6 | 故障恢复 | FTP 断线后自动恢复，不影响其他服务 |

### 5.2 精度验收 (交叉验证)

| 编号 | 验证项 | 方法 | 标准 |
|------|--------|------|------|
| A1 | 卫星 GHI vs pvlib 晴空值 | 选晴天，对比 satellite_ghi 与 pvlib clearsky_ghi | 晴天实测/理论 比值在 0.85-1.05 |
| A2 | 卫星 GHI vs 和风 GHI | 同一小时、同一位置，对比两者 | 相关系数 >0.85，偏差 <20% |
| A3 | 日变化曲线合理性 | 白天钟形曲线，夜间为 0 | 目视检查通过 |
| A4 | 空间一致性 | 晴天时 51 格 GHI 应相近 | 标准差 <50 W/m² |
| A5 | 云天响应 | 有云时 GHI 显著低于晴空值 | weather_ratio <0.7 |

---

## 六、验证方法

### 6.1 和风历史数据交叉验证

我们有 4/1-4/5 的和风 GHI 历史数据 (weather_history 表)。回溯下载同期的卫星 SWR 数据进行对比：

```python
async def cross_validate(date: str):
    """下载指定日期的卫星 SWR，与和风 GHI 逐小时对比"""

    # 1. 下载当天 6:00-18:00 UTC (14:00-02:00 北京) 的 SWR
    #    72 个文件 (12h × 6次/h)，聚合到小时均值

    # 2. 从 weather_history 读和风 GHI (小时级)

    # 3. 逐小时对比:
    #    - 散点图: x=和风GHI, y=卫星GHI
    #    - 相关系数 R²
    #    - 偏差: mean(卫星 - 和风) / mean(和风)
    #    - RMSE

    # 4. 输出报告
```

验证日期选择：
- 4/1 晴天 (avg_ghi=177, 正常偏低因含夜间)
- 4/2 晴天 (avg_ghi=175)
- 4/3 阴雨天 (avg_ghi=25, 全天阴)
- 4/5 部分多云 (avg_ghi=312)

→ 覆盖晴天、阴天、多云三种工况

### 6.2 pvlib 晴空值校验

```python
def validate_clearsky(satellite_ghi: float,
                      clearsky_ghi: float,
                      hour: int) -> str:
    """实时自校验: 卫星值不应超过晴空理论值"""

    if clearsky_ghi <= 0:
        return "night"  # 夜间，跳过

    ratio = satellite_ghi / clearsky_ghi

    if ratio > 1.15:
        return f"ANOMALY: satellite ({satellite_ghi}) > clearsky ({clearsky_ghi}) by {ratio:.0%}"
        # 可能原因: 云边缘增强效应(合理)、传感器异常(需排查)
    elif ratio > 1.0:
        return "slight_excess"  # 正常，云边缘增强
    elif ratio > 0.7:
        return "partly_cloudy"
    elif ratio > 0.3:
        return "cloudy"
    else:
        return "heavy_cloud_or_rain"
```

### 6.3 时序连续性校验

```python
def validate_continuity(recent_values: list[float]) -> bool:
    """检查连续 6 帧 (1h) 的 GHI 是否有异常跳变"""

    for i in range(1, len(recent_values)):
        prev, curr = recent_values[i-1], recent_values[i]
        if prev > 100 and curr > 100:  # 都在有效发电范围
            change = abs(curr - prev) / max(prev, curr)
            if change > 0.8:  # 10分钟内变化超80%
                return False  # 可能是数据异常(非天气)
    return True
```

### 6.4 每日自动验证报告

```python
async def daily_validation_report():
    """每天 20:00 自动生成当天的数据质量报告"""

    report = {
        "date": today,
        "total_collections": n,       # 应为 ~84 次 (14h × 6)
        "successful": success,        # 成功次数
        "success_rate": success / n,
        "avg_download_seconds": avg_dl,
        "avg_ghi_daytime": avg_ghi,   # 白天均值
        "max_ghi": max_ghi,
        "clearsky_ratio": avg_ratio,  # vs pvlib
        "anomaly_count": anomalies,   # 超晴空值次数
        "gap_count": gaps,            # 连续缺失 >30min 次数
        "unique_pixels_used": n_pix,  # 卫星像素利用数
    }

    logger.info(f"Daily satellite report: {report}")
    # 写入 DB 供后续趋势分析
```

---

## 七、自校验机制 (运行时)

| 校验 | 触发 | 动作 |
|------|------|------|
| GHI > clearsky × 1.2 | 每次写入 | 标记 `is_valid=False`，日志 WARN |
| 10min 内 GHI 变化 >800 W/m² | 每次写入 | 标记异常，可能是数据错误而非天气 |
| 连续 3 帧 (30min) 全部缺失 | 每次采集 | 日志 ERROR，前端显示"数据中断" |
| 51 格中 is_valid <20% | 每次采集 | 可能是夜间或卫星故障，日志 WARN |
| FTP 下载 >60s | 每次下载 | 日志 WARN，监控网络状况 |
| 和风 vs 卫星偏差 >50% | 每小时 | 日志 WARN，可能某源有问题 |

---

## 八、前端适配

### GhiGridOverlay 改造

```
当前: mockGhi() 函数生成模拟数据
改为: 从 /api/satellite/ghi/latest 获取真实数据

轮询策略: 每 60 秒查一次 API
  (卫星 10 分钟更新，60 秒轮询足够)
  API 返回 obs_time，前端判断是否有新数据
```

### 蜂窝格显示增强

```
Tooltip 内容:
  H-2-5
  GHI 742 W/m²        ← 真实卫星值
  14:20 观测           ← 观测时间
  ☁ 云量: 薄云          ← QA_flag 翻译 (未来 P1 补充)
```

---

## 九、回滚策略

如果卫星数据接入后出现问题：
1. `main.py` 注释掉 `satellite_job` 调度 → 停止采集
2. 前端 `GhiGridOverlay` 回退到 mockGhi() → 不影响展示
3. 现有天气/预报/预警系统完全不受影响（独立模块）

---

## 十、实施步骤

```
Step 1: 服务器环境准备
  - pip install netCDF4
  - 验证 FTP 下载速度 (从腾讯云到 JAXA)
  - 创建 satellite_ghi 表

Step 2: SatelliteCollector 开发
  - FTP 下载 + 重试逻辑
  - NetCDF 解析 + 像素匹配
  - DB 写入 + QA 标志处理

Step 3: 交叉验证 (回溯)
  - 下载 4/1-4/5 的历史卫星 SWR
  - 与和风 GHI 逐小时对比
  - 生成验证报告

Step 4: 调度器集成
  - main.py 新增 10 分钟任务
  - 运行时自校验机制
  - 日报生成

Step 5: API + 前端
  - /api/satellite/* 端点
  - GhiGridOverlay 接真实数据
  - 观测时间显示

Step 6: 持续运行验证
  - 部署后运行 3-5 天
  - 检查日报
  - 确认各项验收标准
```
