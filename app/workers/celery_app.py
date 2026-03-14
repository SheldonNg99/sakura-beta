# app/workers/celery_app.py
from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery = Celery("sakuraalpha", broker=settings.REDIS_URL, backend=settings.REDIS_URL)

celery.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)

celery.conf.beat_schedule = {
    # Generate new predictions every 15 minutes
    "generate-predictions": {
        "task": "app.workers.tasks.generate_predictions_task",
        "schedule": 60.0 * 15,
    },
    # Close betting windows every 30 seconds
    "close-expired-betting-windows": {
        "task": "app.workers.tasks.close_betting_task",
        "schedule": 30.0,
    },
    # Resolve due markets every 60 seconds
    "resolve-due-markets": {
        "task": "app.workers.tasks.resolve_markets_task",
        "schedule": 60.0,
    },
    # Refresh leaderboard cache every 60 seconds
    "refresh-leaderboard": {
        "task": "app.workers.tasks.refresh_leaderboard_task",
        "schedule": 60.0,
    },
}


# ── Task definitions ───────────────────────────────────────────────────────────

@celery.task(name="app.workers.tasks.generate_predictions_task")
def generate_predictions_task() -> None:
    from app.workers.generate_predictions import generate_predictions_for_all_assets
    generate_predictions_for_all_assets()


@celery.task(name="app.workers.tasks.close_betting_task")
def close_betting_task() -> None:
    from app.workers.close_betting import close_expired_betting_windows
    close_expired_betting_windows()


@celery.task(name="app.workers.tasks.resolve_markets_task")
def resolve_markets_task() -> None:
    from app.workers.resolve_markets import resolve_due_markets
    resolve_due_markets()


@celery.task(name="app.workers.tasks.refresh_leaderboard_task")
def refresh_leaderboard_task() -> None:
    from app.core.database import SessionLocal
    from app.services.leaderboard_service import refresh_leaderboard_cache
    db = SessionLocal()
    try:
        refresh_leaderboard_cache(db)
    finally:
        db.close()