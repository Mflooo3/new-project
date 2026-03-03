from datetime import datetime, timezone
from typing import Any

import httpx
from dateutil import parser

from app.services.fetchers.base import RawEvent
from app.services.fetchers.news_rss import fetch_news_rss
from app.services.sentiment import sentiment


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OverflowError, ValueError):
            return None
    if isinstance(value, str):
        try:
            parsed = parser.parse(value)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _from_reddit(payload: dict[str, Any], limit: int) -> list[RawEvent]:
    rows = payload.get("data", {}).get("children", [])
    items: list[RawEvent] = []
    for row in rows[:limit]:
        data = row.get("data", {}) if isinstance(row, dict) else {}
        title = str(data.get("title") or "Social trend")
        body = str(data.get("selftext") or "")
        score = data.get("score")
        comments = data.get("num_comments")
        url = data.get("url") or data.get("permalink")
        created_utc = data.get("created_utc")
        combined = f"{title} {body}"
        label, value = sentiment(combined)
        summary = f"trend_score={score if score is not None else 'n/a'} | comments={comments if comments is not None else 'n/a'}"
        details = f"social_sentiment={label}:{value} | {body[:1000]}"
        items.append(
            RawEvent(
                external_id=str(data.get("id") or ""),
                title=f"Social trend: {title}",
                summary=summary,
                details=details,
                url=str(url) if url else None,
                location=None,
                latitude=None,
                longitude=None,
                event_time=_as_datetime(created_utc),
            )
        )
    return items


def _from_generic(payload: Any, limit: int) -> list[RawEvent]:
    if isinstance(payload, dict):
        rows = payload.get("data") or payload.get("items") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    items: list[RawEvent] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or row.get("name") or "Social signal")
        text = str(row.get("text") or row.get("summary") or row.get("description") or "")
        label, value = sentiment(f"{title} {text}")
        items.append(
            RawEvent(
                external_id=str(row.get("id") or row.get("external_id") or ""),
                title=f"Social trend: {title}",
                summary=(text[:300] if text else None),
                details=f"social_sentiment={label}:{value} | {text[:1000]}",
                url=row.get("url"),
                location=row.get("location"),
                latitude=_as_float(row.get("latitude")),
                longitude=_as_float(row.get("longitude")),
                event_time=_as_datetime(row.get("timestamp") or row.get("created_at")),
            )
        )
    return items


def fetch_social_feed(endpoint: str, limit: int = 80) -> list[RawEvent]:
    endpoint_lower = endpoint.lower()
    if endpoint_lower.endswith(".rss") or "format=rss" in endpoint_lower:
        rss_rows = fetch_news_rss(endpoint=endpoint, limit=limit)
        items: list[RawEvent] = []
        for row in rss_rows:
            combined = " ".join(filter(None, [row.title, row.summary, row.details]))
            label, value = sentiment(combined)
            items.append(
                RawEvent(
                    external_id=row.external_id,
                    title=f"Social trend: {row.title}",
                    summary=row.summary,
                    details=f"social_sentiment={label}:{value} | {(row.details or row.summary or '')[:1000]}",
                    url=row.url,
                    location=row.location,
                    latitude=row.latitude,
                    longitude=row.longitude,
                    event_time=row.event_time,
                )
            )
        return items

    with httpx.Client(timeout=25, headers={"User-Agent": "gulf-monitor/1.0"}) as client:
        response = client.get(endpoint)
        response.raise_for_status()
        payload = response.json()

    if isinstance(payload, dict) and "children" in (payload.get("data") or {}):
        return _from_reddit(payload, limit=limit)
    return _from_generic(payload, limit=limit)
