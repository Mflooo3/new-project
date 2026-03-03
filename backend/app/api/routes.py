import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, desc, select

from app.api.auth import require_api_key
from app.config import settings
from app.database import engine, get_session
from app.models import AIPredictionTicket, AIPredictionUpdate, AIChatMessage, AIInsight, Alert, Event, Source
from app.schemas import (
    AIChatDeleteResponse,
    AIChatMessageRead,
    AIChatRequest,
    AIChatResponse,
    AIInsightCreate,
    AIInsightDeleteResponse,
    AIInsightRead,
    AIPrivacyRead,
    AIPredictionCreate,
    AIPredictionDeleteResponse,
    AIPredictionLeaderboardRow,
    AIPredictionOutcomeSet,
    AIPredictionTicketRead,
    AIPredictionUpdateCreate,
    AIPredictionUpdateRead,
    AIStatusRead,
    AIReportPublishRequest,
    AIReportRead,
    AITranslateBulkRequest,
    AITranslateBulkResponse,
    AlertRead,
    EventRead,
    IngestRunResponse,
    JobStatusRead,
    SourceCreate,
    SourceRead,
    SourceToggle,
)
from app.services.ingestion import IngestionService
from app.services.ai_workspace import AIWorkspaceService
from app.services.queue import enqueue_ingestion_job, fetch_job, job_payload
from app.services.realtime import event_bus
from app.services.trust import is_trusted_event

public_router = APIRouter()
router = APIRouter(dependencies=[Depends(require_api_key)])


def _as_source_read(source: Source) -> SourceRead:
    return SourceRead.model_validate(source, from_attributes=True)


def _as_event_read(event: Event) -> EventRead:
    return EventRead.model_validate(event, from_attributes=True)


def _as_alert_read(alert: Alert) -> AlertRead:
    return AlertRead.model_validate(alert, from_attributes=True)


def _as_ai_message_read(message: AIChatMessage) -> AIChatMessageRead:
    return AIChatMessageRead.model_validate(message, from_attributes=True)


def _as_ai_insight_read(insight: AIInsight) -> AIInsightRead:
    return AIInsightRead.model_validate(insight, from_attributes=True)


def _as_prediction_ticket_read(ticket: AIPredictionTicket) -> AIPredictionTicketRead:
    return AIPredictionTicketRead.model_validate(ticket, from_attributes=True)


def _as_prediction_update_read(update: AIPredictionUpdate) -> AIPredictionUpdateRead:
    return AIPredictionUpdateRead.model_validate(update, from_attributes=True)


def _normalize_endpoint(endpoint: str | None) -> str:
    value = (endpoint or "").strip().lower()
    while value.endswith("/"):
        value = value[:-1]
    return value


def _deduplicate_sources(session: Session) -> int:
    rows = session.exec(select(Source).order_by(desc(Source.created_at), desc(Source.id))).all()
    seen: dict[tuple[str, str], Source] = {}
    removed = 0
    for source in rows:
        key = (source.source_type.strip().lower(), _normalize_endpoint(source.endpoint))
        canonical = seen.get(key)
        if canonical is None:
            seen[key] = source
            continue
        if source.enabled and not canonical.enabled:
            canonical.enabled = True
            session.add(canonical)
        if source.id and canonical.id and source.id != canonical.id:
            linked_events = session.exec(select(Event).where(Event.source_id == source.id)).all()
            for event in linked_events:
                event.source_id = canonical.id
                session.add(event)
        session.delete(source)
        removed += 1
    if removed:
        session.commit()
    return removed


@public_router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/events", response_model=list[EventRead])
def get_events(
    limit: int = Query(default=100, ge=1, le=500),
    source_type: str | None = None,
    min_severity: int = Query(default=1, ge=1, le=5),
    query_text: str | None = Query(default=None),
    trusted_only: bool = Query(default=False),
    session: Session = Depends(get_session),
) -> list[EventRead]:
    query = select(Event).where(Event.severity >= min_severity)
    if source_type:
        query = query.where(Event.source_type == source_type)
    query = query.order_by(desc(Event.created_at)).limit(min(1000, limit * 8))
    rows = session.exec(query).all()
    if query_text:
        needle = query_text.strip().lower()
        rows = [
            row
            for row in rows
            if needle
            in " ".join(filter(None, [row.title, row.summary, row.details, row.source_name, row.tags])).lower()
        ]
    if trusted_only:
        rows = [
            row
            for row in rows
            if is_trusted_event(source_type=row.source_type, source_name=row.source_name, url=row.url)
        ]
    return [_as_event_read(row) for row in rows[:limit]]


@router.get("/events/{event_id}", response_model=EventRead)
def get_event(event_id: int, session: Session = Depends(get_session)) -> EventRead:
    row = session.get(Event, event_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return _as_event_read(row)


@router.get("/alerts", response_model=list[AlertRead])
def get_alerts(
    limit: int = Query(default=100, ge=1, le=500),
    acknowledged: bool | None = None,
    session: Session = Depends(get_session),
) -> list[AlertRead]:
    query = select(Alert)
    if acknowledged is not None:
        query = query.where(Alert.acknowledged == acknowledged)
    query = query.order_by(desc(Alert.created_at)).limit(limit)
    rows = session.exec(query).all()
    return [_as_alert_read(row) for row in rows]


@router.post("/alerts/{alert_id}/ack", response_model=AlertRead)
def ack_alert(alert_id: int, session: Session = Depends(get_session)) -> AlertRead:
    alert = session.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return _as_alert_read(alert)


@router.get("/sources", response_model=list[SourceRead])
def get_sources(session: Session = Depends(get_session)) -> list[SourceRead]:
    _deduplicate_sources(session)
    rows = session.exec(select(Source).order_by(desc(Source.created_at))).all()
    return [_as_source_read(row) for row in rows]


@router.post("/sources", response_model=SourceRead, status_code=201)
def create_source(payload: SourceCreate, session: Session = Depends(get_session)) -> SourceRead:
    normalized_endpoint = _normalize_endpoint(payload.endpoint)
    existing = session.exec(select(Source).where(Source.source_type == payload.source_type)).all()
    for row in existing:
        if _normalize_endpoint(row.endpoint) != normalized_endpoint:
            continue
        row.name = payload.name.strip()
        row.parser_hint = payload.parser_hint
        row.poll_interval_seconds = payload.poll_interval_seconds
        row.enabled = True
        session.add(row)
        session.commit()
        session.refresh(row)
        return _as_source_read(row)

    source = Source(
        name=payload.name.strip(),
        source_type=payload.source_type,
        endpoint=payload.endpoint.strip(),
        parser_hint=payload.parser_hint,
        poll_interval_seconds=payload.poll_interval_seconds,
        enabled=True,
    )
    session.add(source)
    session.commit()
    session.refresh(source)
    _deduplicate_sources(session)
    return _as_source_read(source)


@router.patch("/sources/{source_id}/toggle", response_model=SourceRead)
def toggle_source(
    source_id: int,
    payload: SourceToggle,
    session: Session = Depends(get_session),
) -> SourceRead:
    source = session.get(Source, source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    source.enabled = payload.enabled
    session.add(source)
    session.commit()
    session.refresh(source)
    return _as_source_read(source)


@router.post("/ingest/run", response_model=IngestRunResponse)
def run_ingestion(force: bool = Query(default=True)) -> IngestRunResponse:
    if settings.use_redis_worker:
        try:
            job = enqueue_ingestion_job(force=force)
            return IngestRunResponse(mode="queued", job_id=job.id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Failed to enqueue ingestion: {exc}") from exc

    with Session(engine) as session:
        result = IngestionService(session=session).run_once(force=force)
    return IngestRunResponse(mode="sync", **result)


@router.get("/jobs/{job_id}", response_model=JobStatusRead)
def get_job_status(job_id: str) -> JobStatusRead:
    if not settings.use_redis_worker:
        raise HTTPException(status_code=400, detail="Redis worker mode is disabled")
    try:
        job = fetch_job(job_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Failed to access Redis: {exc}") from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobStatusRead(**job_payload(job))


async def _sse_generator() -> AsyncGenerator[str, None]:
    async for event in event_bus.stream():
        yield f"data: {json.dumps(event)}\n\n"


@router.get("/stream")
async def stream() -> StreamingResponse:
    return StreamingResponse(_sse_generator(), media_type="text/event-stream")


@router.get("/ai/privacy", response_model=AIPrivacyRead)
def ai_privacy() -> AIPrivacyRead:
    return AIPrivacyRead(
        privacy_mode=settings.ai_privacy_mode,
        openai_enabled=bool(settings.openai_api_key and not settings.ai_privacy_mode),
    )


@router.get("/ai/status", response_model=AIStatusRead)
def ai_status(session: Session = Depends(get_session)) -> AIStatusRead:
    service = AIWorkspaceService(session=session)
    return AIStatusRead(**service.openai_status())


@router.get("/ai/messages", response_model=list[AIChatMessageRead])
def ai_messages(
    limit: int = Query(default=100, ge=1, le=300),
    session: Session = Depends(get_session),
) -> list[AIChatMessageRead]:
    service = AIWorkspaceService(session=session)
    rows = service.get_messages(limit=limit)
    return [_as_ai_message_read(row) for row in rows]


@router.delete("/ai/messages", response_model=AIChatDeleteResponse)
def ai_messages_clear(session: Session = Depends(get_session)) -> AIChatDeleteResponse:
    service = AIWorkspaceService(session=session)
    deleted_count = service.delete_all_messages()
    return AIChatDeleteResponse(deleted_count=deleted_count, scope="all")


@router.delete("/ai/messages/{message_id}", response_model=AIChatDeleteResponse)
def ai_message_delete(message_id: int, session: Session = Depends(get_session)) -> AIChatDeleteResponse:
    service = AIWorkspaceService(session=session)
    deleted = service.delete_message(message_id=message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return AIChatDeleteResponse(deleted_count=1, scope="single")


@router.post("/ai/chat", response_model=AIChatResponse)
def ai_chat(payload: AIChatRequest, session: Session = Depends(get_session)) -> AIChatResponse:
    service = AIWorkspaceService(session=session)
    message, insight = service.chat(message=payload.message, event_ids=payload.event_ids)
    return AIChatResponse(
        message=_as_ai_message_read(message),
        created_insight=_as_ai_insight_read(insight) if insight else None,
        privacy_mode=settings.ai_privacy_mode,
    )


@router.get("/ai/insights", response_model=list[AIInsightRead])
def ai_insights(
    limit: int = Query(default=60, ge=1, le=300),
    session: Session = Depends(get_session),
) -> list[AIInsightRead]:
    service = AIWorkspaceService(session=session)
    rows = service.get_insights(limit=limit)
    return [_as_ai_insight_read(row) for row in rows]


@router.delete("/ai/insights", response_model=AIInsightDeleteResponse)
def ai_clear_insights(session: Session = Depends(get_session)) -> AIInsightDeleteResponse:
    service = AIWorkspaceService(session=session)
    deleted_count = service.delete_all_insights()
    return AIInsightDeleteResponse(deleted_count=deleted_count)


@router.post("/ai/insights", response_model=AIInsightRead)
def ai_create_insight(
    payload: AIInsightCreate,
    session: Session = Depends(get_session),
) -> AIInsightRead:
    service = AIWorkspaceService(session=session)
    row = service.create_insight(
        title=payload.title,
        prompt=payload.prompt,
        event_ids=payload.event_ids,
    )
    return _as_ai_insight_read(row)


@router.get("/ai/predictions", response_model=list[AIPredictionTicketRead])
def ai_predictions(
    limit: int = Query(default=120, ge=1, le=300),
    session: Session = Depends(get_session),
) -> list[AIPredictionTicketRead]:
    service = AIWorkspaceService(session=session)
    rows = service.get_prediction_tickets(limit=limit)
    return [_as_prediction_ticket_read(row) for row in rows]


@router.get("/ai/predictions/leaderboard", response_model=list[AIPredictionLeaderboardRow])
def ai_prediction_leaderboard(session: Session = Depends(get_session)) -> list[AIPredictionLeaderboardRow]:
    service = AIWorkspaceService(session=session)
    rows = service.get_prediction_leaderboard()
    return [AIPredictionLeaderboardRow(**row) for row in rows]


@router.get("/ai/predictions/{ticket_id}", response_model=AIPredictionTicketRead)
def ai_prediction_one(ticket_id: int, session: Session = Depends(get_session)) -> AIPredictionTicketRead:
    row = session.get(AIPredictionTicket, ticket_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Prediction ticket not found")
    return _as_prediction_ticket_read(row)


@router.get("/ai/predictions/{ticket_id}/updates", response_model=list[AIPredictionUpdateRead])
def ai_prediction_updates(
    ticket_id: int,
    limit: int = Query(default=120, ge=1, le=300),
    session: Session = Depends(get_session),
) -> list[AIPredictionUpdateRead]:
    if session.get(AIPredictionTicket, ticket_id) is None:
        raise HTTPException(status_code=404, detail="Prediction ticket not found")
    service = AIWorkspaceService(session=session)
    rows = service.get_prediction_updates(ticket_id=ticket_id, limit=limit)
    return [_as_prediction_update_read(row) for row in rows]


@router.post("/ai/predictions", response_model=AIPredictionTicketRead)
def ai_prediction_create(
    payload: AIPredictionCreate,
    session: Session = Depends(get_session),
) -> AIPredictionTicketRead:
    service = AIWorkspaceService(session=session)
    ticket, update = service.create_prediction_ticket(
        title=payload.title,
        focus_query=payload.focus_query,
        request_text=payload.request_text,
        horizon_hours=payload.horizon_hours,
        scope=payload.scope,
        event_ids=payload.event_ids,
    )
    event_bus.publish_nowait(
        {
            "type": "prediction",
            "action": "created",
            "ticket_id": ticket.id,
            "update_id": update.id,
            "title": ticket.title,
            "created_at": ticket.created_at.isoformat(),
        }
    )
    return _as_prediction_ticket_read(ticket)


@router.post("/ai/predictions/{ticket_id}/update", response_model=AIPredictionUpdateRead)
def ai_prediction_update(
    ticket_id: int,
    payload: AIPredictionUpdateCreate,
    session: Session = Depends(get_session),
) -> AIPredictionUpdateRead:
    service = AIWorkspaceService(session=session)
    try:
        ticket, update = service.append_prediction_update(
            ticket_id=ticket_id,
            note=payload.note,
            event_ids=payload.event_ids,
            kind="update",
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    event_bus.publish_nowait(
        {
            "type": "prediction",
            "action": "updated",
            "ticket_id": ticket.id,
            "update_id": update.id,
            "title": ticket.title,
            "created_at": update.created_at.isoformat(),
        }
    )
    return _as_prediction_update_read(update)


@router.post("/ai/predictions/{ticket_id}/outcome", response_model=AIPredictionTicketRead)
def ai_prediction_outcome(
    ticket_id: int,
    payload: AIPredictionOutcomeSet,
    session: Session = Depends(get_session),
) -> AIPredictionTicketRead:
    service = AIWorkspaceService(session=session)
    try:
        ticket, update = service.set_prediction_outcome(
            ticket_id=ticket_id,
            outcome=payload.outcome,
            note=payload.note,
            status=payload.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    event_bus.publish_nowait(
        {
            "type": "prediction",
            "action": "outcome",
            "ticket_id": ticket.id,
            "update_id": update.id,
            "title": ticket.title,
            "outcome": ticket.outcome,
            "created_at": update.created_at.isoformat(),
        }
    )
    return _as_prediction_ticket_read(ticket)


@router.delete("/ai/predictions/{ticket_id}", response_model=AIPredictionDeleteResponse)
def ai_prediction_delete(ticket_id: int, session: Session = Depends(get_session)) -> AIPredictionDeleteResponse:
    service = AIWorkspaceService(session=session)
    deleted = service.delete_prediction_ticket(ticket_id=ticket_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Prediction ticket not found")
    event_bus.publish_nowait(
        {
            "type": "prediction",
            "action": "deleted",
            "ticket_id": ticket_id,
        }
    )
    return AIPredictionDeleteResponse(deleted_count=1)


@router.get("/ai/reports", response_model=list[AIReportRead])
def ai_reports(
    limit: int = Query(default=30, ge=1, le=100),
    session: Session = Depends(get_session),
) -> list[AIReportRead]:
    service = AIWorkspaceService(session=session)
    rows = service.list_reports(limit=limit)
    return [AIReportRead(**row) for row in rows]


@router.get("/ai/reports/{report_id}/download")
def ai_download_report(
    report_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|md)$"),
    session: Session = Depends(get_session),
) -> FileResponse:
    service = AIWorkspaceService(session=session)
    path = service.get_report_file(report_id=report_id, prefer_pdf=(format == "pdf"))
    if path is None:
        raise HTTPException(status_code=404, detail="Report file not found")
    media_type = "application/pdf" if path.suffix.lower() == ".pdf" else "text/markdown; charset=utf-8"
    return FileResponse(path=path, media_type=media_type, filename=path.name)


@router.post("/ai/reports/publish", response_model=AIReportRead)
def ai_publish_report(
    payload: AIReportPublishRequest,
    session: Session = Depends(get_session),
) -> AIReportRead:
    service = AIWorkspaceService(session=session)
    try:
        row = service.publish_report(
            title=payload.title,
            prompt=payload.prompt,
            insight_id=payload.insight_id,
            event_ids=payload.event_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AIReportRead(**row)


@router.post("/ai/translate/bulk", response_model=AITranslateBulkResponse)
def ai_translate_bulk(payload: AITranslateBulkRequest, session: Session = Depends(get_session)) -> AITranslateBulkResponse:
    service = AIWorkspaceService(session=session)
    translations = service.translate_bulk_to_arabic(payload.texts)
    return AITranslateBulkResponse(translations=translations)
