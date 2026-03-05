from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from dateutil import parser

from app.config import settings
from app.services.fetchers.base import RawEvent
from app.services.sentiment import sentiment


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parser.parse(value)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _with_query_if_missing(endpoint: str, updates: dict[str, str | None]) -> str:
    parsed = urlparse(endpoint)
    current = dict(parse_qsl(parsed.query, keep_blank_values=True))
    for key, value in updates.items():
        if value and key not in current:
            current[key] = value
    query = urlencode(current, doseq=True)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, query, parsed.fragment))


def _author_map(includes: dict[str, Any] | None) -> dict[str, str]:
    users = (includes or {}).get("users") if isinstance(includes, dict) else []
    out: dict[str, str] = {}
    if not isinstance(users, list):
        return out
    for row in users:
        if not isinstance(row, dict):
            continue
        uid = str(row.get("id") or "").strip()
        handle = str(row.get("username") or "").strip()
        if uid and handle:
            out[uid] = handle
    return out


def _media_map(includes: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    media_rows = (includes or {}).get("media") if isinstance(includes, dict) else []
    out: dict[str, dict[str, Any]] = {}
    if not isinstance(media_rows, list):
        return out
    for row in media_rows:
        if not isinstance(row, dict):
            continue
        media_key = str(row.get("media_key") or "").strip()
        if not media_key:
            continue
        out[media_key] = row
    return out


def _entity_urls(row: dict[str, Any]) -> list[str]:
    entities = row.get("entities") if isinstance(row.get("entities"), dict) else {}
    urls = entities.get("urls") if isinstance(entities, dict) else []
    out: list[str] = []
    if not isinstance(urls, list):
        return out
    for item in urls:
        if not isinstance(item, dict):
            continue
        for key in ("expanded_url", "unwound_url", "url"):
            value = str(item.get(key) or "").strip()
            if value and value not in out:
                out.append(value)
    return out


def fetch_x_recent(endpoint: str, limit: int = 80) -> list[RawEvent]:
    token = (settings.x_api_bearer_token or settings.x_api_key or "").strip()
    if not token:
        return []

    url = _with_query_if_missing(
        endpoint,
        {
            "max_results": str(min(100, max(10, limit))),
            "tweet.fields": "created_at,lang,public_metrics,author_id,entities,attachments",
            "expansions": "author_id,attachments.media_keys",
            "media.fields": "media_key,type,url,preview_image_url",
            "sort_order": "recency",
        },
    )

    headers = {
        "Authorization": f"Bearer {token}",
        "User-Agent": "gulf-monitor/1.0",
    }
    with httpx.Client(timeout=30, headers=headers) as client:
        response = client.get(url)
        response.raise_for_status()
        payload: Any = response.json()

    rows = payload.get("data") if isinstance(payload, dict) else []
    if not isinstance(rows, list):
        return []
    authors = _author_map(payload.get("includes") if isinstance(payload, dict) else None)
    media_by_key = _media_map(payload.get("includes") if isinstance(payload, dict) else None)

    items: list[RawEvent] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        tweet_id = str(row.get("id") or "").strip()
        text = str(row.get("text") or "").strip()
        if not tweet_id or not text:
            continue
        author_id = str(row.get("author_id") or "").strip()
        handle = authors.get(author_id, "")
        title = f"X: {text[:220]}"
        metrics = row.get("public_metrics") if isinstance(row.get("public_metrics"), dict) else {}
        likes = metrics.get("like_count", "n/a")
        reposts = metrics.get("retweet_count", "n/a")
        replies = metrics.get("reply_count", "n/a")
        label, value = sentiment(text)
        details_parts = [
            f"platform=x",
            f"sentiment={label}:{value}",
            f"likes={likes}",
            f"reposts={reposts}",
            f"replies={replies}",
        ]
        if handle:
            details_parts.append(f"author=@{handle}")
        media_keys = []
        attachments = row.get("attachments") if isinstance(row.get("attachments"), dict) else {}
        if isinstance(attachments, dict):
            raw_keys = attachments.get("media_keys")
            if isinstance(raw_keys, list):
                media_keys = [str(value).strip() for value in raw_keys if str(value or "").strip()]
        media_types: list[str] = []
        image_urls: list[str] = []
        video_urls: list[str] = []
        for media_key in media_keys:
            media_row = media_by_key.get(media_key) or {}
            media_type = str(media_row.get("type") or "").strip().lower()
            media_url = str(media_row.get("url") or "").strip()
            preview_url = str(media_row.get("preview_image_url") or "").strip()
            if media_type:
                media_types.append(media_type)
            if media_type == "photo" and media_url:
                image_urls.append(media_url)
            elif preview_url:
                image_urls.append(preview_url)
                if media_type in {"video", "animated_gif"}:
                    video_urls.append(preview_url)
        entity_urls = _entity_urls(row)
        if media_types:
            details_parts.append(f"media_type={','.join(dict.fromkeys(media_types))}")
        if image_urls:
            details_parts.append(f"image_url={image_urls[0]}")
        if video_urls:
            details_parts.append(f"video_url={video_urls[0]}")
        if entity_urls:
            details_parts.append(f"expanded_url={entity_urls[0]}")
        items.append(
            RawEvent(
                external_id=tweet_id,
                title=title,
                summary=text[:600],
                details=" | ".join(details_parts),
                url=f"https://x.com/i/web/status/{tweet_id}",
                event_time=_parse_date(row.get("created_at")),
            )
        )
    return items
