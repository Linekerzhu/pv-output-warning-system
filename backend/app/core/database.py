"""asyncpg connection pool lifecycle"""

import asyncpg
from loguru import logger

from app.core.config import settings

_pool: asyncpg.Pool | None = None


async def init_db() -> None:
    """Create connection pool. Call once at app startup."""
    global _pool
    _pool = await asyncpg.create_pool(
        settings.DATABASE_URL,
        min_size=2,
        max_size=10,
    )
    logger.info("PostgreSQL connection pool created")


async def close_db() -> None:
    """Close connection pool. Call at app shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL connection pool closed")


def get_pool() -> asyncpg.Pool:
    """Get the connection pool. Raises if not initialized."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized. Call init_db() first.")
    return _pool
