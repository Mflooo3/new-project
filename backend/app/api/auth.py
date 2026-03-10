from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Query, status
from jose import JWTError
from sqlmodel import Session, select

from app.config import settings
from app.database import get_session
from app.models import AppUser
from app.services.access_control import parse_page_access_string
from app.services.auth_service import decode_token


def require_api_key(
    x_api_key: str | None = Header(default=None),
    api_key: str | None = Query(default=None),
) -> None:
    if not settings.api_key_enabled:
        return
    expected = settings.app_api_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API key auth is enabled but APP_API_KEY is not configured",
        )
    provided = x_api_key or api_key
    if provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )


def _extract_bearer(authorization: str | None) -> str | None:
    value = (authorization or "").strip()
    if not value.lower().startswith("bearer "):
        return None
    token = value[7:].strip()
    return token or None


def _validate_access_token(token: str) -> dict:
    try:
        payload = decode_token(token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token") from exc
    if payload.get("typ") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    exp_ts = int(payload.get("exp") or 0)
    now_ts = int(datetime.now(timezone.utc).timestamp())
    if exp_ts <= now_ts:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Access token expired")
    return payload


def get_current_user(
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
    access_token: str | None = Query(default=None),
    x_api_key: str | None = Header(default=None),
    api_key: str | None = Query(default=None),
) -> AppUser:
    if settings.auth_required:
        token = _extract_bearer(authorization) or (access_token or "").strip() or None
        if not token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        payload = _validate_access_token(token)
        user_id = int(payload.get("sub") or 0)
        user = session.get(AppUser, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        if user.status != "approved":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is not approved")
        if user.role != "super_admin" and not user.tenant_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant assignment required")
        return user

    # Optional backward compatibility mode when auth_required is disabled.
    if settings.api_key_enabled:
        expected = settings.app_api_key
        provided = x_api_key or api_key
        if not expected or provided != expected:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    legacy = session.exec(select(AppUser).where(AppUser.status == "approved").limit(1)).first()
    if legacy is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No approved users found")
    return legacy


def get_optional_current_user(
    session: Session = Depends(get_session),
    authorization: str | None = Header(default=None),
    access_token: str | None = Query(default=None),
) -> AppUser | None:
    token = _extract_bearer(authorization) or (access_token or "").strip() or None
    if not token:
        return None
    try:
        payload = _validate_access_token(token)
    except HTTPException:
        return None
    user_id = int(payload.get("sub") or 0)
    user = session.get(AppUser, user_id)
    if user is None or user.status != "approved":
        return None
    return user


CurrentUser = Annotated[AppUser, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> AppUser:
    if user.role not in {"admin", "super_admin"}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_super_admin(user: CurrentUser) -> AppUser:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return user


def enforce_version(user: AppUser, required_version: str) -> None:
    if user.role == "super_admin":
        return
    required = (required_version or "v1").strip().lower()
    current = (user.access_version or "v1").strip().lower()
    version_rank = {"v1": 1, "v2": 2}
    required_rank = version_rank.get(required, 1)
    current_rank = version_rank.get(current, 1)
    if current_rank < required_rank:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: this feature requires {required.upper()} access. Ask your admin to upgrade your account.",
        )


def enforce_page_access(user: AppUser, page_key: str) -> None:
    if user.role == "super_admin":
        return
    required = str(page_key or "").strip().lower()
    allowed = set(parse_page_access_string(getattr(user, "page_access", ""), access_version=user.access_version))
    if required and required not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: you do not have permission for page '{required}'. Ask admin to grant access.",
        )
