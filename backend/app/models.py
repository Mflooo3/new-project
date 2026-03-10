from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Tenant(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, max_length=140)
    slug: str = Field(index=True, unique=True, max_length=140)
    status: str = Field(default="active", index=True, max_length=40)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)


class AppUser(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    full_name: str = Field(max_length=180)
    email: str = Field(index=True, unique=True, max_length=255)
    password_hash: Optional[str] = Field(default=None, max_length=512)
    status: str = Field(default="pending", index=True, max_length=40)
    role: str = Field(default="user", index=True, max_length=40)
    access_version: str = Field(default="v1", index=True, max_length=10)
    page_access: str = Field(default="v1", max_length=120)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    auth_method: str = Field(default="password", index=True, max_length=40)
    email_verified_at: Optional[datetime] = Field(default=None, index=True)
    approved_by: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    approved_at: Optional[datetime] = Field(default=None, index=True)
    failed_login_attempts: int = Field(default=0, ge=0)
    locked_until: Optional[datetime] = Field(default=None, index=True)
    totp_enabled: bool = Field(default=False, index=True)
    totp_secret: Optional[str] = Field(default=None, max_length=1024)
    totp_pending_secret: Optional[str] = Field(default=None, max_length=1024)
    totp_enabled_at: Optional[datetime] = Field(default=None, index=True)
    totp_last_used: Optional[datetime] = Field(default=None, index=True)
    totp_failed_attempts: int = Field(default=0, ge=0)
    totp_locked_until: Optional[datetime] = Field(default=None, index=True)
    last_login_at: Optional[datetime] = Field(default=None, index=True)
    last_active_at: Optional[datetime] = Field(default=None, index=True)
    login_count: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)


class OTPCode(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="appuser.id", index=True)
    code_hash: str = Field(max_length=255)
    purpose: str = Field(default="login", index=True, max_length=40)
    expires_at: datetime = Field(index=True)
    used_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class UserSession(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="appuser.id", index=True)
    session_id: str = Field(max_length=120, index=True)
    session_token_hash: str = Field(max_length=255, index=True)
    ip_address: Optional[str] = Field(default=None, max_length=100)
    user_agent: Optional[str] = Field(default=None, max_length=500)
    last_seen_at: datetime = Field(default_factory=utcnow, index=True)
    expires_at: datetime = Field(index=True)
    revoked_at: Optional[datetime] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class APIUsageLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    provider: str = Field(default="internal", index=True, max_length=120)
    endpoint: str = Field(index=True, max_length=240)
    usage_units: float = Field(default=1.0)
    cost: float = Field(default=0.0)
    request_id: Optional[str] = Field(default=None, index=True, max_length=120)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class PlatformSetting(SQLModel, table=True):
    key: str = Field(primary_key=True, max_length=120)
    value_bool: bool = Field(default=True, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)
    updated_by: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)


class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    actor_user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    target_user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    action: str = Field(index=True, max_length=160)
    metadata_json: Optional[str] = Field(default=None, max_length=6000)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Source(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    name: str = Field(index=True)
    source_type: str = Field(index=True)
    endpoint: str
    parser_hint: Optional[str] = None
    enabled: bool = Field(default=True, index=True)
    poll_interval_seconds: int = Field(default=120)
    created_at: datetime = Field(default_factory=utcnow)
    last_polled_at: Optional[datetime] = None


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    source_id: Optional[int] = Field(default=None, foreign_key="source.id", index=True)
    source_type: str = Field(index=True)
    source_name: str = Field(index=True)
    external_id: Optional[str] = Field(default=None, index=True)
    title: str
    summary: Optional[str] = None
    details: Optional[str] = None
    url: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    event_time: datetime = Field(default_factory=utcnow, index=True)
    relevance_score: float = Field(default=0.0)
    severity: int = Field(default=1, ge=1, le=5, index=True)
    tags: str = ""
    ai_assessment: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Alert(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    event_id: int = Field(foreign_key="event.id", index=True)
    level: str = Field(default="medium", index=True)
    title: str
    details: str
    acknowledged: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    role: str = Field(index=True)
    content: str
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIInsight(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    title: str = Field(index=True)
    prompt: str
    content: str
    related_event_ids: str = ""
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIPredictionTicket(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    title: str = Field(index=True)
    focus_query: str = Field(index=True)
    request_text: str
    prediction_text: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    horizon_hours: int = Field(default=24, ge=1, le=720)
    status: str = Field(default="open", index=True)
    outcome: str = Field(default="unknown", index=True)
    scope: str = Field(default="general")
    related_event_ids: str = ""
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)


class AIPredictionUpdate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    tenant_id: Optional[int] = Field(default=None, foreign_key="tenant.id", index=True)
    user_id: Optional[int] = Field(default=None, foreign_key="appuser.id", index=True)
    ticket_id: int = Field(foreign_key="aipredictionticket.id", index=True)
    kind: str = Field(default="update", index=True)
    content: str
    outcome: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)
