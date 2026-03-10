from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api.auth import CurrentUser, enforce_page_access, enforce_version, get_current_user
from app.database import get_session
from app.models import AppUser
from app.services.platform_flags import get_platform_flags
from app.services.x_intel_service import XIntelFilters, XIntelService


class XIntelBriefRequest(BaseModel):
    country: str = Field(default="UAE", max_length=80)
    region_preset: str = Field(default="UAE", max_length=40)
    custom_country: str | None = Field(default=None, max_length=80)
    time_window: str = Field(default="24h", pattern="^(1h|6h|24h|3d|7d)$")
    language: str = Field(default="both", pattern="^(arabic|english|both)$")
    threat_sensitivity: str = Field(default="medium", pattern="^(low|medium|high)$")
    include_live: bool = True
    source_class: str = Field(default="all", max_length=32)
    refresh: bool = False


x_intel_router = APIRouter(prefix="/x-intel", dependencies=[Depends(get_current_user)])


def _build_filters(
    country: str,
    region_preset: str,
    custom_country: str | None,
    time_window: str,
    language: str,
    threat_sensitivity: str,
    include_live: bool,
    source_class: str,
) -> XIntelFilters:
    return XIntelFilters(
        country=(country or "UAE").strip() or "UAE",
        region_preset=(region_preset or "UAE").strip() or "UAE",
        custom_country=(custom_country or "").strip() or None,
        time_window=(time_window or "24h").strip().lower(),
        language=(language or "both").strip().lower(),
        threat_sensitivity=(threat_sensitivity or "medium").strip().lower(),
        include_live=bool(include_live),
        source_class=(source_class or "all").strip().lower(),
    )


def _service(session: Session, user: AppUser) -> XIntelService:
    return XIntelService(
        session=session,
        tenant_id=None if user.role == "super_admin" else user.tenant_id,
        user_id=user.id,
        is_super_admin=user.role == "super_admin",
    )


@x_intel_router.get("/dashboard")
def x_intel_dashboard(
    user: CurrentUser,
    session: Session = Depends(get_session),
    country: str = Query(default="UAE"),
    region_preset: str = Query(default="UAE"),
    custom_country: str | None = Query(default=None),
    time_window: str = Query(default="24h", pattern="^(1h|6h|24h|3d|7d)$"),
    language: str = Query(default="both", pattern="^(arabic|english|both)$"),
    threat_sensitivity: str = Query(default="medium", pattern="^(low|medium|high)$"),
    include_live: bool = Query(default=True),
    source_class: str = Query(default="all"),
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    enforce_page_access(user, "xintel")
    enforce_version(user, "v2")
    if not bool(get_platform_flags(session).get("x_api_enabled")):
        raise HTTPException(status_code=503, detail="X API is disabled by super admin.")
    filters = _build_filters(
        country=country,
        region_preset=region_preset,
        custom_country=custom_country,
        time_window=time_window,
        language=language,
        threat_sensitivity=threat_sensitivity,
        include_live=include_live,
        source_class=source_class,
    )
    service = _service(session, user)
    return service.build_dashboard(filters=filters, refresh=refresh)


@x_intel_router.post("/brief")
def x_intel_brief(
    payload: XIntelBriefRequest,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict[str, Any]:
    enforce_page_access(user, "xintel")
    enforce_version(user, "v2")
    if not bool(get_platform_flags(session).get("x_api_enabled")):
        raise HTTPException(status_code=503, detail="X API is disabled by super admin.")
    filters = _build_filters(
        country=payload.country,
        region_preset=payload.region_preset,
        custom_country=payload.custom_country,
        time_window=payload.time_window,
        language=payload.language,
        threat_sensitivity=payload.threat_sensitivity,
        include_live=payload.include_live,
        source_class=payload.source_class,
    )
    service = _service(session, user)
    snapshot = service.build_dashboard(filters=filters, refresh=payload.refresh)
    brief = service.generateIntelBrief(snapshot, filters=filters)
    return {
        "last_updated": snapshot.get("last_updated"),
        "brief": brief,
        "filters": snapshot.get("filters"),
    }


@x_intel_router.get("/hashtag-explain")
def x_intel_hashtag_explain(
    user: CurrentUser,
    session: Session = Depends(get_session),
    hashtag: str = Query(default="", min_length=1, max_length=120),
    country: str = Query(default="UAE"),
    region_preset: str = Query(default="UAE"),
    custom_country: str | None = Query(default=None),
    time_window: str = Query(default="24h", pattern="^(1h|6h|24h|3d|7d)$"),
    language: str = Query(default="both", pattern="^(arabic|english|both)$"),
    threat_sensitivity: str = Query(default="medium", pattern="^(low|medium|high)$"),
    include_live: bool = Query(default=True),
    source_class: str = Query(default="all"),
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    enforce_page_access(user, "xintel")
    enforce_version(user, "v2")
    if not bool(get_platform_flags(session).get("x_api_enabled")):
        raise HTTPException(status_code=503, detail="X API is disabled by super admin.")
    filters = _build_filters(
        country=country,
        region_preset=region_preset,
        custom_country=custom_country,
        time_window=time_window,
        language=language,
        threat_sensitivity=threat_sensitivity,
        include_live=include_live,
        source_class=source_class,
    )
    service = _service(session, user)
    snapshot = service.build_dashboard(filters=filters, refresh=refresh)
    return service.explain_hashtag(snapshot, hashtag=hashtag)
