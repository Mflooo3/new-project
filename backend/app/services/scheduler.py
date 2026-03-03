from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session

from app.config import settings
from app.database import engine
from app.services.analysis import AIAnalyzer
from app.services.ingestion import IngestionService
from app.services.queue import enqueue_ingestion_job

_scheduler: BackgroundScheduler | None = None
_analyzer = AIAnalyzer()


def _run_ingestion_job() -> None:
    if settings.use_redis_worker:
        try:
            enqueue_ingestion_job()
            return
        except Exception:
            pass

    with Session(engine) as session:
        service = IngestionService(session=session, analyzer=_analyzer)
        service.run_once()


def start_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        return

    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.add_job(
        _run_ingestion_job,
        trigger="interval",
        seconds=settings.poll_seconds,
        id="source_ingestion",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
    )
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
