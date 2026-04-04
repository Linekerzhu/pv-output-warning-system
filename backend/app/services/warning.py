"""预警引擎：检测光伏出力骤降并分级预警（仅实时/未来，同日内）"""

from datetime import date, datetime, timedelta, timezone

from loguru import logger

from app.core.config import settings
from app.core.constants import JINSHAN_STREETS, WARNING_LEVELS
from app.models.warning_record import WarningRecord
from app.services.forecast import ForecastService


class WarningService:
    """预警引擎"""

    def __init__(self):
        self.forecast_service = ForecastService()
        self._active_warnings: list[WarningRecord] = []
        self._history: list[WarningRecord] = []

    async def evaluate_street(self, street: str, target_date: date | None = None) -> list[WarningRecord]:
        """评估指定街道的骤降预警（仅未来时段、同日内）"""
        predictions = await self.forecast_service.predict_street_power(street, target_date)
        if len(predictions) < 2:
            return []

        # 上海当前时间
        now_shanghai = datetime.utcnow() + timedelta(hours=8)
        now_hour = now_shanghai.hour

        warnings = []
        for i in range(len(predictions) - 1):
            curr = predictions[i]
            next_ = predictions[i + 1]

            # 提取日期和小时
            curr_date = curr.time.split(" ")[0]
            next_date = next_.time.split(" ")[0]

            # 跨日不预警
            if curr_date != next_date:
                continue

            # 只对未来时段预警（当前小时及之后）
            try:
                curr_hour = int(curr.time.split(" ")[1].split(":")[0])
            except (IndexError, ValueError):
                continue
            curr_date_obj = date.fromisoformat(curr_date)
            if curr_date_obj == now_shanghai.date() and curr_hour < now_hour:
                continue  # 已过去的时段不预警
            # 推算值（带*）不触发预警
            if curr.weather_text.endswith("*") or next_.weather_text.endswith("*"):
                continue

            # 只比较天气系数变化
            if curr.weather_factor <= 0:
                continue

            drop_ratio = (curr.weather_factor - next_.weather_factor) / curr.weather_factor

            if drop_ratio < settings.WARNING_LEVEL_BLUE:
                continue

            level = self._determine_level(drop_ratio)
            level_info = WARNING_LEVELS[level]

            warning = WarningRecord(
                id=f"W-{street[:2]}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{i}",
                level=level,
                label=level_info["label"],
                street=street,
                action=level_info["action"],
                drop_ratio=round(drop_ratio, 3),
                from_time=curr.time,
                to_time=next_.time,
                from_power_kw=curr.predicted_power_kw,
                to_power_kw=next_.predicted_power_kw,
                issued_at=datetime.now(timezone.utc).isoformat(),
                weather_from=curr.weather_text,
                weather_to=next_.weather_text,
            )
            warnings.append(warning)
            logger.warning(f"预警: {street} {level_info['label']} | "
                          f"{curr.time}→{next_.time} 出力下降{drop_ratio:.0%} | "
                          f"{curr.weather_text}→{next_.weather_text}")

        return warnings

    async def evaluate_all(self, target_date: date | None = None) -> list[WarningRecord]:
        """评估所有街道"""
        all_warnings = []
        for street in JINSHAN_STREETS:
            warnings = await self.evaluate_street(street, target_date)
            all_warnings.extend(warnings)

        # 更新存储
        self._active_warnings = all_warnings
        self._history.extend(all_warnings)

        if all_warnings:
            logger.warning(f"本轮评估产生 {len(all_warnings)} 条预警")
        else:
            logger.info("本轮评估无预警")

        return all_warnings

    def get_active_warnings(self) -> list[WarningRecord]:
        return self._active_warnings

    def get_history(self) -> list[WarningRecord]:
        return self._history

    def _determine_level(self, drop_ratio: float) -> str:
        if drop_ratio >= settings.WARNING_LEVEL_RED:
            return "red"
        elif drop_ratio >= settings.WARNING_LEVEL_ORANGE:
            return "orange"
        elif drop_ratio >= settings.WARNING_LEVEL_YELLOW:
            return "yellow"
        return "blue"
