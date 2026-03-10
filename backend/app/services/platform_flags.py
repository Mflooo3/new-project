from __future__ import annotations

from datetime import datetime, timezone

from sqlmodel import Session, select

from app.config import settings
from app.models import PlatformSetting

OPENAI_ENABLED_KEY = "openai_enabled"
X_API_ENABLED_KEY = "x_api_enabled"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _default_openai_enabled() -> bool:
    return bool(settings.openai_api_key and not settings.ai_privacy_mode)


def _default_x_api_enabled() -> bool:
    return bool((settings.x_api_bearer_token or settings.x_api_key or "").strip())


def _get_bool_setting(session: Session, key: str, default_value: bool) -> tuple[bool, datetime | None]:
    row = session.exec(select(PlatformSetting).where(PlatformSetting.key == key)).first()
    if row is None:
        return bool(default_value), None
    return bool(row.value_bool), row.updated_at


def get_platform_flags(session: Session) -> dict[str, bool | datetime | None]:
    openai_enabled, openai_updated = _get_bool_setting(session, OPENAI_ENABLED_KEY, _default_openai_enabled())
    x_api_enabled, x_updated = _get_bool_setting(session, X_API_ENABLED_KEY, _default_x_api_enabled())
    updated_candidates = [value for value in (openai_updated, x_updated) if value is not None]
    return {
        "openai_enabled": openai_enabled,
        "x_api_enabled": x_api_enabled,
        "updated_at": max(updated_candidates) if updated_candidates else None,
    }


def set_platform_flags(
    session: Session,
    *,
    openai_enabled: bool | None = None,
    x_api_enabled: bool | None = None,
    actor_user_id: int | None = None,
) -> dict[str, bool | datetime | None]:
    now = _now()

    def _upsert(key: str, value: bool) -> None:
        row = session.exec(select(PlatformSetting).where(PlatformSetting.key == key)).first()
        if row is None:
            row = PlatformSetting(
                key=key,
                value_bool=bool(value),
                updated_at=now,
                updated_by=actor_user_id,
            )
        else:
            row.value_bool = bool(value)
            row.updated_at = now
            row.updated_by = actor_user_id
        session.add(row)

    changed = False
    if openai_enabled is not None:
        _upsert(OPENAI_ENABLED_KEY, bool(openai_enabled))
        changed = True
    if x_api_enabled is not None:
        _upsert(X_API_ENABLED_KEY, bool(x_api_enabled))
        changed = True
    if changed:
        session.commit()
    return get_platform_flags(session)


def is_openai_runtime_enabled(session: Session) -> bool:
    return bool(get_platform_flags(session).get("openai_enabled"))


def is_x_runtime_enabled(session: Session) -> bool:
    return bool(get_platform_flags(session).get("x_api_enabled"))
