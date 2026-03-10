from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, desc, select

from app.api.iam_routes import admin_router, auth_router
from app.api.routes import public_router, router
from app.api.x_intel_routes import x_intel_router
from app.config import settings
from app.database import engine, init_db
from app.models import AppUser, UserSession
from app.services.bootstrap import seed_default_sources
from app.services.auth_service import (
    AuthService,
    backfill_legacy_tenant_scope,
    decode_token,
    ensure_platform_bootstrap,
)
from app.services.scheduler import start_scheduler, stop_scheduler

app = FastAPI(title=settings.app_name, version="0.1.0")

cors_origins = settings.cors_origins_list
allow_credentials = cors_origins != ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(router)
app.include_router(x_intel_router)
app.include_router(auth_router)
app.include_router(admin_router)


def _extract_bearer(authorization: str | None) -> str | None:
    raw = (authorization or "").strip()
    if not raw.lower().startswith("bearer "):
        return None
    token = raw[7:].strip()
    return token or None


@app.middleware("http")
async def activity_and_usage_middleware(request: Request, call_next):
    response = await call_next(request)
    if not settings.auth_required:
        return response
    if request.url.path in {"/health", "/openapi.json", "/docs", "/redoc"}:
        return response

    token = _extract_bearer(request.headers.get("authorization"))
    if not token:
        return response

    try:
        payload = decode_token(token)
    except Exception:
        return response
    if payload.get("typ") != "access":
        return response
    exp_ts = int(payload.get("exp") or 0)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if exp_ts <= now_ts:
        return response
    user_id = int(payload.get("sub") or 0)
    if user_id <= 0:
        return response

    with Session(engine) as session:
        user = session.get(AppUser, user_id)
        if user is None or user.status != "approved":
            return response
        auth_service = AuthService(session)
        auth_service.touch_user(user)
        sid = str(payload.get("sid") or "").strip()
        if sid:
            session_row = session.exec(
                select(UserSession)
                .where(UserSession.user_id == user_id)
                .where(UserSession.session_id == sid)
                .where(UserSession.revoked_at.is_(None))
                .order_by(desc(UserSession.created_at))
                .limit(1)
            ).first()
            if session_row is not None:
                session_row.last_seen_at = datetime.now(timezone.utc)
                session.add(session_row)
                session.commit()
        if request.url.path not in {"/stream"} and not request.url.path.startswith("/auth/"):
            auth_service.track_api_usage(
                user=user,
                endpoint=request.url.path,
                provider="internal",
                usage_units=1.0,
                cost=None,
                request_id=request.headers.get("x-request-id"),
            )
    return response


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    with Session(engine) as session:
        default_tenant, _ = ensure_platform_bootstrap(session)
        if default_tenant.id is not None:
            backfill_legacy_tenant_scope(session, tenant_id=default_tenant.id)
        seed_default_sources(session, tenant_id=default_tenant.id)
    start_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_scheduler()
