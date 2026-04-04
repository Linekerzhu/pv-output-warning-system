"""预警引擎：检测光伏出力曲线的异常形态

应用场景：晴天强对流、巨型云团遮挡等突发事件造成的出力骤变。

分析一整天的出力曲线（power_kw 序列），检测两类异常：
  A. M形/多峰波动 — 强对流反复穿过，出力多次骤降骤升
  B. 晴空骤降 — 高峰期突然断崖式下降，持续到傍晚

算法：
  1. 提取发电时段（9:00-16:00）的 power_kw 序列
  2. 找出相邻小时间的功率骤变（|Δpower| / capacity ≥ 阈值）
  3. 统计骤变次数和最大骤变幅度
  4. 每个区域每天最多 1 条预警

出力公式：power_kw = capacity_kw × (GHI / 1000) × PR
  PR (Performance Ratio) 约 0.80，包含逆变器、线损、温度等综合效率。
"""

from datetime import date, datetime
from dataclasses import dataclass

from app.core.config import settings
from app.core.constants import SHANGHAI_TZ, WARNING_ACTION, WARNING_LABEL
from app.models.warning_record import PowerPrediction, WarningRecord


@dataclass
class SwingEvent:
    """一次骤变事件"""
    from_hour: str      # "2026-04-05 12:00"
    to_hour: str        # "2026-04-05 13:00"
    from_power: float   # kW
    to_power: float     # kW
    swing_kw: float     # |Δ|
    swing_ratio: float  # |Δ| / capacity
    direction: str      # "ramp_down" or "ramp_up"


class WarningService:
    """出力曲线形态分析预警引擎 — 纯计算，不涉及存储"""

    def _find_swings(
        self,
        predictions: list[PowerPrediction],
        capacity_kw: float,
    ) -> list[SwingEvent]:
        """找出所有显著骤变事件。

        扫描相邻小时的 power_kw 差值，超过阈值的记录为骤变事件。
        """
        threshold_kw = capacity_kw * settings.WARNING_SWING_THRESHOLD
        swings: list[SwingEvent] = []

        for i in range(len(predictions) - 1):
            curr = predictions[i]
            next_p = predictions[i + 1]

            # 跨日不检测
            if curr.time.split(" ")[0] != next_p.time.split(" ")[0]:
                continue

            delta = next_p.power_kw - curr.power_kw
            abs_delta = abs(delta)

            if abs_delta >= threshold_kw:
                swings.append(SwingEvent(
                    from_hour=curr.time,
                    to_hour=next_p.time,
                    from_power=curr.power_kw,
                    to_power=next_p.power_kw,
                    swing_kw=abs_delta,
                    swing_ratio=abs_delta / capacity_kw,
                    direction="ramp_down" if delta < 0 else "ramp_up",
                ))

        return swings

    def evaluate_predictions(
        self,
        name: str,
        predictions: list[PowerPrediction],
        capacity_kw: float,
        is_historical: bool = False,
    ) -> list[WarningRecord]:
        """分析出力曲线形态，检测骤变事件。

        每个区域每天最多 1 条预警。

        Args:
            name: 区域名称（街道名或"金山区"）
            predictions: 时序预测列表（已按时间排序）
            capacity_kw: 该区域总装机容量 (kW)
            is_historical: True 时分析全部数据，False 时只分析未来时段
        """
        if len(predictions) < 2 or capacity_kw <= 0:
            return []

        now = datetime.now(SHANGHAI_TZ)

        # 按日分组
        by_date: dict[str, list[PowerPrediction]] = {}
        for p in predictions:
            d = p.time.split(" ")[0]

            # 非历史模式：跳过已过去的小时
            if not is_historical:
                try:
                    hour = int(p.time.split(" ")[1].split(":")[0])
                    p_date = date.fromisoformat(d)
                    if p_date == now.date() and hour < now.hour:
                        continue
                except (IndexError, ValueError):
                    continue

            if d not in by_date:
                by_date[d] = []
            by_date[d].append(p)

        warnings: list[WarningRecord] = []

        for day_str, day_preds in by_date.items():
            if len(day_preds) < 2:
                continue

            # 找出该天的所有显著骤变
            swings = self._find_swings(day_preds, capacity_kw)
            if not swings:
                continue

            # 最大骤变
            max_swing = max(swings, key=lambda s: s.swing_kw)
            swing_count = len(swings)

            # 判断形态
            has_down = any(s.direction == "ramp_down" for s in swings)
            has_up = any(s.direction == "ramp_up" for s in swings)

            if has_down and has_up:
                warn_type = "oscillation"  # M形波动
            elif has_down:
                warn_type = "ramp_down"    # 晴空骤降
            else:
                warn_type = "ramp_up"      # 骤升

            # 构建预警描述
            swing_mw = max_swing.swing_kw / 1000
            action = (
                f"{WARNING_ACTION} | "
                f"预计{swing_count}次骤变，最大{swing_mw:.1f}MW"
                f"（{max_swing.swing_ratio:.0%}装机）"
            )

            warning = WarningRecord(
                id=f"W-{name[:4]}-{day_str.replace('-', '')}-{warn_type}",
                level="warning",
                label=WARNING_LABEL,
                type=warn_type,
                street=name,
                action=action,
                change_rate=round(max_swing.swing_ratio, 3),
                abs_change_kw=round(max_swing.swing_kw, 2),
                from_time=max_swing.from_hour,
                to_time=max_swing.to_hour,
                from_power_kw=round(max_swing.from_power, 2),
                to_power_kw=round(max_swing.to_power, 2),
                issued_at=now.isoformat(),
                weather_from=day_preds[0].weather_text,
                weather_to=day_preds[-1].weather_text,
            )
            warnings.append(warning)

        return warnings
