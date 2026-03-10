from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SourceType = Literal["news", "flight", "marine", "incident", "cyber", "social", "custom"]


class SourceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    source_type: SourceType
    endpoint: str = Field(min_length=5, max_length=500)
    parser_hint: Optional[str] = None
    poll_interval_seconds: int = Field(default=120, ge=15, le=3600)
    tenant_id: Optional[int] = None


class SourceRead(BaseModel):
    id: int
    tenant_id: Optional[int]
    name: str
    source_type: SourceType
    endpoint: str
    parser_hint: Optional[str]
    enabled: bool
    poll_interval_seconds: int
    created_at: datetime
    last_polled_at: Optional[datetime]


class SourceToggle(BaseModel):
    enabled: bool


class EventRead(BaseModel):
    id: int
    tenant_id: Optional[int]
    source_type: str
    source_name: str
    title: str
    summary: Optional[str]
    details: Optional[str]
    url: Optional[str]
    location: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    event_time: datetime
    relevance_score: float
    severity: int
    tags: str
    ai_assessment: Optional[str]
    created_at: datetime


class AlertRead(BaseModel):
    id: int
    tenant_id: Optional[int]
    event_id: int
    level: str
    title: str
    details: str
    acknowledged: bool
    created_at: datetime


class IngestRunResponse(BaseModel):
    mode: Literal["sync", "queued"]
    job_id: Optional[str] = None
    sources_polled: int = 0
    events_collected: int = 0
    events_stored: int = 0
    alerts_created: int = 0


class JobStatusRead(BaseModel):
    job_id: str
    status: str
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class AIChatRequest(BaseModel):
    message: str = Field(min_length=2, max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIChatMessageRead(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime


class AIInsightCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    prompt: str = Field(min_length=2, max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIInsightRead(BaseModel):
    id: int
    title: str
    prompt: str
    content: str
    related_event_ids: str
    created_at: datetime


class AIChatResponse(BaseModel):
    message: AIChatMessageRead
    created_insight: Optional[AIInsightRead] = None
    privacy_mode: bool


class AIChatDeleteResponse(BaseModel):
    deleted_count: int
    scope: Literal["all", "single"]


class AIInsightDeleteResponse(BaseModel):
    deleted_count: int


class AIPrivacyRead(BaseModel):
    privacy_mode: bool
    openai_enabled: bool


class AIStatusRead(BaseModel):
    configured: bool
    connected: bool
    model: str
    message: str


class AIReportPublishRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    insight_id: Optional[int] = None
    event_ids: list[int] = Field(default_factory=list)


class AIReportRead(BaseModel):
    report_id: str
    title: str
    filename: str
    pdf_filename: Optional[str] = None
    doc_filename: Optional[str] = None
    created_at: str
    content: str


class AITranslateBulkRequest(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=120)


class AITranslateBulkResponse(BaseModel):
    translations: list[str] = Field(default_factory=list)


class AIPredictionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    focus_query: str = Field(min_length=2, max_length=220)
    request_text: str = Field(min_length=2, max_length=4000)
    horizon_hours: int = Field(default=24, ge=1, le=720)
    scope: str = Field(default="general", max_length=120)
    event_ids: list[int] = Field(default_factory=list)


class AIPredictionUpdateCreate(BaseModel):
    note: str = Field(default="", max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIPredictionOutcomeSet(BaseModel):
    outcome: Literal["correct", "partial", "wrong", "unknown"]
    note: str = Field(default="", max_length=2000)
    status: Literal["open", "watching", "resolved"] = "resolved"


class AIPredictionTicketRead(BaseModel):
    id: int
    title: str
    focus_query: str
    request_text: str
    prediction_text: str
    confidence: float
    horizon_hours: int
    status: str
    outcome: str
    scope: str
    related_event_ids: str
    created_at: datetime
    updated_at: datetime


class AIPredictionUpdateRead(BaseModel):
    id: int
    ticket_id: int
    kind: str
    content: str
    outcome: Optional[str]
    created_at: datetime


class AIPredictionLeaderboardRow(BaseModel):
    model: str
    window_hours: int
    window_label: str
    evaluated_tickets: int
    accuracy: float
    correct_count: int
    partial_count: int
    wrong_count: int
    trend_delta: float


class AIPredictionDeleteResponse(BaseModel):
    deleted_count: int = 0


class AIPredictionReviewConfigRead(BaseModel):
    enabled: bool
    review_seconds: int = Field(ge=60, le=86400)
    min_interval_minutes: int = Field(ge=1, le=1440)


class AIPredictionReviewConfigUpdate(BaseModel):
    enabled: bool | None = None
    review_seconds: int | None = Field(default=None, ge=60, le=86400)
    min_interval_minutes: int | None = Field(default=None, ge=1, le=1440)


UserStatus = Literal["pending", "approved", "rejected", "suspended", "inactive"]
UserRole = Literal["super_admin", "admin", "user"]
AccessVersion = Literal["v1", "v2"]
AuthMethod = Literal["password", "email_otp", "mobile_auth", "hybrid"]
PageKey = Literal["v1", "v2", "xintel"]


class TenantRead(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    created_at: datetime
    updated_at: datetime


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    slug: str = Field(min_length=2, max_length=140)
    status: str = Field(default="active", max_length=40)


class TenantUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=140)
    slug: Optional[str] = Field(default=None, min_length=2, max_length=140)
    status: Optional[str] = Field(default=None, max_length=40)


class UserRegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=180)
    email: str = Field(min_length=5, max_length=255)
    password: Optional[str] = Field(default=None, min_length=8, max_length=120)


class AdminUserCreateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=180)
    email: str = Field(min_length=5, max_length=255)
    password: Optional[str] = Field(default=None, min_length=8, max_length=120)
    tenant_id: Optional[int] = None
    role: UserRole = "user"
    access_version: AccessVersion = "v1"
    page_access: Optional[list[PageKey]] = None
    auth_method: AuthMethod = "hybrid"
    status: UserStatus = "approved"


class UserRegisterResponse(BaseModel):
    user_id: int
    status: UserStatus
    message: str


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: Optional[str] = Field(default=None, min_length=1, max_length=120)
    totp_code: Optional[str] = Field(default=None, min_length=4, max_length=12)
    otp_code: Optional[str] = Field(default=None, min_length=4, max_length=12)


class OTPRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    purpose: str = Field(default="login", max_length=40)


class OTPRequestResponse(BaseModel):
    ok: bool
    message: str
    expires_in_seconds: int
    dev_code: Optional[str] = None


class OTPVerifyRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    code: str = Field(min_length=4, max_length=12)
    purpose: str = Field(default="login", max_length=40)


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)


class PasswordResetRequestResponse(BaseModel):
    ok: bool
    message: str


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=1024)
    new_password: str = Field(min_length=8, max_length=120)


class PasswordResetConfirmResponse(BaseModel):
    ok: bool
    message: str


class AuthRefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=5000)


class AuthLogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


class AuthUserRead(BaseModel):
    id: int
    full_name: str
    email: str
    status: UserStatus
    role: UserRole
    access_version: AccessVersion
    page_access: list[PageKey] = Field(default_factory=list)
    tenant_id: Optional[int]
    auth_method: AuthMethod
    totp_enabled: bool = False
    totp_enabled_at: Optional[datetime] = None
    totp_last_used: Optional[datetime] = None
    last_login_at: Optional[datetime]
    last_active_at: Optional[datetime]
    login_count: int
    created_at: datetime


class AuthTokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthUserRead


class UserRead(BaseModel):
    id: int
    full_name: str
    email: str
    status: UserStatus
    role: UserRole
    access_version: AccessVersion
    page_access: list[PageKey] = Field(default_factory=list)
    tenant_id: Optional[int]
    auth_method: AuthMethod
    totp_enabled: bool = False
    totp_enabled_at: Optional[datetime] = None
    totp_last_used: Optional[datetime] = None
    approved_by: Optional[int]
    approved_at: Optional[datetime]
    last_login_at: Optional[datetime]
    last_active_at: Optional[datetime]
    login_count: int
    created_at: datetime
    updated_at: datetime


class UserApproveRequest(BaseModel):
    tenant_id: Optional[int] = None
    access_version: AccessVersion
    role: UserRole = "user"
    page_access: Optional[list[PageKey]] = None


class UserRejectRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=1000)


class UserStatusUpdateRequest(BaseModel):
    status: Literal["approved", "suspended", "inactive"]


class UserAccessVersionUpdateRequest(BaseModel):
    access_version: AccessVersion


class UserTenantUpdateRequest(BaseModel):
    tenant_id: int


class UserRoleUpdateRequest(BaseModel):
    role: UserRole


class UserPageAccessUpdateRequest(BaseModel):
    page_access: list[PageKey] = Field(default_factory=list)


class UserAuthResetRequest(BaseModel):
    reset_password: bool = False
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=120)
    reset_otp: bool = True
    reset_totp: bool = False


class TOTPStatusRead(BaseModel):
    enabled: bool
    enabled_at: Optional[datetime] = None
    last_used: Optional[datetime] = None
    pending_setup: bool = False


class TOTPSetupStartRequest(BaseModel):
    password: str = Field(min_length=1, max_length=120)


class TOTPSetupStartResponse(BaseModel):
    manual_entry_key: str
    secret_masked: str
    otpauth_uri: str
    qr_code_data_url: str


class TOTPSetupVerifyRequest(BaseModel):
    code: str = Field(min_length=4, max_length=12)


class TOTPDisableRequest(BaseModel):
    password: str = Field(min_length=1, max_length=120)
    code: Optional[str] = Field(default=None, min_length=4, max_length=12)


class TOTPDisableResponse(BaseModel):
    ok: bool = True


class AdminDashboardStatsRead(BaseModel):
    total_users: int
    pending_users: int
    approved_users: int
    active_users: int
    suspended_users: int
    inactive_users: int
    v1_users: int
    v2_users: int
    total_api_usage: float
    total_api_cost: float
    live_active_users: int = 0
    live_active_sessions: int = 0


class AdminUserDeleteResponse(BaseModel):
    ok: bool = True
    deleted_user_id: int


class ActiveSessionRead(BaseModel):
    session_id: str
    user_id: int
    full_name: str
    email: str
    role: UserRole
    access_version: AccessVersion
    page_access: list[PageKey] = Field(default_factory=list)
    tenant_id: Optional[int]
    ip_address: Optional[str]
    user_agent: Optional[str]
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime


class APIUsageLogRead(BaseModel):
    id: int
    user_id: Optional[int]
    tenant_id: Optional[int]
    provider: str
    endpoint: str
    usage_units: float
    cost: float
    request_id: Optional[str]
    created_at: datetime


class APIUsageSummaryRow(BaseModel):
    user_id: Optional[int]
    tenant_id: Optional[int]
    usage_units: float
    cost: float
    calls: int


class AuditLogRead(BaseModel):
    id: int
    actor_user_id: Optional[int]
    target_user_id: Optional[int]
    tenant_id: Optional[int]
    action: str
    metadata_json: Optional[str]
    created_at: datetime


class PlatformFlagsRead(BaseModel):
    openai_enabled: bool
    x_api_enabled: bool
    updated_at: Optional[datetime] = None


class PlatformFlagsUpdate(BaseModel):
    openai_enabled: Optional[bool] = None
    x_api_enabled: Optional[bool] = None
