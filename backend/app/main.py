from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from app.api import weather, forecast, warning, pv_users
from app.core.config import settings
from app.services.warning import WarningService

warning_service = WarningService()
scheduler = AsyncIOScheduler()


async def scheduled_evaluation():
    """定时预警评估任务"""
    logger.info("执行定时预警评估...")
    warnings = await warning_service.evaluate_all()
    if warnings:
        logger.warning(f"定时评估发现 {len(warnings)} 条预警")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动定时任务
    scheduler.add_job(
        scheduled_evaluation,
        "interval",
        seconds=settings.POLL_INTERVAL_SECONDS,
        id="warning_evaluation",
    )
    scheduler.start()
    logger.info(f"定时预警评估已启动，间隔 {settings.POLL_INTERVAL_SECONDS} 秒")
    yield
    scheduler.shutdown()
    logger.info("定时任务已停止")


app = FastAPI(
    title="光伏出力预警系统",
    description="上海金山地区光伏出力骤降预警API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(weather.router, prefix="/api/weather", tags=["气象数据"])
app.include_router(forecast.router, prefix="/api/forecast", tags=["出力预测"])
app.include_router(warning.router, prefix="/api/warning", tags=["预警管理"])
app.include_router(pv_users.router, prefix="/api/pv-users", tags=["光伏用户"])


@app.get("/")
async def root():
    return {
        "name": "光伏出力预警系统",
        "version": "0.1.0",
        "location": settings.LOCATION_NAME,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
