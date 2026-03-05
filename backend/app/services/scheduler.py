from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from sqlmodel import Session

from app.config import settings
from app.database import engine
from app.services.ai_workspace import AIWorkspaceService
from app.services.analysis import AIAnalyzer
from app.services.ingestion import IngestionService
from app.services.queue import enqueue_ingestion_job
from app.services.realtime import event_bus

_scheduler: BackgroundScheduler | None = None
_analyzer = AIAnalyzer()
_prediction_review_enabled = bool(settings.prediction_review_enabled)
_prediction_review_seconds = max(60, int(settings.prediction_review_seconds))
_prediction_review_min_interval_minutes = max(1, int(settings.prediction_review_min_interval_minutes))


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


def _run_prediction_review_job() -> None:
    if not _prediction_review_enabled:
        return
    try:
        with Session(engine) as session:
            service = AIWorkspaceService(session=session)
            reviewed = service.auto_review_prediction_tickets(
                min_interval_minutes=_prediction_review_min_interval_minutes,
                limit=120,
            )
            for row in reviewed:
                event_bus.publish_nowait(
                    {
                        "type": "prediction",
                        "action": "outcome" if row.get("outcome_changed") else "auto_review",
                        "ticket_id": row.get("ticket_id"),
                        "update_id": row.get("update_id"),
                        "title": row.get("title"),
                        "outcome": row.get("outcome"),
                        "score": row.get("score"),
                        "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                    }
                )
    except Exception:
        # Review should never block the scheduler.
        return


def get_prediction_review_config() -> dict[str, int | bool]:
    return {
        "enabled": _prediction_review_enabled,
        "review_seconds": _prediction_review_seconds,
        "min_interval_minutes": _prediction_review_min_interval_minutes,
    }


def update_prediction_review_config(
    *,
    enabled: bool | None = None,
    review_seconds: int | None = None,
    min_interval_minutes: int | None = None,
) -> dict[str, int | bool]:
    global _prediction_review_enabled, _prediction_review_seconds, _prediction_review_min_interval_minutes

    if enabled is not None:
        _prediction_review_enabled = bool(enabled)
    if review_seconds is not None:
        _prediction_review_seconds = max(60, int(review_seconds))
    if min_interval_minutes is not None:
        _prediction_review_min_interval_minutes = max(1, int(min_interval_minutes))

    if _scheduler and _scheduler.running:
        try:
            _scheduler.reschedule_job(
                "prediction_auto_review",
                trigger="interval",
                seconds=_prediction_review_seconds,
            )
        except Exception:
            _scheduler.add_job(
                _run_prediction_review_job,
                trigger="interval",
                seconds=_prediction_review_seconds,
                id="prediction_auto_review",
                replace_existing=True,
            )
    return get_prediction_review_config()


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
    _scheduler.add_job(
        _run_prediction_review_job,
        trigger="interval",
        seconds=_prediction_review_seconds,
        id="prediction_auto_review",
        replace_existing=True,
        next_run_time=datetime.now(timezone.utc),
    )
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
