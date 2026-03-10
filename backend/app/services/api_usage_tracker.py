from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session

from app.config import settings
from app.models import APIUsageLog


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _extract_usage_value(usage: Any, *keys: str) -> float:
    if usage is None:
        return 0.0
    for key in keys:
        if hasattr(usage, key):
            value = getattr(usage, key)
            numeric = _to_float(value, 0.0)
            if numeric > 0:
                return numeric
        if isinstance(usage, dict) and key in usage:
            numeric = _to_float(usage.get(key), 0.0)
            if numeric > 0:
                return numeric
    return 0.0


def extract_openai_usage(response: Any) -> dict[str, float]:
    usage = getattr(response, "usage", None)
    prompt_tokens = _extract_usage_value(usage, "input_tokens", "prompt_tokens")
    completion_tokens = _extract_usage_value(usage, "output_tokens", "completion_tokens")
    total_tokens = _extract_usage_value(usage, "total_tokens")
    if total_tokens <= 0:
        total_tokens = prompt_tokens + completion_tokens
    return {
        "prompt_tokens": float(max(0.0, prompt_tokens)),
        "completion_tokens": float(max(0.0, completion_tokens)),
        "total_tokens": float(max(0.0, total_tokens)),
    }


def estimate_openai_cost(
    *,
    prompt_tokens: float,
    completion_tokens: float,
) -> float:
    input_rate = max(0.0, _to_float(getattr(settings, "openai_input_cost_per_1m_tokens", 0.0), 0.0))
    output_rate = max(0.0, _to_float(getattr(settings, "openai_output_cost_per_1m_tokens", 0.0), 0.0))
    return round(((prompt_tokens / 1_000_000.0) * input_rate) + ((completion_tokens / 1_000_000.0) * output_rate), 8)


def log_api_usage(
    session: Session,
    *,
    user_id: int | None,
    tenant_id: int | None,
    provider: str,
    endpoint: str,
    usage_units: float,
    cost: float,
    request_id: str | None = None,
) -> APIUsageLog:
    row = APIUsageLog(
        user_id=user_id,
        tenant_id=tenant_id,
        provider=(provider or "internal")[:120],
        endpoint=(endpoint or "")[:240],
        usage_units=float(max(0.0, usage_units)),
        cost=float(max(0.0, cost)),
        request_id=(request_id or "")[:120] or None,
        created_at=utcnow(),
    )
    session.add(row)
    session.commit()
    return row


def track_openai_api_usage(
    session: Session,
    *,
    user_id: int | None,
    tenant_id: int | None,
    endpoint: str,
    response: Any,
    request_id: str | None = None,
) -> APIUsageLog:
    usage = extract_openai_usage(response)
    cost = estimate_openai_cost(
        prompt_tokens=usage["prompt_tokens"],
        completion_tokens=usage["completion_tokens"],
    )
    return log_api_usage(
        session,
        user_id=user_id,
        tenant_id=tenant_id,
        provider="openai",
        endpoint=endpoint,
        usage_units=usage["total_tokens"],
        cost=cost,
        request_id=request_id,
    )


def track_x_api_usage(
    session: Session,
    *,
    user_id: int | None,
    tenant_id: int | None,
    endpoint: str,
    calls: int,
    request_id: str | None = None,
) -> APIUsageLog | None:
    call_count = int(max(0, calls))
    if call_count <= 0:
        return None
    per_call_cost = max(0.0, _to_float(getattr(settings, "x_api_call_cost", 0.0), 0.0))
    return log_api_usage(
        session,
        user_id=user_id,
        tenant_id=tenant_id,
        provider="x",
        endpoint=endpoint,
        usage_units=float(call_count),
        cost=round(call_count * per_call_cost, 8),
        request_id=request_id,
    )
