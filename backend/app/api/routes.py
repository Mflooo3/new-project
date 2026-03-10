import json
from collections.abc import AsyncGenerator
from datetime import datetime
from typing import Any
import time
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlmodel import Session, desc, select

from app.api.auth import CurrentUser, enforce_page_access, enforce_version, get_current_user
from app.config import settings
from app.database import engine, get_session
from app.models import AIPredictionTicket, AIPredictionUpdate, AIChatMessage, AIInsight, Alert, AppUser, Event, Source
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
    AIPredictionReviewConfigRead,
    AIPredictionReviewConfigUpdate,
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
from app.services.scheduler import get_prediction_review_config, update_prediction_review_config
from app.services.trust import is_trusted_event
from app.services.fetchers.marinetraffic_official import probe_jsoncargo_status
from app.services.fetchers.x_recent import probe_x_recent_status
from app.services.operational_impact import build_air_operations_snapshot, fetch_comtrade_snapshot
from app.services.platform_flags import get_platform_flags
from app.services.source_policy import event_allowed_for_feature, get_source_policy_for_feature

public_router = APIRouter()
router = APIRouter(dependencies=[Depends(get_current_user)])
_jsoncargo_status_cache: dict[str, Any] = {"checked_monotonic": 0.0, "payload": None}
_x_status_cache: dict[str, Any] = {"checked_monotonic": 0.0, "payload": None}

_MOJIBAKE_MARKERS_RE = re.compile(r"(?:Ã.|Ø.|Ù.|Â.|â[€™œž¢£¤])")
_ARABIC_RE = re.compile(r"[\u0600-\u06FF]")


def _repair_mojibake_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = value
    if not text:
        return text

    def _metrics(s: str) -> tuple[int, int, int]:
        arabic_hits = len(_ARABIC_RE.findall(s))
        mojibake_hits = len(_MOJIBAKE_MARKERS_RE.findall(s)) + s.count("\ufffd")
        return arabic_hits, mojibake_hits, len(s)

    def _repair_line(line: str) -> str:
        if not line or not _MOJIBAKE_MARKERS_RE.search(line):
            return line
        candidates = [line]
        for enc in ("latin-1", "cp1252"):
            try:
                decoded = line.encode(enc, errors="ignore").decode("utf-8", errors="ignore")
                if decoded and decoded not in candidates:
                    candidates.append(decoded)
                if _MOJIBAKE_MARKERS_RE.search(decoded):
                    decoded2 = decoded.encode(enc, errors="ignore").decode("utf-8", errors="ignore")
                    if decoded2 and decoded2 not in candidates:
                        candidates.append(decoded2)
            except Exception:
                continue

        origin_ar, origin_mj, _ = _metrics(line)
        ranked = [(candidate, *_metrics(candidate)) for candidate in candidates]
        # Prefer less mojibake first, then more Arabic content.
        best, best_ar, best_mj, _ = min(ranked, key=lambda row: (row[2], -row[1], -row[3]))
        if best_mj < origin_mj and (best_ar >= max(1, origin_ar // 3) or best_ar > origin_ar):
            return best
        return line

    parts = re.split(r"(\r?\n)", text)
    fixed_parts = [_repair_line(part) if part not in {"\n", "\r\n"} else part for part in parts]
    return "".join(fixed_parts)


def _normalize_text_payload(value: Any) -> Any:
    if isinstance(value, str):
        return _repair_mojibake_text(value)
    if isinstance(value, list):
        return [_normalize_text_payload(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_text_payload(item) for key, item in value.items()}
    return value


def _normalize_model_text(model: Any) -> Any:
    data = model.model_dump()
    fixed = _normalize_text_payload(data)
    return model.__class__.model_validate(fixed)


def _as_source_read(source: Source) -> SourceRead:
    return _normalize_model_text(SourceRead.model_validate(source, from_attributes=True))


def _as_event_read(event: Event) -> EventRead:
    return _normalize_model_text(EventRead.model_validate(event, from_attributes=True))


def _as_alert_read(alert: Alert) -> AlertRead:
    return _normalize_model_text(AlertRead.model_validate(alert, from_attributes=True))


def _as_ai_message_read(message: AIChatMessage) -> AIChatMessageRead:
    return _normalize_model_text(AIChatMessageRead.model_validate(message, from_attributes=True))


def _as_ai_insight_read(insight: AIInsight) -> AIInsightRead:
    return _normalize_model_text(AIInsightRead.model_validate(insight, from_attributes=True))


def _as_prediction_ticket_read(ticket: AIPredictionTicket) -> AIPredictionTicketRead:
    return _normalize_model_text(AIPredictionTicketRead.model_validate(ticket, from_attributes=True))


def _as_prediction_update_read(update: AIPredictionUpdate) -> AIPredictionUpdateRead:
    return _normalize_model_text(AIPredictionUpdateRead.model_validate(update, from_attributes=True))


def _normalize_endpoint(endpoint: str | None) -> str:
    value = (endpoint or "").strip().lower()
    while value.endswith("/"):
        value = value[:-1]
    return value


def _deduplicate_sources(session: Session, tenant_id: int | None = None) -> int:
    query = select(Source)
    if tenant_id is not None:
        query = query.where(Source.tenant_id == tenant_id)
    rows = session.exec(query.order_by(desc(Source.created_at), desc(Source.id))).all()
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


def _scope_query(query, model_cls, user: AppUser):
    if user.role == "super_admin":
        return query
    return query.where(model_cls.tenant_id == user.tenant_id)


def _in_scope(row: Any, user: AppUser) -> bool:
    if user.role == "super_admin":
        return True
    return getattr(row, "tenant_id", None) == user.tenant_id


def _workspace_service(session: Session, user: AppUser) -> AIWorkspaceService:
    return AIWorkspaceService(
        session=session,
        tenant_id=None if user.role == "super_admin" else user.tenant_id,
        user_id=user.id,
        is_super_admin=user.role == "super_admin",
    )


def _require_v2(user: AppUser) -> None:
    enforce_page_access(user, "v2")
    enforce_version(user, "v2")


@public_router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/events", response_model=list[EventRead])
def get_events(
    limit: int = Query(default=100, ge=1, le=4000),
    source_type: str | None = None,
    min_severity: int = Query(default=1, ge=1, le=5),
    query_text: str | None = Query(default=None),
    trusted_only: bool = Query(default=False),
    feature: str | None = Query(default=None),
    event_time_from: datetime | None = Query(default=None),
    event_time_to: datetime | None = Query(default=None),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[EventRead]:
    query = _scope_query(select(Event).where(Event.severity >= min_severity), Event, user)
    if source_type:
        query = query.where(Event.source_type == source_type)
    if event_time_from is not None:
        query = query.where(Event.event_time >= event_time_from)
    if event_time_to is not None:
        query = query.where(Event.event_time <= event_time_to)
    query = query.order_by(desc(Event.created_at)).limit(min(4000, limit * 8))
    rows = session.exec(query).all()
    if query_text:
        needle = query_text.strip().lower()
        rows = [
            row
            for row in rows
            if needle
            in " ".join(filter(None, [row.title, row.summary, row.details, row.source_name, row.tags])).lower()
        ]
    policy = get_source_policy_for_feature(feature) if feature else None
    enforce_trusted = bool(trusted_only or (policy.trusted_only if policy else False))
    if enforce_trusted:
        rows = [
            row
            for row in rows
            if (
                event_allowed_for_feature(
                    feature_name=feature or "news_feed",
                    source_type=row.source_type,
                    source_name=row.source_name,
                    url=row.url,
                )
                if feature
                else is_trusted_event(source_type=row.source_type, source_name=row.source_name, url=row.url)
            )
        ]
    return [_as_event_read(row) for row in rows[:limit]]


@router.get("/events/{event_id}", response_model=EventRead)
def get_event(
    event_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> EventRead:
    row = session.get(Event, event_id)
    if row is None or not _in_scope(row, user):
        raise HTTPException(status_code=404, detail="Event not found")
    return _as_event_read(row)


@router.get("/alerts", response_model=list[AlertRead])
def get_alerts(
    limit: int = Query(default=100, ge=1, le=500),
    acknowledged: bool | None = None,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AlertRead]:
    query = _scope_query(select(Alert), Alert, user)
    if acknowledged is not None:
        query = query.where(Alert.acknowledged == acknowledged)
    query = query.order_by(desc(Alert.created_at)).limit(limit)
    rows = session.exec(query).all()
    return [_as_alert_read(row) for row in rows]


@router.post("/alerts/{alert_id}/ack", response_model=AlertRead)
def ack_alert(
    alert_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AlertRead:
    alert = session.get(Alert, alert_id)
    if not alert or not _in_scope(alert, user):
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    session.add(alert)
    session.commit()
    session.refresh(alert)
    return _as_alert_read(alert)


@router.get("/sources", response_model=list[SourceRead])
def get_sources(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[SourceRead]:
    _deduplicate_sources(session, None if user.role == "super_admin" else user.tenant_id)
    query = _scope_query(select(Source), Source, user)
    rows = session.exec(query.order_by(desc(Source.created_at))).all()
    return [_as_source_read(row) for row in rows]


@router.get("/sources/jsoncargo/status")
def get_jsoncargo_status(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    query = _scope_query(select(Source).where(Source.source_type == "marine"), Source, user)
    rows = session.exec(query.order_by(desc(Source.created_at))).all()
    jsoncargo_source = next(
        (
            row
            for row in rows
            if row.enabled
            and (
                "jsoncargo" in (row.parser_hint or "").strip().lower()
                or "jsoncargo.com" in (row.endpoint or "").strip().lower()
            )
        ),
        None,
    )
    if not jsoncargo_source:
        return {
            "configured": bool(settings.jsoncargo_api_key or settings.marinetraffic_api_key),
            "state": "not_configured",
            "status_code": None,
            "message": "No enabled JSONCargo marine source.",
            "detail": None,
            "checked_at": datetime.utcnow().isoformat(),
            "endpoint": None,
        }

    now_monotonic = time.monotonic()
    cache_ttl_seconds = 180.0
    cached_payload = _jsoncargo_status_cache.get("payload")
    checked_monotonic = float(_jsoncargo_status_cache.get("checked_monotonic") or 0.0)
    if (
        isinstance(cached_payload, dict)
        and now_monotonic - checked_monotonic < cache_ttl_seconds
        and cached_payload.get("source_id") == jsoncargo_source.id
        and cached_payload.get("endpoint") == jsoncargo_source.endpoint
    ):
        cached = dict(cached_payload)
        cached["cached"] = True
        return cached

    status = probe_jsoncargo_status(jsoncargo_source.endpoint)
    status["source_id"] = jsoncargo_source.id
    status["source_name"] = jsoncargo_source.name
    status["enabled"] = bool(jsoncargo_source.enabled)
    status["cached"] = False
    _jsoncargo_status_cache["checked_monotonic"] = now_monotonic
    _jsoncargo_status_cache["payload"] = dict(status)
    return status


@router.get("/sources/x/status")
def get_x_status(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    platform_flags = get_platform_flags(session)
    if not bool(platform_flags.get("x_api_enabled")):
        return {
            "configured": False,
            "state": "disabled_by_admin",
            "status_code": None,
            "message": "X API is disabled by super admin.",
            "detail": None,
            "checked_at": datetime.utcnow().isoformat(),
            "endpoint": None,
            "source_id": None,
            "source_name": None,
            "enabled": False,
            "last_polled_at": None,
        }

    query = _scope_query(select(Source).where(Source.source_type == "social"), Source, user)
    rows = session.exec(query.order_by(desc(Source.created_at))).all()
    x_rows = [
        row
        for row in rows
        if (row.parser_hint or "").strip().lower() in {"x_recent", "x_api_v2", "twitter_recent"}
        or "api.x.com/2" in (row.endpoint or "").strip().lower()
        or "api.twitter.com/2" in (row.endpoint or "").strip().lower()
    ]
    x_source = next((row for row in x_rows if row.enabled), None)
    configured = bool((settings.x_api_bearer_token or settings.x_api_key or "").strip())
    if not x_source:
        fallback = x_rows[0] if x_rows else None
        if configured and fallback is None:
            # Tenant has no explicit X source row yet, but global X credentials exist.
            # Probe default endpoint directly so status reflects real connectivity.
            status = probe_x_recent_status(None)
            status["source_id"] = None
            status["source_name"] = None
            status["enabled"] = True
            status["last_polled_at"] = None
            status["cached"] = False
            _x_status_cache["checked_monotonic"] = time.monotonic()
            _x_status_cache["payload"] = dict(status)
            return status
        return {
            "configured": configured,
            "state": "disabled" if fallback else "not_configured",
            "status_code": None,
            "message": "X source is disabled." if fallback else "No enabled X source.",
            "detail": None,
            "checked_at": datetime.utcnow().isoformat(),
            "endpoint": fallback.endpoint if fallback else None,
            "source_id": fallback.id if fallback else None,
            "source_name": fallback.name if fallback else None,
            "enabled": bool(fallback.enabled) if fallback else False,
            "last_polled_at": fallback.last_polled_at.isoformat() if fallback and fallback.last_polled_at else None,
        }

    now_monotonic = time.monotonic()
    cache_ttl_seconds = 90.0
    cached_payload = _x_status_cache.get("payload")
    checked_monotonic = float(_x_status_cache.get("checked_monotonic") or 0.0)
    if (
        isinstance(cached_payload, dict)
        and now_monotonic - checked_monotonic < cache_ttl_seconds
        and cached_payload.get("source_id") == x_source.id
        and cached_payload.get("endpoint") == x_source.endpoint
    ):
        cached = dict(cached_payload)
        cached["cached"] = True
        return cached

    status = probe_x_recent_status(x_source.endpoint)
    status["source_id"] = x_source.id
    status["source_name"] = x_source.name
    status["enabled"] = bool(x_source.enabled)
    status["last_polled_at"] = x_source.last_polled_at.isoformat() if x_source.last_polled_at else None
    status["cached"] = False
    _x_status_cache["checked_monotonic"] = now_monotonic
    _x_status_cache["payload"] = dict(status)
    return status


@router.get("/ops/air")
def ops_air_operations(
    country: str = Query(default="UAE"),
    hours: int = Query(default=24, ge=1, le=168),
    delay_threshold: int = Query(default=45, ge=10, le=360),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    _require_v2(user)
    return build_air_operations_snapshot(
        session,
        user=user,
        country=country,
        hours=hours,
        delay_threshold=delay_threshold,
    )


@router.get("/ops/trade")
def ops_trade_supply_chain(
    country: str = Query(default="UAE"),
    period: str | None = Query(default=None),
    user: AppUser = Depends(get_current_user),
) -> dict[str, Any]:
    _require_v2(user)
    return fetch_comtrade_snapshot(country=country, period=period)


@router.post("/sources", response_model=SourceRead, status_code=201)
def create_source(
    payload: SourceCreate,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SourceRead:
    tenant_id = payload.tenant_id if user.role == "super_admin" else user.tenant_id
    normalized_endpoint = _normalize_endpoint(payload.endpoint)
    existing_query = select(Source).where(Source.source_type == payload.source_type)
    if tenant_id is not None:
        existing_query = existing_query.where(Source.tenant_id == tenant_id)
    existing = session.exec(existing_query).all()
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
        tenant_id=tenant_id,
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
    _deduplicate_sources(session, tenant_id)
    return _as_source_read(source)


@router.patch("/sources/{source_id}/toggle", response_model=SourceRead)
def toggle_source(
    source_id: int,
    payload: SourceToggle,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> SourceRead:
    source = session.get(Source, source_id)
    if not source or not _in_scope(source, user):
        raise HTTPException(status_code=404, detail="Source not found")
    source.enabled = payload.enabled
    session.add(source)
    session.commit()
    session.refresh(source)
    return _as_source_read(source)


@router.post("/ingest/run", response_model=IngestRunResponse)
def run_ingestion(
    force: bool = Query(default=True),
    user: AppUser = Depends(get_current_user),
) -> IngestRunResponse:
    tenant_scope = None if user.role == "super_admin" else user.tenant_id
    if settings.use_redis_worker and user.role == "super_admin":
        try:
            job = enqueue_ingestion_job(force=force)
            return IngestRunResponse(mode="queued", job_id=job.id)
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"Failed to enqueue ingestion: {exc}") from exc

    with Session(engine) as session:
        result = IngestionService(session=session, tenant_id=tenant_scope).run_once(force=force)
    return IngestRunResponse(mode="sync", **result)


@router.post("/ingest/ocr/backfill")
def run_ocr_backfill(
    hours: int = Query(default=720, ge=1, le=24 * 180),
    limit: int = Query(default=450, ge=1, le=3000),
    force: bool = Query(default=False),
    user: AppUser = Depends(get_current_user),
) -> dict[str, int | bool]:
    tenant_scope = None if user.role == "super_admin" else user.tenant_id
    with Session(engine) as session:
        service = IngestionService(session=session, tenant_id=tenant_scope)
        if not service.ocr.available():
            return {
                "ocr_available": False,
                "scanned": 0,
                "updated": 0,
                "skipped": 0,
                "failed": 0,
            }
        result = service.backfill_ocr_for_existing_events(hours=hours, limit=limit, force=force)
    return {"ocr_available": True, **result}


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
def ai_privacy(
    session: Session = Depends(get_session),
) -> AIPrivacyRead:
    platform_flags = get_platform_flags(session)
    openai_enabled = bool(
        platform_flags.get("openai_enabled")
        and settings.openai_api_key
        and not settings.ai_privacy_mode
    )
    return AIPrivacyRead(
        privacy_mode=settings.ai_privacy_mode,
        openai_enabled=openai_enabled,
    )


@router.get("/ai/status", response_model=AIStatusRead)
def ai_status(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIStatusRead:
    platform_flags = get_platform_flags(session)
    if not bool(platform_flags.get("openai_enabled")):
        return AIStatusRead(
            configured=False,
            connected=False,
            model=(settings.openai_model or "gpt-4.1-mini").strip() or "gpt-4.1-mini",
            message="OpenAI API is disabled by super admin.",
        )
    service = _workspace_service(session, user)
    status = service.openai_status()
    status["message"] = _repair_mojibake_text(status.get("message", "")) or ""
    return AIStatusRead(**status)


@router.get("/ai/messages", response_model=list[AIChatMessageRead])
def ai_messages(
    limit: int = Query(default=100, ge=1, le=300),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIChatMessageRead]:
    service = _workspace_service(session, user)
    rows = service.get_messages(limit=limit)
    return [_as_ai_message_read(row) for row in rows]


@router.delete("/ai/messages", response_model=AIChatDeleteResponse)
def ai_messages_clear(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIChatDeleteResponse:
    service = _workspace_service(session, user)
    deleted_count = service.delete_all_messages()
    return AIChatDeleteResponse(deleted_count=deleted_count, scope="all")


@router.delete("/ai/messages/{message_id}", response_model=AIChatDeleteResponse)
def ai_message_delete(
    message_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIChatDeleteResponse:
    service = _workspace_service(session, user)
    deleted = service.delete_message(message_id=message_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Message not found")
    return AIChatDeleteResponse(deleted_count=1, scope="single")


@router.post("/ai/chat", response_model=AIChatResponse)
def ai_chat(
    payload: AIChatRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIChatResponse:
    service = _workspace_service(session, user)
    message, insight = service.chat(message=payload.message, event_ids=payload.event_ids)
    return AIChatResponse(
        message=_as_ai_message_read(message),
        created_insight=_as_ai_insight_read(insight) if insight else None,
        privacy_mode=settings.ai_privacy_mode,
    )


@router.get("/ai/insights", response_model=list[AIInsightRead])
def ai_insights(
    limit: int = Query(default=60, ge=1, le=300),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIInsightRead]:
    service = _workspace_service(session, user)
    rows = service.get_insights(limit=limit)
    return [_as_ai_insight_read(row) for row in rows]


@router.delete("/ai/insights", response_model=AIInsightDeleteResponse)
def ai_clear_insights(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIInsightDeleteResponse:
    service = _workspace_service(session, user)
    deleted_count = service.delete_all_insights()
    return AIInsightDeleteResponse(deleted_count=deleted_count)


@router.post("/ai/insights", response_model=AIInsightRead)
def ai_create_insight(
    payload: AIInsightCreate,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIInsightRead:
    service = _workspace_service(session, user)
    row = service.create_insight(
        title=payload.title,
        prompt=payload.prompt,
        event_ids=payload.event_ids,
    )
    return _as_ai_insight_read(row)


@router.get("/ai/predictions", response_model=list[AIPredictionTicketRead])
def ai_predictions(
    limit: int = Query(default=120, ge=1, le=300),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIPredictionTicketRead]:
    _require_v2(user)
    service = _workspace_service(session, user)
    rows = service.get_prediction_tickets(limit=limit)
    return [_as_prediction_ticket_read(row) for row in rows]


@router.get("/ai/predictions/leaderboard", response_model=list[AIPredictionLeaderboardRow])
def ai_prediction_leaderboard(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIPredictionLeaderboardRow]:
    _require_v2(user)
    service = _workspace_service(session, user)
    rows = service.get_prediction_leaderboard()
    return [_normalize_model_text(AIPredictionLeaderboardRow(**row)) for row in rows]


@router.get("/ai/predictions/review-config", response_model=AIPredictionReviewConfigRead)
def ai_prediction_review_config(user: AppUser = Depends(get_current_user)) -> AIPredictionReviewConfigRead:
    _require_v2(user)
    return AIPredictionReviewConfigRead(**get_prediction_review_config())


@router.patch("/ai/predictions/review-config", response_model=AIPredictionReviewConfigRead)
def ai_prediction_review_config_update(
    payload: AIPredictionReviewConfigUpdate,
    user: AppUser = Depends(get_current_user),
) -> AIPredictionReviewConfigRead:
    _require_v2(user)
    row = update_prediction_review_config(
        enabled=payload.enabled,
        review_seconds=payload.review_seconds,
        min_interval_minutes=payload.min_interval_minutes,
    )
    return AIPredictionReviewConfigRead(**row)


@router.get("/ai/predictions/{ticket_id}", response_model=AIPredictionTicketRead)
def ai_prediction_one(
    ticket_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIPredictionTicketRead:
    _require_v2(user)
    row = session.get(AIPredictionTicket, ticket_id)
    if row is None or not _in_scope(row, user):
        raise HTTPException(status_code=404, detail="Prediction ticket not found")
    return _as_prediction_ticket_read(row)


@router.get("/ai/predictions/{ticket_id}/updates", response_model=list[AIPredictionUpdateRead])
def ai_prediction_updates(
    ticket_id: int,
    limit: int = Query(default=120, ge=1, le=300),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIPredictionUpdateRead]:
    _require_v2(user)
    ticket = session.get(AIPredictionTicket, ticket_id)
    if ticket is None or not _in_scope(ticket, user):
        raise HTTPException(status_code=404, detail="Prediction ticket not found")
    service = _workspace_service(session, user)
    rows = service.get_prediction_updates(ticket_id=ticket_id, limit=limit)
    return [_as_prediction_update_read(row) for row in rows]


@router.post("/ai/predictions", response_model=AIPredictionTicketRead)
def ai_prediction_create(
    payload: AIPredictionCreate,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIPredictionTicketRead:
    _require_v2(user)
    service = _workspace_service(session, user)
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
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIPredictionUpdateRead:
    _require_v2(user)
    service = _workspace_service(session, user)
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
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIPredictionTicketRead:
    _require_v2(user)
    service = _workspace_service(session, user)
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
def ai_prediction_delete(
    ticket_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIPredictionDeleteResponse:
    _require_v2(user)
    service = _workspace_service(session, user)
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
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[AIReportRead]:
    _require_v2(user)
    service = _workspace_service(session, user)
    rows = service.list_reports(limit=limit)
    return [_normalize_model_text(AIReportRead(**row)) for row in rows]


@router.get("/ai/reports/{report_id}/download")
def ai_download_report(
    report_id: str,
    format: str = Query(default="pdf", pattern="^(pdf|md|doc)$"),
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> FileResponse:
    _require_v2(user)
    service = _workspace_service(session, user)
    path = service.get_report_file(report_id=report_id, preferred_format=format)
    if path is None:
        raise HTTPException(status_code=404, detail="Report file not found")
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        media_type = "application/pdf"
    elif suffix == ".doc":
        media_type = "application/msword"
    else:
        media_type = "text/markdown; charset=utf-8"
    return FileResponse(path=path, media_type=media_type, filename=path.name)


@router.post("/ai/reports/publish", response_model=AIReportRead)
def ai_publish_report(
    payload: AIReportPublishRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AIReportRead:
    _require_v2(user)
    service = _workspace_service(session, user)
    try:
        row = service.publish_report(
            title=payload.title,
            prompt=payload.prompt,
            insight_id=payload.insight_id,
            event_ids=payload.event_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _normalize_model_text(AIReportRead(**row))


@router.post("/ai/translate/bulk", response_model=AITranslateBulkResponse)
def ai_translate_bulk(
    payload: AITranslateBulkRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AITranslateBulkResponse:
    service = _workspace_service(session, user)
    translations = service.translate_bulk_to_arabic(payload.texts)
    return AITranslateBulkResponse(translations=_normalize_text_payload(translations))
