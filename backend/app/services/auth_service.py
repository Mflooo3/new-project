from __future__ import annotations

import base64
import hashlib
import io
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import pyotp
import qrcode
from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlmodel import Session, desc, select

from app.config import settings
from app.models import (
    APIUsageLog,
    AIPredictionTicket,
    AIPredictionUpdate,
    AIChatMessage,
    AIInsight,
    Alert,
    AppUser,
    AuditLog,
    Event,
    OTPCode,
    Source,
    Tenant,
    UserSession,
)
from app.services.access_control import PAGE_KEYS, parse_page_access_string, serialize_page_access
from app.services.bootstrap import seed_default_sources
from app.services.email_sender import send_otp_email, send_password_reset_email
from app.schemas import (
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
    TOTPDisableRequest,
    TOTPDisableResponse,
    TOTPSetupStartResponse,
    TOTPStatusRead,
    UserRegisterRequest,
    UserRegisterResponse,
)


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
logger = logging.getLogger(__name__)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        # Stored naive timestamps are treated as UTC in this app.
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_email(value: str) -> str:
    return str(value or "").strip().lower()


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return text or "workspace"


def _next_unique_tenant_slug(session: Session, base_slug: str) -> str:
    seed = _slugify(base_slug)
    candidate = seed
    index = 2
    while session.exec(select(Tenant).where(Tenant.slug == candidate)).first() is not None:
        candidate = f"{seed}-{index}"
        index += 1
    return candidate


def provision_tenant_for_user(
    session: Session,
    *,
    full_name: str,
    email: str,
) -> Tenant:
    local_part = normalize_email(email).split("@")[0] if "@" in normalize_email(email) else normalize_email(email)
    base_slug = _slugify(local_part or full_name or "workspace")
    slug = _next_unique_tenant_slug(session, base_slug)
    name_root = str(full_name or "").strip() or local_part or slug
    now = utcnow()
    tenant = Tenant(
        name=f"Workspace - {name_root}",
        slug=slug,
        status="active",
        created_at=now,
        updated_at=now,
    )
    session.add(tenant)
    session.commit()
    session.refresh(tenant)
    # Ensure every newly provisioned tenant has baseline source configuration
    # so user-facing V1/V2 workflows can operate without manual source setup.
    seed_default_sources(session, tenant_id=tenant.id)
    return tenant


def hash_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _totp_cipher() -> Fernet:
    # Derive a stable encryption key from JWT secret for storing TOTP secrets at rest.
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.auth_jwt_secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_totp_secret(secret: str) -> str:
    return _totp_cipher().encrypt(secret.encode("utf-8")).decode("utf-8")


def decrypt_totp_secret(encrypted_secret: str | None) -> str | None:
    if not encrypted_secret:
        return None
    try:
        return _totp_cipher().decrypt(encrypted_secret.encode("utf-8")).decode("utf-8")
    except (InvalidToken, UnicodeDecodeError):
        return None


def normalize_totp_code(value: str | None) -> str:
    raw = str(value or "")
    return "".join(ch for ch in raw if ch.isdigit())


def build_totp_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(
        secret,
        digits=max(6, int(settings.totp_digits or 6)),
        interval=max(15, int(settings.totp_step_seconds or 30)),
        digest=hashlib.sha1,
    )
    return totp.provisioning_uri(name=email, issuer_name=settings.effective_totp_issuer_name)


def render_qr_data_url(content: str) -> str:
    qr = qrcode.QRCode(version=1, box_size=8, border=2)
    qr.add_data(content)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _mask_secret(secret: str) -> str:
    trimmed = str(secret or "").strip()
    if len(trimmed) <= 8:
        return "*" * max(1, len(trimmed))
    return f"{trimmed[:4]}...{trimmed[-4:]}"


def _safe_json(value: dict[str, Any] | None) -> str | None:
    if not value:
        return None
    try:
        return json.dumps(value, ensure_ascii=False)[:6000]
    except Exception:
        return None


def to_auth_user(user: AppUser) -> AuthUserRead:
    return AuthUserRead(
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
        last_login_at=user.last_login_at,
        last_active_at=user.last_active_at,
        login_count=int(user.login_count or 0),
        created_at=user.created_at,
    )


def ensure_platform_bootstrap(session: Session) -> tuple[Tenant, AppUser]:
    slug = settings.default_tenant_slug.strip().lower()
    tenant = session.exec(select(Tenant).where(Tenant.slug == slug)).first()
    now = utcnow()
    if tenant is None:
        tenant = Tenant(
            name=settings.default_tenant_name.strip() or "Default Workspace",
            slug=slug or "default-workspace",
            status="active",
            created_at=now,
            updated_at=now,
        )
        session.add(tenant)
        session.commit()
        session.refresh(tenant)

    admin_email = normalize_email(settings.super_admin_email)
    admin = session.exec(select(AppUser).where(AppUser.email == admin_email)).first()
    if admin is None:
        admin = AppUser(
            full_name=settings.super_admin_name.strip() or "Platform Super Admin",
            email=admin_email,
            password_hash=pwd_context.hash(settings.super_admin_password),
            status="approved",
            role="super_admin",
            access_version="v2",
            page_access=serialize_page_access(["v1", "v2", "xintel"], access_version="v2"),
            tenant_id=None,
            auth_method="hybrid",
            approved_at=now,
            created_at=now,
            updated_at=now,
        )
        session.add(admin)
        session.commit()
        session.refresh(admin)
    else:
        expected_pages = serialize_page_access(admin.page_access, access_version=admin.access_version)
        if admin.page_access != expected_pages:
            admin.page_access = expected_pages
            admin.updated_at = now
            session.add(admin)
            session.commit()
    return tenant, admin


def backfill_legacy_tenant_scope(session: Session, *, tenant_id: int) -> dict[str, int]:
    models = [
        Source,
        Event,
        Alert,
        AIChatMessage,
        AIInsight,
        AIPredictionTicket,
        AIPredictionUpdate,
    ]
    updates: dict[str, int] = {}
    changed = False
    for model in models:
        rows = session.exec(select(model).where(model.tenant_id.is_(None))).all()
        if not rows:
            continue
        updates[model.__name__] = len(rows)
        for row in rows:
            row.tenant_id = tenant_id
            session.add(row)
        changed = True

    user_rows = session.exec(
        select(AppUser)
        .where(AppUser.role != "super_admin")
        .where(AppUser.status == "approved")
        .where(AppUser.tenant_id.is_(None))
    ).all()
    if user_rows:
        updates["AppUser"] = len(user_rows)
        for row in user_rows:
            row.tenant_id = tenant_id
            row.updated_at = utcnow()
            session.add(row)
        changed = True

    if changed:
        session.commit()
    return updates


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.auth_jwt_secret, algorithms=[settings.auth_jwt_alg])


def log_audit(
    session: Session,
    *,
    action: str,
    actor_user_id: int | None = None,
    target_user_id: int | None = None,
    tenant_id: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    row = AuditLog(
        actor_user_id=actor_user_id,
        target_user_id=target_user_id,
        tenant_id=tenant_id,
        action=action[:160],
        metadata_json=_safe_json(metadata),
    )
    session.add(row)
    session.commit()


class AuthService:
    def __init__(self, session: Session) -> None:
        self.session = session

    def _autoprovision_tenant_for_user(self, user: AppUser) -> bool:
        if user.role == "super_admin" or user.tenant_id:
            return False
        tenant = provision_tenant_for_user(
            self.session,
            full_name=user.full_name,
            email=user.email,
        )
        user.tenant_id = tenant.id
        user.updated_at = utcnow()
        self.session.add(user)
        self.session.commit()
        log_audit(
            self.session,
            action="auth.tenant_autoprovisioned",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"tenant_slug": tenant.slug},
        )
        return True

    def register(self, payload: UserRegisterRequest) -> UserRegisterResponse:
        email = normalize_email(payload.email)
        existing = self.session.exec(select(AppUser).where(AppUser.email == email)).first()
        if existing is not None:
            if existing.role != "super_admin" and not existing.tenant_id:
                self._autoprovision_tenant_for_user(existing)
            return UserRegisterResponse(
                user_id=existing.id or 0,
                status=existing.status,  # type: ignore[arg-type]
                message="Registration already exists and is under review.",
            )

        if settings.auth_password_enabled and (payload.password or "").strip() == "":
            raise ValueError("Password is required for registration.")

        tenant = provision_tenant_for_user(
            self.session,
            full_name=payload.full_name.strip(),
            email=email,
        )
        now = utcnow()
        user = AppUser(
            full_name=payload.full_name.strip(),
            email=email,
            password_hash=pwd_context.hash(payload.password) if payload.password else None,
            status="pending",
            role="user",
            access_version="v1",
            page_access=serialize_page_access(["v1"], access_version="v1"),
            tenant_id=tenant.id,
            auth_method="hybrid" if settings.auth_email_otp_enabled and settings.auth_password_enabled else (
                "email_otp" if settings.auth_email_otp_enabled else "password"
            ),
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        log_audit(
            self.session,
            action="user.registered",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"email": user.email},
        )
        return UserRegisterResponse(
            user_id=user.id or 0,
            status="pending",
            message="Your registration is under review.",
        )

    def _ensure_user_can_login(self, user: AppUser) -> None:
        now = utcnow()
        locked_until = _as_utc(user.locked_until)
        if locked_until and locked_until > now:
            raise ValueError("Account is temporarily locked due to repeated failed attempts.")
        if user.status != "approved":
            raise ValueError("Login is blocked until admin approval.")
        if user.role != "super_admin" and not user.tenant_id:
            self._autoprovision_tenant_for_user(user)
        if user.role != "super_admin" and not user.tenant_id:
            raise ValueError("User is missing tenant assignment.")
        raw_page_access = str(getattr(user, "page_access", "") or "").strip()
        if not raw_page_access:
            raise ValueError("User has no page access grants. Ask admin to assign page access.")
        raw_tokens = [part.strip().lower() for part in raw_page_access.replace(";", ",").replace("|", ",").split(",") if part.strip()]
        if not any(token in PAGE_KEYS for token in raw_tokens):
            raise ValueError("User has no page access grants. Ask admin to assign page access.")
        if not parse_page_access_string(raw_page_access, access_version=user.access_version):
            raise ValueError("User has no page access grants. Ask admin to assign page access.")

    def _register_failed_attempt(self, user: AppUser) -> None:
        now = utcnow()
        user.failed_login_attempts = int(user.failed_login_attempts or 0) + 1
        if user.failed_login_attempts >= max(1, settings.auth_max_failed_attempts):
            user.locked_until = now + timedelta(minutes=max(1, settings.auth_lock_minutes))
            user.failed_login_attempts = 0
        user.updated_at = now
        self.session.add(user)
        self.session.commit()

    def _register_failed_totp_attempt(self, user: AppUser) -> None:
        now = utcnow()
        user.totp_failed_attempts = int(user.totp_failed_attempts or 0) + 1
        if user.totp_failed_attempts >= max(1, int(settings.totp_max_failed_attempts or 5)):
            user.totp_locked_until = now + timedelta(seconds=max(10, int(settings.totp_lock_seconds or 60)))
            user.totp_failed_attempts = 0
        user.updated_at = now
        self.session.add(user)
        self.session.commit()

    def _reset_totp_attempts(self, user: AppUser) -> None:
        user.totp_failed_attempts = 0
        user.totp_locked_until = None
        user.updated_at = utcnow()
        self.session.add(user)
        self.session.commit()

    def _verify_totp_for_user(self, user: AppUser, code: str) -> bool:
        if not bool(user.totp_enabled):
            return False
        now = utcnow()
        locked_until = _as_utc(user.totp_locked_until)
        if locked_until and locked_until > now:
            raise ValueError("Authenticator verification is temporarily locked. Try again shortly.")
        secret = decrypt_totp_secret(user.totp_secret)
        if not secret:
            raise ValueError("Authenticator setup is invalid. Ask admin to reset TOTP.")
        normalized = normalize_totp_code(code)
        expected_digits = max(6, int(settings.totp_digits or 6))
        if len(normalized) != expected_digits:
            self._register_failed_totp_attempt(user)
            log_audit(
                self.session,
                action="auth.totp_failed",
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={"reason": "invalid_format"},
            )
            raise ValueError("Invalid authenticator code.")
        totp = pyotp.TOTP(
            secret,
            digits=expected_digits,
            interval=max(15, int(settings.totp_step_seconds or 30)),
            digest=hashlib.sha1,
        )
        valid = totp.verify(normalized, valid_window=1, for_time=now)
        if not valid:
            self._register_failed_totp_attempt(user)
            log_audit(
                self.session,
                action="auth.totp_failed",
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={"reason": "invalid_code"},
            )
            raise ValueError("Invalid authenticator code.")
        user.totp_last_used = now
        self._reset_totp_attempts(user)
        return True

    def _register_successful_login(self, user: AppUser) -> None:
        now = utcnow()
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        user.last_active_at = now
        user.login_count = int(user.login_count or 0) + 1
        user.updated_at = now
        self.session.add(user)
        self.session.commit()

    def _issue_tokens(
        self,
        *,
        user: AppUser,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuthTokenResponse:
        now = utcnow()
        access_exp = now + timedelta(minutes=max(5, settings.auth_access_token_minutes))
        refresh_exp = now + timedelta(days=max(1, settings.auth_refresh_token_days))
        session_id = secrets.token_urlsafe(24)
        refresh_raw = secrets.token_urlsafe(64)

        access_payload = {
            "sub": str(user.id),
            "typ": "access",
            "role": user.role,
            "tenant_id": user.tenant_id,
            "access_version": user.access_version,
            "page_access": parse_page_access_string(user.page_access, access_version=user.access_version),
            "status": user.status,
            "sid": session_id,
            "exp": int(access_exp.timestamp()),
            "iat": int(now.timestamp()),
        }
        refresh_payload = {
            "sub": str(user.id),
            "typ": "refresh",
            "sid": session_id,
            "rt": hash_text(refresh_raw),
            "exp": int(refresh_exp.timestamp()),
            "iat": int(now.timestamp()),
        }
        access_token = jwt.encode(access_payload, settings.auth_jwt_secret, algorithm=settings.auth_jwt_alg)
        refresh_token = jwt.encode(refresh_payload, settings.auth_jwt_secret, algorithm=settings.auth_jwt_alg)

        db_session = UserSession(
            user_id=user.id or 0,
            session_id=session_id,
            session_token_hash=hash_text(refresh_token),
            ip_address=(ip_address or "")[:100] or None,
            user_agent=(user_agent or "")[:500] or None,
            last_seen_at=now,
            expires_at=refresh_exp,
            created_at=now,
        )
        self.session.add(db_session)
        self.session.commit()

        return AuthTokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=int((access_exp - now).total_seconds()),
            user=to_auth_user(user),
        )

    def login_password(
        self,
        payload: LoginRequest,
        *,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuthTokenResponse:
        if not settings.auth_password_enabled:
            raise ValueError("Password authentication is disabled.")

        email = normalize_email(payload.email)
        user = self.session.exec(select(AppUser).where(AppUser.email == email)).first()
        if user is None:
            raise ValueError("Invalid credentials.")
        self._ensure_user_can_login(user)
        if not user.password_hash:
            raise ValueError("Password login is not configured for this account.")
        if not payload.password or not pwd_context.verify(payload.password, user.password_hash):
            self._register_failed_attempt(user)
            log_audit(
                self.session,
                action="auth.login_failed",
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={"email": user.email, "reason": "invalid_password"},
            )
            raise ValueError("Invalid credentials.")

        if bool(user.totp_enabled):
            if not payload.totp_code:
                raise ValueError("Authenticator code required.")
            self._verify_totp_for_user(user, payload.totp_code)

        self._register_successful_login(user)
        log_audit(
            self.session,
            action="auth.login_success",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"method": "password+totp" if bool(user.totp_enabled) else "password"},
        )
        return self._issue_tokens(user=user, ip_address=ip_address, user_agent=user_agent)

    def _build_password_reset_link(self, *, token: str, email: str) -> str:
        template = settings.effective_password_reset_url_template
        try:
            return template.format(token=token, email=email)
        except Exception:
            # Fail safe to token-only template if formatting placeholders are malformed.
            return "http://localhost:5174/?auth=reset&token={token}".format(token=token)

    def request_password_reset(self, payload: PasswordResetRequest) -> PasswordResetRequestResponse:
        if not settings.auth_password_enabled:
            raise ValueError("Password login is disabled for this environment.")
        email = normalize_email(payload.email)
        generic = PasswordResetRequestResponse(
            ok=True,
            message="If this account exists and is eligible, a password reset email has been sent.",
        )
        user = self.session.exec(select(AppUser).where(AppUser.email == email)).first()
        if user is None:
            logger.info("Password reset requested for non-existing account.")
            return generic

        now = utcnow()
        expires_minutes = settings.effective_password_reset_token_minutes
        token = secrets.token_urlsafe(48)
        purpose = "password_reset"

        stale_rows = self.session.exec(
            select(OTPCode)
            .where(OTPCode.user_id == (user.id or 0))
            .where(OTPCode.purpose == purpose)
            .where(OTPCode.used_at.is_(None))
        ).all()
        for stale in stale_rows:
            stale.used_at = now
            self.session.add(stale)
        if stale_rows:
            self.session.commit()

        row = OTPCode(
            user_id=user.id or 0,
            code_hash=hash_text(token),
            purpose=purpose,
            expires_at=now + timedelta(minutes=expires_minutes),
            created_at=now,
        )
        self.session.add(row)
        self.session.commit()
        reset_link = self._build_password_reset_link(token=token, email=user.email)

        log_audit(
            self.session,
            action="auth.password_reset_email_send_attempted",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"provider": (settings.email_provider or "console").strip().lower()},
        )
        try:
            result = send_password_reset_email(
                recipient=user.email,
                reset_link=reset_link,
                expires_minutes=expires_minutes,
            )
            log_audit(
                self.session,
                action="auth.password_reset_email_sent",
                actor_user_id=user.id,
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata=result.as_metadata(),
            )
        except Exception as exc:
            row.used_at = now
            self.session.add(row)
            self.session.commit()
            log_audit(
                self.session,
                action="auth.password_reset_email_send_failed",
                actor_user_id=user.id,
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={
                    "provider": (settings.email_provider or "console").strip().lower(),
                    "error": str(exc)[:220],
                },
            )
            raise ValueError(f"Password reset email delivery failed: {exc}") from exc
        return generic

    def confirm_password_reset(self, payload: PasswordResetConfirmRequest) -> PasswordResetConfirmResponse:
        if not settings.auth_password_enabled:
            raise ValueError("Password login is disabled for this environment.")
        now = utcnow()
        token_hash = hash_text(str(payload.token or "").strip())
        row = self.session.exec(
            select(OTPCode)
            .where(OTPCode.purpose == "password_reset")
            .where(OTPCode.code_hash == token_hash)
            .where(OTPCode.used_at.is_(None))
            .order_by(desc(OTPCode.created_at))
            .limit(1)
        ).first()
        expires_at = _as_utc(row.expires_at) if row else None
        if row is None or expires_at is None or expires_at < now:
            raise ValueError("Reset token is invalid or expired.")

        user = self.session.get(AppUser, row.user_id)
        if user is None:
            row.used_at = now
            self.session.add(row)
            self.session.commit()
            raise ValueError("Reset token is invalid or expired.")

        user.password_hash = pwd_context.hash(payload.new_password)
        user.failed_login_attempts = 0
        user.locked_until = None
        user.updated_at = now
        self.session.add(user)

        row.used_at = now
        self.session.add(row)
        siblings = self.session.exec(
            select(OTPCode)
            .where(OTPCode.user_id == (user.id or 0))
            .where(OTPCode.purpose == "password_reset")
            .where(OTPCode.used_at.is_(None))
            .where(OTPCode.id != row.id)
        ).all()
        for sibling in siblings:
            sibling.used_at = now
            self.session.add(sibling)

        active_sessions = self.session.exec(
            select(UserSession)
            .where(UserSession.user_id == (user.id or 0))
            .where(UserSession.revoked_at.is_(None))
        ).all()
        for user_session in active_sessions:
            user_session.revoked_at = now
            self.session.add(user_session)
        self.session.commit()

        log_audit(
            self.session,
            action="auth.password_reset_completed",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"sessions_revoked": len(active_sessions)},
        )
        return PasswordResetConfirmResponse(ok=True, message="Password has been reset successfully.")

    def request_otp(self, payload: OTPRequest) -> OTPRequestResponse:
        if not settings.auth_email_otp_enabled:
            raise ValueError("Email OTP authentication is disabled.")
        otp_minutes = max(1, int(getattr(settings, "effective_auth_otp_minutes", settings.auth_otp_minutes)))
        resend_cooldown = max(0, int(settings.otp_resend_cooldown_seconds or 0))
        email = normalize_email(payload.email)
        user = self.session.exec(select(AppUser).where(AppUser.email == email)).first()
        if user is None:
            return OTPRequestResponse(
                ok=True,
                message="If your account is approved, OTP was issued.",
                expires_in_seconds=max(60, otp_minutes * 60),
            )
        self._ensure_user_can_login(user)
        now = utcnow()
        purpose = (payload.purpose or "login")[:40]
        if resend_cooldown > 0:
            latest = self.session.exec(
                select(OTPCode)
                .where(OTPCode.user_id == (user.id or 0))
                .where(OTPCode.purpose == purpose)
                .where(OTPCode.used_at.is_(None))
                .order_by(desc(OTPCode.created_at))
                .limit(1)
            ).first()
            if latest is not None:
                latest_created_at = _as_utc(latest.created_at)
                latest_expires_at = _as_utc(latest.expires_at)
                if latest_created_at and latest_expires_at and latest_expires_at > now:
                    elapsed = (now - latest_created_at).total_seconds()
                    if elapsed < resend_cooldown:
                        wait_seconds = max(1, int(resend_cooldown - elapsed))
                        raise ValueError(f"Please wait {wait_seconds} seconds before requesting another OTP.")

        existing_rows = self.session.exec(
            select(OTPCode)
            .where(OTPCode.user_id == (user.id or 0))
            .where(OTPCode.purpose == purpose)
            .where(OTPCode.used_at.is_(None))
        ).all()
        for row in existing_rows:
            row.used_at = now
            self.session.add(row)
        if existing_rows:
            self.session.commit()

        code = f"{secrets.randbelow(10**6):06d}"
        otp = OTPCode(
            user_id=user.id or 0,
            code_hash=hash_text(code),
            purpose=purpose,
            expires_at=now + timedelta(minutes=otp_minutes),
            created_at=now,
        )
        self.session.add(otp)
        self.session.commit()
        log_audit(
            self.session,
            action="auth.otp_email_send_attempted",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={
                "purpose": otp.purpose,
                "provider": (settings.email_provider or "console").strip().lower(),
            },
        )
        try:
            result = send_otp_email(
                recipient=user.email,
                code=code,
                expires_minutes=otp_minutes,
            )
        except Exception as exc:
            self.session.delete(otp)
            self.session.commit()
            log_audit(
                self.session,
                action="auth.otp_email_send_failed",
                actor_user_id=user.id,
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={
                    "purpose": purpose,
                    "provider": (settings.email_provider or "console").strip().lower(),
                    "error": str(exc)[:220],
                },
            )
            raise ValueError(f"OTP delivery failed: {exc}") from exc
        log_audit(
            self.session,
            action="auth.otp_email_sent",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"purpose": otp.purpose, **result.as_metadata()},
        )
        log_audit(
            self.session,
            action="auth.otp_requested",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"purpose": otp.purpose},
        )
        return OTPRequestResponse(
            ok=True,
            message="OTP was issued.",
            expires_in_seconds=max(60, otp_minutes * 60),
            dev_code=code if settings.environment != "production" else None,
        )

    def totp_status(self, user: AppUser) -> TOTPStatusRead:
        return TOTPStatusRead(
            enabled=bool(user.totp_enabled),
            enabled_at=user.totp_enabled_at,
            last_used=user.totp_last_used,
            pending_setup=bool(user.totp_pending_secret),
        )

    def start_totp_setup(self, *, user: AppUser, password: str) -> TOTPSetupStartResponse:
        if not user.password_hash:
            raise ValueError("Password login is not configured for this account.")
        if not pwd_context.verify(password, user.password_hash):
            self._register_failed_attempt(user)
            raise ValueError("Invalid password.")
        secret = pyotp.random_base32()
        encrypted_secret = encrypt_totp_secret(secret)
        now = utcnow()
        user.totp_pending_secret = encrypted_secret
        user.updated_at = now
        self.session.add(user)
        self.session.commit()
        uri = build_totp_uri(secret, user.email)
        qr_data_url = render_qr_data_url(uri)
        log_audit(
            self.session,
            action="auth.totp_setup_started",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"issuer": settings.effective_totp_issuer_name},
        )
        return TOTPSetupStartResponse(
            manual_entry_key=secret,
            secret_masked=_mask_secret(secret),
            otpauth_uri=uri,
            qr_code_data_url=qr_data_url,
        )

    def verify_totp_setup(self, *, user: AppUser, code: str) -> TOTPStatusRead:
        pending_secret = decrypt_totp_secret(user.totp_pending_secret)
        if not pending_secret:
            raise ValueError("No pending TOTP setup. Start setup first.")
        normalized = normalize_totp_code(code)
        expected_digits = max(6, int(settings.totp_digits or 6))
        if len(normalized) != expected_digits:
            raise ValueError("Invalid authenticator code.")
        totp = pyotp.TOTP(
            pending_secret,
            digits=expected_digits,
            interval=max(15, int(settings.totp_step_seconds or 30)),
            digest=hashlib.sha1,
        )
        now = utcnow()
        if not totp.verify(normalized, valid_window=1, for_time=now):
            raise ValueError("Invalid authenticator code.")
        user.totp_secret = user.totp_pending_secret
        user.totp_pending_secret = None
        user.totp_enabled = True
        user.totp_enabled_at = now
        user.totp_last_used = now
        user.totp_failed_attempts = 0
        user.totp_locked_until = None
        user.updated_at = now
        self.session.add(user)
        self.session.commit()
        log_audit(
            self.session,
            action="auth.totp_enabled",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
        )
        return self.totp_status(user)

    def disable_totp(self, *, user: AppUser, payload: TOTPDisableRequest) -> TOTPDisableResponse:
        if not user.password_hash:
            raise ValueError("Password login is not configured for this account.")
        if not pwd_context.verify(payload.password, user.password_hash):
            self._register_failed_attempt(user)
            raise ValueError("Invalid password.")
        if bool(user.totp_enabled):
            if not payload.code:
                raise ValueError("Current authenticator code is required.")
            self._verify_totp_for_user(user, payload.code)
        now = utcnow()
        user.totp_enabled = False
        user.totp_secret = None
        user.totp_pending_secret = None
        user.totp_enabled_at = None
        user.totp_last_used = None
        user.totp_failed_attempts = 0
        user.totp_locked_until = None
        user.updated_at = now
        self.session.add(user)
        self.session.commit()
        log_audit(
            self.session,
            action="auth.totp_disabled",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
        )
        return TOTPDisableResponse(ok=True)

    def admin_reset_totp(self, *, actor: AppUser, target: AppUser) -> None:
        now = utcnow()
        target.totp_enabled = False
        target.totp_secret = None
        target.totp_pending_secret = None
        target.totp_enabled_at = None
        target.totp_last_used = None
        target.totp_failed_attempts = 0
        target.totp_locked_until = None
        target.updated_at = now
        self.session.add(target)
        self.session.commit()
        log_audit(
            self.session,
            action="admin.user_totp_reset",
            actor_user_id=actor.id,
            target_user_id=target.id,
            tenant_id=target.tenant_id,
        )

    def verify_otp(
        self,
        payload: OTPVerifyRequest,
        *,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> AuthTokenResponse:
        email = normalize_email(payload.email)
        user = self.session.exec(select(AppUser).where(AppUser.email == email)).first()
        if user is None:
            raise ValueError("Invalid OTP.")
        self._ensure_user_can_login(user)
        if bool(user.totp_enabled) and (payload.purpose or "login")[:40] == "login":
            log_audit(
                self.session,
                action="auth.otp_blocked_totp_enabled",
                target_user_id=user.id,
                tenant_id=user.tenant_id,
            )
            raise ValueError("Authenticator-enabled accounts must sign in with password and authenticator code.")
        now = utcnow()
        row = self.session.exec(
            select(OTPCode)
            .where(OTPCode.user_id == (user.id or 0))
            .where(OTPCode.purpose == (payload.purpose or "login")[:40])
            .where(OTPCode.used_at.is_(None))
            .order_by(desc(OTPCode.created_at))
            .limit(1)
        ).first()
        otp_expires_at = _as_utc(row.expires_at) if row else None
        if row is None or otp_expires_at is None or otp_expires_at < now:
            raise ValueError("OTP expired or not found.")
        if hash_text(payload.code) != row.code_hash:
            self._register_failed_attempt(user)
            log_audit(
                self.session,
                action="auth.otp_failed",
                target_user_id=user.id,
                tenant_id=user.tenant_id,
                metadata={"email": user.email, "reason": "invalid_otp"},
            )
            raise ValueError("Invalid OTP.")
        row.used_at = now
        self.session.add(row)
        siblings = self.session.exec(
            select(OTPCode)
            .where(OTPCode.user_id == (user.id or 0))
            .where(OTPCode.purpose == row.purpose)
            .where(OTPCode.used_at.is_(None))
            .where(OTPCode.id != row.id)
        ).all()
        for sibling in siblings:
            sibling.used_at = now
            self.session.add(sibling)
        self.session.commit()
        self._register_successful_login(user)
        log_audit(
            self.session,
            action="auth.login_success",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"method": "email_otp"},
        )
        return self._issue_tokens(user=user, ip_address=ip_address, user_agent=user_agent)

    def refresh(self, refresh_token: str, *, ip_address: str | None = None, user_agent: str | None = None) -> AuthTokenResponse:
        try:
            payload = decode_token(refresh_token)
        except JWTError as exc:
            raise ValueError("Invalid refresh token.") from exc
        if payload.get("typ") != "refresh":
            raise ValueError("Invalid refresh token.")
        user_id = int(payload.get("sub") or 0)
        user = self.session.get(AppUser, user_id)
        if user is None or user.status != "approved":
            raise ValueError("User is not allowed.")

        session_hash = hash_text(refresh_token)
        session_row = self.session.exec(
            select(UserSession)
            .where(UserSession.user_id == user_id)
            .where(UserSession.session_token_hash == session_hash)
            .where(UserSession.revoked_at.is_(None))
            .order_by(desc(UserSession.created_at))
            .limit(1)
        ).first()
        session_expires_at = _as_utc(session_row.expires_at) if session_row else None
        if session_row is None or session_expires_at is None or session_expires_at < utcnow():
            raise ValueError("Refresh session expired.")
        session_row.revoked_at = utcnow()
        self.session.add(session_row)
        self.session.commit()
        return self._issue_tokens(user=user, ip_address=ip_address, user_agent=user_agent)

    def logout(self, *, user: AppUser, refresh_token: str | None = None) -> None:
        query = select(UserSession).where(UserSession.user_id == (user.id or 0)).where(UserSession.revoked_at.is_(None))
        if refresh_token:
            query = query.where(UserSession.session_token_hash == hash_text(refresh_token))
        rows = self.session.exec(query).all()
        now = utcnow()
        for row in rows:
            row.revoked_at = now
            self.session.add(row)
        if rows:
            self.session.commit()
        log_audit(
            self.session,
            action="auth.logout",
            actor_user_id=user.id,
            target_user_id=user.id,
            tenant_id=user.tenant_id,
            metadata={"sessions_revoked": len(rows)},
        )

    def touch_user(self, user: AppUser) -> None:
        now = utcnow()
        user.last_active_at = now
        user.updated_at = now
        self.session.add(user)
        self.session.commit()

    def track_api_usage(
        self,
        *,
        user: AppUser | None,
        endpoint: str,
        provider: str = "internal",
        usage_units: float = 1.0,
        cost: float | None = None,
        request_id: str | None = None,
    ) -> None:
        if user is None:
            return
        row = APIUsageLog(
            user_id=user.id,
            tenant_id=user.tenant_id,
            provider=(provider or "internal")[:120],
            endpoint=(endpoint or "")[:240],
            usage_units=float(usage_units or 0.0),
            cost=float(settings.default_api_usage_unit_cost if cost is None else cost),
            request_id=(request_id or "")[:120] or None,
        )
        self.session.add(row)
        self.session.commit()
