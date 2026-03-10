from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlmodel import Session, desc, select

from app.api.auth import CurrentUser, get_current_user, require_admin, require_super_admin
from app.config import settings
from app.database import get_session
from app.models import (
    APIUsageLog,
    AIChatMessage,
    AIInsight,
    AIPredictionTicket,
    AIPredictionUpdate,
    AppUser,
    AuditLog,
    OTPCode,
    Tenant,
    UserSession,
)
from app.schemas import (
    ActiveSessionRead,
    AdminUserCreateRequest,
    AdminUserDeleteResponse,
    APIUsageLogRead,
    APIUsageSummaryRow,
    AccessVersion,
    AdminDashboardStatsRead,
    AuditLogRead,
    AuthLogoutRequest,
    AuthRefreshRequest,
    AuthTokenResponse,
    AuthUserRead,
    LoginRequest,
    OTPRequest,
    OTPRequestResponse,
    OTPVerifyRequest,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    PlatformFlagsRead,
    PlatformFlagsUpdate,
    TOTPDisableRequest,
    TOTPDisableResponse,
    TOTPSetupStartRequest,
    TOTPSetupStartResponse,
    TOTPSetupVerifyRequest,
    TOTPStatusRead,
    TenantCreate,
    TenantRead,
    TenantUpdate,
    UserAccessVersionUpdateRequest,
    UserApproveRequest,
    UserAuthResetRequest,
    UserRead,
    UserRegisterRequest,
    UserRegisterResponse,
    UserRejectRequest,
    UserRoleUpdateRequest,
    UserPageAccessUpdateRequest,
    UserStatus,
    UserStatusUpdateRequest,
    UserTenantUpdateRequest,
)
from app.services.access_control import parse_page_access_string, serialize_page_access
from app.services.auth_service import AuthService, log_audit, provision_tenant_for_user, pwd_context, to_auth_user
from app.services.platform_flags import get_platform_flags, set_platform_flags


auth_router = APIRouter(prefix="/auth", tags=["auth"])
admin_router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_utc_naive(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _user_read(user: AppUser) -> UserRead:
    return UserRead(
        id=user.id or 0,
        full_name=user.full_name,
        email=user.email,
        status=user.status,  # type: ignore[arg-type]
        role=user.role,  # type: ignore[arg-type]
        access_version=user.access_version,  # type: ignore[arg-type]
        page_access=parse_page_access_string(user.page_access, access_version=user.access_version),  # type: ignore[arg-type]
        tenant_id=user.tenant_id,
        auth_method=user.auth_method,  # type: ignore[arg-type]
        totp_enabled=bool(user.totp_enabled),
        totp_enabled_at=user.totp_enabled_at,
        totp_last_used=user.totp_last_used,
        approved_by=user.approved_by,
        approved_at=user.approved_at,
        last_login_at=user.last_login_at,
        last_active_at=user.last_active_at,
        login_count=int(user.login_count or 0),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _tenant_read(row: Tenant) -> TenantRead:
    return TenantRead(
        id=row.id or 0,
        name=row.name,
        slug=row.slug,
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _assert_admin_scope(actor: AppUser, tenant_id: int | None) -> None:
    if actor.role == "super_admin":
        return
    if not actor.tenant_id:
        raise HTTPException(status_code=403, detail="Admin tenant scope is missing")
    if tenant_id != actor.tenant_id:
        raise HTTPException(status_code=403, detail="Cross-tenant action is not allowed")


def _get_user_in_scope(session: Session, actor: AppUser, user_id: int) -> AppUser:
    row = session.get(AppUser, user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    _assert_admin_scope(actor, row.tenant_id)
    return row


def _assert_role_assignment_allowed(actor: AppUser, role: str) -> None:
    target = str(role or "user").strip().lower()
    if target == "super_admin" and actor.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super admin can assign super_admin role")


def _resolve_or_provision_tenant(
    session: Session,
    *,
    actor: AppUser,
    role: str,
    full_name: str,
    email: str,
    requested_tenant_id: int | None,
) -> int | None:
    target_role = str(role or "user").strip().lower()
    if target_role == "super_admin":
        return None
    if actor.role != "super_admin":
        return actor.tenant_id
    if requested_tenant_id:
        tenant = session.get(Tenant, requested_tenant_id)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
        return tenant.id
    tenant = provision_tenant_for_user(
        session,
        full_name=full_name,
        email=email,
    )
    return tenant.id


def _active_sessions_in_scope(session: Session, actor: AppUser) -> list[tuple[UserSession, AppUser]]:
    now = _now()
    cutoff = now - timedelta(minutes=max(1, settings.session_idle_timeout_minutes))
    query = (
        select(UserSession)
        .where(UserSession.revoked_at.is_(None))
        .where(UserSession.expires_at >= now)
        .where(UserSession.last_seen_at >= cutoff)
        .order_by(desc(UserSession.last_seen_at))
        .limit(5000)
    )
    rows = session.exec(query).all()
    out: list[tuple[UserSession, AppUser]] = []
    for row in rows:
        user = session.get(AppUser, row.user_id)
        if user is None:
            continue
        if actor.role != "super_admin" and user.tenant_id != actor.tenant_id:
            continue
        out.append((row, user))
    return out


@auth_router.post("/register", response_model=UserRegisterResponse, status_code=201)
def auth_register(payload: UserRegisterRequest, session: Session = Depends(get_session)) -> UserRegisterResponse:
    service = AuthService(session)
    try:
        return service.register(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/login", response_model=AuthTokenResponse)
def auth_login(
    payload: LoginRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> AuthTokenResponse:
    service = AuthService(session)
    try:
        if payload.password:
            return service.login_password(
                payload,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        if payload.otp_code:
            return service.verify_otp(
                OTPVerifyRequest(email=payload.email, code=payload.otp_code, purpose="login"),
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        raise ValueError("Provide password or OTP code.")
    except ValueError as exc:
        detail = str(exc)
        blocked_reasons = (
            "Login is blocked until admin approval.",
            "Account is temporarily locked due to repeated failed attempts.",
            "User is missing tenant assignment.",
            "User has no page access grants. Ask admin to assign page access.",
        )
        status_code = 403 if detail in blocked_reasons else 401
        raise HTTPException(status_code=status_code, detail=detail) from exc


@auth_router.post("/request-otp", response_model=OTPRequestResponse)
def auth_request_otp(payload: OTPRequest, session: Session = Depends(get_session)) -> OTPRequestResponse:
    service = AuthService(session)
    try:
        return service.request_otp(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/password-reset/request", response_model=PasswordResetRequestResponse)
def auth_password_reset_request(
    payload: PasswordResetRequest,
    session: Session = Depends(get_session),
) -> PasswordResetRequestResponse:
    service = AuthService(session)
    try:
        return service.request_password_reset(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/password-reset/confirm", response_model=PasswordResetConfirmResponse)
def auth_password_reset_confirm(
    payload: PasswordResetConfirmRequest,
    session: Session = Depends(get_session),
) -> PasswordResetConfirmResponse:
    service = AuthService(session)
    try:
        return service.confirm_password_reset(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/verify-otp", response_model=AuthTokenResponse)
def auth_verify_otp(
    payload: OTPVerifyRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> AuthTokenResponse:
    service = AuthService(session)
    try:
        return service.verify_otp(
            payload,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@auth_router.post("/refresh", response_model=AuthTokenResponse)
def auth_refresh(
    payload: AuthRefreshRequest,
    request: Request,
    session: Session = Depends(get_session),
) -> AuthTokenResponse:
    service = AuthService(session)
    try:
        return service.refresh(
            payload.refresh_token,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
        )
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@auth_router.post("/logout")
def auth_logout(
    payload: AuthLogoutRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> dict[str, bool]:
    service = AuthService(session)
    service.logout(user=user, refresh_token=payload.refresh_token)
    return {"ok": True}


@auth_router.get("/me", response_model=AuthUserRead)
def auth_me(user: AppUser = Depends(get_current_user)) -> AuthUserRead:
    return to_auth_user(user)


@auth_router.get("/totp/status", response_model=TOTPStatusRead)
def auth_totp_status(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TOTPStatusRead:
    service = AuthService(session)
    row = session.get(AppUser, user.id or 0)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    return service.totp_status(row)


@auth_router.post("/totp/setup-start", response_model=TOTPSetupStartResponse)
def auth_totp_setup_start(
    payload: TOTPSetupStartRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TOTPSetupStartResponse:
    service = AuthService(session)
    row = session.get(AppUser, user.id or 0)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        return service.start_totp_setup(user=row, password=payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/totp/setup-verify", response_model=TOTPStatusRead)
def auth_totp_setup_verify(
    payload: TOTPSetupVerifyRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TOTPStatusRead:
    service = AuthService(session)
    row = session.get(AppUser, user.id or 0)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        return service.verify_totp_setup(user=row, code=payload.code)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@auth_router.post("/totp/disable", response_model=TOTPDisableResponse)
def auth_totp_disable(
    payload: TOTPDisableRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TOTPDisableResponse:
    service = AuthService(session)
    row = session.get(AppUser, user.id or 0)
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    try:
        return service.disable_totp(user=row, payload=payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@admin_router.get("/dashboard/stats", response_model=AdminDashboardStatsRead)
def admin_dashboard_stats(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AdminDashboardStatsRead:
    query = select(AppUser)
    if user.role != "super_admin":
        query = query.where(AppUser.tenant_id == user.tenant_id)
    users = session.exec(query).all()
    usage_query = select(APIUsageLog)
    if user.role != "super_admin":
        usage_query = usage_query.where(APIUsageLog.tenant_id == user.tenant_id)
    usage_rows = session.exec(usage_query).all()
    live_sessions = _active_sessions_in_scope(session, user)
    live_user_ids = {row_user.id for _, row_user in live_sessions if row_user.id is not None}

    active_threshold = _normalize_utc_naive(_now() - timedelta(days=max(1, settings.active_user_window_days)))
    return AdminDashboardStatsRead(
        total_users=len(users),
        pending_users=sum(1 for row in users if row.status == "pending"),
        approved_users=sum(1 for row in users if row.status == "approved"),
        active_users=sum(
            1
            for row in users
            if (
                (last_active := _normalize_utc_naive(row.last_active_at)) is not None
                and active_threshold is not None
                and last_active >= active_threshold
            )
        ),
        suspended_users=sum(1 for row in users if row.status == "suspended"),
        inactive_users=sum(1 for row in users if row.status == "inactive"),
        v1_users=sum(1 for row in users if row.access_version == "v1"),
        v2_users=sum(1 for row in users if row.access_version == "v2"),
        total_api_usage=round(sum(float(row.usage_units or 0.0) for row in usage_rows), 3),
        total_api_cost=round(sum(float(row.cost or 0.0) for row in usage_rows), 6),
        live_active_users=len(live_user_ids),
        live_active_sessions=len(live_sessions),
    )


@admin_router.get("/platform/flags", response_model=PlatformFlagsRead, dependencies=[Depends(require_super_admin)])
def admin_platform_flags(
    session: Session = Depends(get_session),
) -> PlatformFlagsRead:
    flags = get_platform_flags(session)
    return PlatformFlagsRead(
        openai_enabled=bool(flags.get("openai_enabled")),
        x_api_enabled=bool(flags.get("x_api_enabled")),
        updated_at=flags.get("updated_at"),
    )


@admin_router.patch("/platform/flags", response_model=PlatformFlagsRead, dependencies=[Depends(require_super_admin)])
def admin_platform_flags_update(
    payload: PlatformFlagsUpdate,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> PlatformFlagsRead:
    if payload.openai_enabled is None and payload.x_api_enabled is None:
        raise HTTPException(status_code=400, detail="No flag updates provided")
    flags = set_platform_flags(
        session,
        openai_enabled=payload.openai_enabled,
        x_api_enabled=payload.x_api_enabled,
        actor_user_id=user.id,
    )
    log_audit(
        session,
        action="admin.platform_flags_updated",
        actor_user_id=user.id,
        tenant_id=user.tenant_id,
        metadata={
            "openai_enabled": payload.openai_enabled,
            "x_api_enabled": payload.x_api_enabled,
        },
    )
    return PlatformFlagsRead(
        openai_enabled=bool(flags.get("openai_enabled")),
        x_api_enabled=bool(flags.get("x_api_enabled")),
        updated_at=flags.get("updated_at"),
    )


@admin_router.get("/users", response_model=list[UserRead])
def admin_users(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    status_filter: UserStatus | None = Query(default=None, alias="status"),
    version: AccessVersion | None = Query(default=None),
    tenant_id: int | None = Query(default=None),
    query_text: str | None = Query(default=None),
    limit: int = Query(default=400, ge=1, le=2000),
) -> list[UserRead]:
    query = select(AppUser)
    if user.role != "super_admin":
        query = query.where(AppUser.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(AppUser.tenant_id == tenant_id)
    if status_filter:
        query = query.where(AppUser.status == status_filter)
    if version:
        query = query.where(AppUser.access_version == version)
    rows = session.exec(query.order_by(desc(AppUser.created_at)).limit(limit)).all()
    if query_text:
        needle = query_text.strip().lower()
        rows = [
            row
            for row in rows
            if needle in f"{row.full_name} {row.email} {row.role} {row.status} {row.access_version}".lower()
        ]
    return [_user_read(row) for row in rows]


@admin_router.post("/users", response_model=UserRead, status_code=201)
def admin_user_create(
    payload: AdminUserCreateRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    email = str(payload.email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    existing = session.exec(select(AppUser).where(AppUser.email == email)).first()
    if existing is not None:
        raise HTTPException(status_code=400, detail="User email already exists")

    _assert_role_assignment_allowed(user, payload.role)
    target_tenant_id = _resolve_or_provision_tenant(
        session,
        actor=user,
        role=payload.role,
        full_name=payload.full_name.strip(),
        email=email,
        requested_tenant_id=payload.tenant_id,
    )
    _assert_admin_scope(user, target_tenant_id)
    if payload.role != "super_admin" and not target_tenant_id:
        raise HTTPException(status_code=400, detail="Tenant provisioning failed for this user")

    auth_method = str(payload.auth_method or "hybrid").strip().lower()
    if auth_method not in {"password", "email_otp", "mobile_auth", "hybrid"}:
        raise HTTPException(status_code=400, detail="Invalid auth_method")
    if auth_method in {"password", "hybrid"} and settings.auth_password_enabled and not payload.password:
        raise HTTPException(status_code=400, detail="Password is required for selected auth_method")

    now = _now()
    password_hash = pwd_context.hash(payload.password) if payload.password else None
    status_value = str(payload.status or "approved").strip().lower()
    if status_value not in {"pending", "approved", "rejected", "suspended", "inactive"}:
        raise HTTPException(status_code=400, detail="Invalid user status")
    if status_value == "approved" and payload.role != "super_admin" and not target_tenant_id:
        raise HTTPException(status_code=400, detail="Approved non-super-admin user must have tenant assignment")

    row = AppUser(
        full_name=payload.full_name.strip(),
        email=email,
        password_hash=password_hash,
        status=status_value,
        role=payload.role,
        access_version=payload.access_version,
        page_access=serialize_page_access(payload.page_access, access_version=payload.access_version),
        tenant_id=None if payload.role == "super_admin" else target_tenant_id,
        auth_method=auth_method,
        approved_by=user.id if status_value == "approved" else None,
        approved_at=now if status_value == "approved" else None,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_created",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={
            "role": row.role,
            "status": row.status,
            "access_version": row.access_version,
            "page_access": row.page_access,
        },
    )
    return _user_read(row)


@admin_router.get("/users/{user_id}", response_model=UserRead)
def admin_user_one(user_id: int, user: AppUser = Depends(get_current_user), session: Session = Depends(get_session)) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    return _user_read(row)


@admin_router.patch("/users/{user_id}/approve", response_model=UserRead)
def admin_user_approve(
    user_id: int,
    payload: UserApproveRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    tenant_id = payload.tenant_id
    if row.role != "super_admin" and not tenant_id:
        tenant_id = row.tenant_id
    if row.role != "super_admin" and not tenant_id:
        tenant = provision_tenant_for_user(
            session,
            full_name=row.full_name,
            email=row.email,
        )
        tenant_id = tenant.id
    _assert_admin_scope(user, tenant_id)
    if row.role != "super_admin":
        tenant = session.get(Tenant, tenant_id or 0)
        if tenant is None:
            raise HTTPException(status_code=404, detail="Tenant not found")
    if row.status == "rejected":
        raise HTTPException(status_code=400, detail="Rejected users cannot be auto-approved; create a new account.")
    row.status = "approved"
    row.tenant_id = None if row.role == "super_admin" else tenant_id
    row.access_version = payload.access_version
    row.page_access = serialize_page_access(payload.page_access, access_version=payload.access_version)
    row.role = payload.role
    row.approved_by = user.id
    row.approved_at = _now()
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_approved",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"role": row.role, "access_version": row.access_version},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/reject", response_model=UserRead)
def admin_user_reject(
    user_id: int,
    payload: UserRejectRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.status = "rejected"
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_rejected",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"reason": payload.reason or ""},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/suspend", response_model=UserRead)
def admin_user_suspend(user_id: int, user: AppUser = Depends(get_current_user), session: Session = Depends(get_session)) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.status = "suspended"
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(session, action="admin.user_suspended", actor_user_id=user.id, target_user_id=row.id, tenant_id=row.tenant_id)
    return _user_read(row)


@admin_router.patch("/users/{user_id}/reactivate", response_model=UserRead)
def admin_user_reactivate(user_id: int, user: AppUser = Depends(get_current_user), session: Session = Depends(get_session)) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.status = "approved"
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(session, action="admin.user_reactivated", actor_user_id=user.id, target_user_id=row.id, tenant_id=row.tenant_id)
    return _user_read(row)


@admin_router.patch("/users/{user_id}/access-version", response_model=UserRead)
def admin_user_access_version(
    user_id: int,
    payload: UserAccessVersionUpdateRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.access_version = payload.access_version
    row.page_access = serialize_page_access(row.page_access, access_version=payload.access_version)
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_access_version_changed",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"access_version": payload.access_version},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/page-access", response_model=UserRead)
def admin_user_page_access(
    user_id: int,
    payload: UserPageAccessUpdateRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.page_access = serialize_page_access(payload.page_access, access_version=row.access_version)
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_page_access_changed",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"page_access": row.page_access},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/tenant", response_model=UserRead)
def admin_user_tenant(
    user_id: int,
    payload: UserTenantUpdateRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    _assert_admin_scope(user, payload.tenant_id)
    tenant = session.get(Tenant, payload.tenant_id)
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    row.tenant_id = payload.tenant_id
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_tenant_changed",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"tenant_id": payload.tenant_id},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/role", response_model=UserRead)
def admin_user_role(
    user_id: int,
    payload: UserRoleUpdateRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    row.role = payload.role
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_role_changed",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"role": payload.role},
    )
    return _user_read(row)


@admin_router.patch("/users/{user_id}/auth-reset", response_model=UserRead)
def admin_user_auth_reset(
    user_id: int,
    payload: UserAuthResetRequest,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserRead:
    row = _get_user_in_scope(session, user, user_id)
    service = AuthService(session)
    if payload.reset_password:
        if not payload.new_password:
            raise HTTPException(status_code=400, detail="new_password is required when reset_password=true")
        row.password_hash = pwd_context.hash(payload.new_password)
    if payload.reset_otp:
        otp_rows = session.exec(select(OTPCode).where(OTPCode.user_id == (row.id or 0))).all()
        for otp in otp_rows:
            session.delete(otp)
    if payload.reset_totp:
        service.admin_reset_totp(actor=user, target=row)
        row = _get_user_in_scope(session, user, user_id)
    row.failed_login_attempts = 0
    row.locked_until = None
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(
        session,
        action="admin.user_auth_reset",
        actor_user_id=user.id,
        target_user_id=row.id,
        tenant_id=row.tenant_id,
        metadata={"reset_password": payload.reset_password, "reset_otp": payload.reset_otp, "reset_totp": payload.reset_totp},
    )
    return _user_read(row)


@admin_router.delete("/users/{user_id}", response_model=AdminUserDeleteResponse)
def admin_user_delete(
    user_id: int,
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> AdminUserDeleteResponse:
    row = _get_user_in_scope(session, user, user_id)
    if row.id == user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if row.role == "super_admin":
        raise HTTPException(status_code=403, detail="Deleting super_admin users is not allowed")
    if row.role == "admin" and user.role != "super_admin":
        raise HTTPException(status_code=403, detail="Only super_admin can delete admin users")

    row_id = row.id or 0
    deleted_tenant_id = row.tenant_id
    deleted_email = row.email

    # Remove/neutralize references to keep integrity and avoid orphan FK violations.
    for linked_user in session.exec(select(AppUser).where(AppUser.approved_by == row_id)).all():
        linked_user.approved_by = None
        linked_user.updated_at = _now()
        session.add(linked_user)
    for log in session.exec(select(AuditLog).where(AuditLog.actor_user_id == row_id)).all():
        log.actor_user_id = None
        session.add(log)
    for log in session.exec(select(AuditLog).where(AuditLog.target_user_id == row_id)).all():
        log.target_user_id = None
        session.add(log)
    for table_model in (AIChatMessage, AIInsight, AIPredictionTicket, AIPredictionUpdate):
        for linked in session.exec(select(table_model).where(table_model.user_id == row_id)).all():
            linked.user_id = None
            session.add(linked)

    for otp in session.exec(select(OTPCode).where(OTPCode.user_id == row_id)).all():
        session.delete(otp)
    for user_session in session.exec(select(UserSession).where(UserSession.user_id == row_id)).all():
        session.delete(user_session)
    for usage in session.exec(select(APIUsageLog).where(APIUsageLog.user_id == row_id)).all():
        session.delete(usage)
    session.delete(row)
    session.commit()

    log_audit(
        session,
        action="admin.user_deleted",
        actor_user_id=user.id,
        target_user_id=None,
        tenant_id=deleted_tenant_id,
        metadata={"deleted_user_id": row_id, "deleted_email": deleted_email},
    )
    return AdminUserDeleteResponse(ok=True, deleted_user_id=row_id)


@admin_router.get("/tenants", response_model=list[TenantRead])
def admin_tenants(user: AppUser = Depends(get_current_user), session: Session = Depends(get_session)) -> list[TenantRead]:
    if user.role == "super_admin":
        rows = session.exec(select(Tenant).order_by(desc(Tenant.created_at))).all()
    else:
        if not user.tenant_id:
            return []
        row = session.get(Tenant, user.tenant_id)
        rows = [row] if row else []
    return [_tenant_read(row) for row in rows]


@admin_router.post("/tenants", response_model=TenantRead, dependencies=[Depends(require_super_admin)])
def admin_tenant_create(payload: TenantCreate, session: Session = Depends(get_session), user: AppUser = Depends(get_current_user)) -> TenantRead:
    slug = payload.slug.strip().lower()
    if session.exec(select(Tenant).where(Tenant.slug == slug)).first():
        raise HTTPException(status_code=400, detail="Tenant slug already exists")
    now = _now()
    row = Tenant(
        name=payload.name.strip(),
        slug=slug,
        status=payload.status.strip() or "active",
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(session, action="admin.tenant_created", actor_user_id=user.id, tenant_id=row.id, metadata={"slug": row.slug})
    return _tenant_read(row)


@admin_router.patch("/tenants/{tenant_id}", response_model=TenantRead, dependencies=[Depends(require_super_admin)])
def admin_tenant_update(
    tenant_id: int,
    payload: TenantUpdate,
    session: Session = Depends(get_session),
    user: AppUser = Depends(get_current_user),
) -> TenantRead:
    row = session.get(Tenant, tenant_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.slug is not None:
        slug = payload.slug.strip().lower()
        duplicate = session.exec(select(Tenant).where(Tenant.slug == slug).where(Tenant.id != tenant_id)).first()
        if duplicate:
            raise HTTPException(status_code=400, detail="Tenant slug already exists")
        row.slug = slug
    if payload.status is not None:
        row.status = payload.status.strip()
    row.updated_at = _now()
    session.add(row)
    session.commit()
    session.refresh(row)
    log_audit(session, action="admin.tenant_updated", actor_user_id=user.id, tenant_id=row.id)
    return _tenant_read(row)


@admin_router.get("/api-usage", response_model=list[APIUsageLogRead])
def admin_api_usage(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    tenant_id: int | None = Query(default=None),
    user_id: int | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[APIUsageLogRead]:
    query = select(APIUsageLog)
    if user.role != "super_admin":
        query = query.where(APIUsageLog.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(APIUsageLog.tenant_id == tenant_id)
    if user_id is not None:
        query = query.where(APIUsageLog.user_id == user_id)
    if date_from is not None:
        query = query.where(APIUsageLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(APIUsageLog.created_at <= date_to)
    rows = session.exec(query.order_by(desc(APIUsageLog.created_at)).limit(limit)).all()
    return [
        APIUsageLogRead(
            id=row.id or 0,
            user_id=row.user_id,
            tenant_id=row.tenant_id,
            provider=row.provider,
            endpoint=row.endpoint,
            usage_units=float(row.usage_units or 0.0),
            cost=float(row.cost or 0.0),
            request_id=row.request_id,
            created_at=row.created_at,
        )
        for row in rows
    ]


@admin_router.get("/api-usage/summary", response_model=list[APIUsageSummaryRow])
def admin_api_usage_summary(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    tenant_id: int | None = Query(default=None),
    user_id: int | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
) -> list[APIUsageSummaryRow]:
    query = select(APIUsageLog)
    if user.role != "super_admin":
        query = query.where(APIUsageLog.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(APIUsageLog.tenant_id == tenant_id)
    if user_id is not None:
        query = query.where(APIUsageLog.user_id == user_id)
    if date_from is not None:
        query = query.where(APIUsageLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(APIUsageLog.created_at <= date_to)
    rows = session.exec(query).all()
    agg: dict[tuple[int | None, int | None], dict[str, float | int | None]] = defaultdict(
        lambda: {"usage_units": 0.0, "cost": 0.0, "calls": 0}
    )
    for row in rows:
        key = (row.user_id, row.tenant_id)
        agg[key]["usage_units"] = float(agg[key]["usage_units"]) + float(row.usage_units or 0.0)
        agg[key]["cost"] = float(agg[key]["cost"]) + float(row.cost or 0.0)
        agg[key]["calls"] = int(agg[key]["calls"]) + 1
    return [
        APIUsageSummaryRow(
            user_id=key[0],
            tenant_id=key[1],
            usage_units=round(float(value["usage_units"]), 3),
            cost=round(float(value["cost"]), 6),
            calls=int(value["calls"]),
        )
        for key, value in sorted(agg.items(), key=lambda item: float(item[1]["cost"]), reverse=True)
    ]


@admin_router.get("/sessions/active", response_model=list[ActiveSessionRead])
def admin_active_sessions(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    tenant_id: int | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=5000),
) -> list[ActiveSessionRead]:
    rows = _active_sessions_in_scope(session, user)
    out: list[ActiveSessionRead] = []
    for session_row, session_user in rows:
        if user.role == "super_admin" and tenant_id is not None and session_user.tenant_id != tenant_id:
            continue
        out.append(
            ActiveSessionRead(
                session_id=session_row.session_id,
                user_id=session_user.id or 0,
                full_name=session_user.full_name,
                email=session_user.email,
                role=session_user.role,  # type: ignore[arg-type]
                access_version=session_user.access_version,  # type: ignore[arg-type]
                page_access=parse_page_access_string(
                    session_user.page_access,
                    access_version=session_user.access_version,
                ),
                tenant_id=session_user.tenant_id,
                ip_address=session_row.ip_address,
                user_agent=session_row.user_agent,
                created_at=session_row.created_at,
                last_seen_at=session_row.last_seen_at,
                expires_at=session_row.expires_at,
            )
        )
        if len(out) >= limit:
            break
    return out


@admin_router.get("/audit-logs", response_model=list[AuditLogRead])
def admin_audit_logs(
    user: AppUser = Depends(get_current_user),
    session: Session = Depends(get_session),
    action: str | None = Query(default=None),
    tenant_id: int | None = Query(default=None),
    actor_user_id: int | None = Query(default=None),
    target_user_id: int | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=600, ge=1, le=5000),
) -> list[AuditLogRead]:
    query = select(AuditLog)
    if user.role != "super_admin":
        query = query.where(AuditLog.tenant_id == user.tenant_id)
    elif tenant_id is not None:
        query = query.where(AuditLog.tenant_id == tenant_id)
    if action:
        query = query.where(AuditLog.action == action)
    if actor_user_id is not None:
        query = query.where(AuditLog.actor_user_id == actor_user_id)
    if target_user_id is not None:
        query = query.where(AuditLog.target_user_id == target_user_id)
    if date_from is not None:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(AuditLog.created_at <= date_to)
    rows = session.exec(query.order_by(desc(AuditLog.created_at)).limit(limit)).all()
    return [
        AuditLogRead(
            id=row.id or 0,
            actor_user_id=row.actor_user_id,
            target_user_id=row.target_user_id,
            tenant_id=row.tenant_id,
            action=row.action,
            metadata_json=row.metadata_json,
            created_at=row.created_at,
        )
        for row in rows
    ]
