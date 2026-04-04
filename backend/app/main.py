from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api import weather, forecast, warning, pv_users, history
from app.core.config import settings
from app.core.database import init_db, close_db
from app.services.data_collector import DataCollector

data_collector = DataCollector()
scheduler = AsyncIOScheduler()


async def hourly_job():
    """Hourly: collect weather + GHI, compute power, evaluate warnings."""
    try:
        await data_collector.collect_and_evaluate()
    except Exception as e:
        logger.error(f"Hourly job failed: {e}")


async def daily_job():
    """Daily at 01:00: fetch yesterday's actual weather observations."""
    try:
        await data_collector.collect_observations()
    except Exception as e:
        logger.error(f"Daily observation job failed: {e}")


async def cleanup_job():
    """Daily at 02:00: clean up old history and warning data."""
    try:
        await data_collector.cleanup_old_data()
    except Exception as e:
        logger.error(f"Cleanup job failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database connection pool
    await init_db()
    logger.info("Database initialized")

    # Schedule hourly data collection
    scheduler.add_job(
        hourly_job,
        "interval",
        seconds=settings.POLL_INTERVAL_SECONDS,
        id="hourly_collect",
        next_run_time=None,  # Don't run immediately; trigger manually below
    )

    # Schedule daily observation collection at 01:00 Shanghai time
    scheduler.add_job(
        daily_job,
        CronTrigger(hour=1, minute=0, timezone="Asia/Shanghai"),
        id="daily_observations",
    )

    # Schedule daily cleanup at 02:00 Shanghai time
    scheduler.add_job(
        cleanup_job,
        CronTrigger(hour=2, minute=0, timezone="Asia/Shanghai"),
        id="daily_cleanup",
    )

    scheduler.start()
    logger.info(f"Scheduler started: hourly every {settings.POLL_INTERVAL_SECONDS}s, daily at 01:00/02:00")

    # Run initial data collection on startup
    try:
        await data_collector.collect_and_evaluate()
    except Exception as e:
        logger.error(f"Initial data collection failed: {e}")

    yield

    scheduler.shutdown()
    await close_db()
    logger.info("Shutdown complete")


app = FastAPI(
    title="光伏出力预警系统",
    description="上海金山地区光伏出力骤降预警API",
    version="0.2.0",
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
app.include_router(history.router, prefix="/api/history", tags=["历史回测"])


@app.get("/")
async def root():
    return {
        "name": "光伏出力预警系统",
        "version": "0.2.0",
        "location": settings.LOCATION_NAME,
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
