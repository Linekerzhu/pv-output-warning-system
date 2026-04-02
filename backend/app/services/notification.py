from loguru import logger


class NotificationService:
    """预警通知推送服务"""

    async def send_warning(self, warning: dict, channels: list[str] | None = None):
        """推送预警通知到指定渠道"""
        channels = channels or ["log"]

        for channel in channels:
            if channel == "log":
                await self._send_log(warning)
            elif channel == "email":
                await self._send_email(warning)
            elif channel == "sms":
                await self._send_sms(warning)

    async def _send_log(self, warning: dict):
        logger.warning(
            f"[预警通知] {warning['label']}: {warning['risk_summary']}"
        )

    async def _send_email(self, warning: dict):
        # TODO: 实现邮件发送
        logger.info(f"邮件通知已排队: {warning['id']}")

    async def _send_sms(self, warning: dict):
        # TODO: 实现短信发送
        logger.info(f"短信通知已排队: {warning['id']}")
