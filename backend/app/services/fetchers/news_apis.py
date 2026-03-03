from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx
from dateutil import parser

from app.config import settings
from app.services.fetchers.base import RawEvent


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return parser.parse(value)
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


def _fetch_json(endpoint: str) -> Any:
    with httpx.Client(timeout=30) as client:
        response = client.get(endpoint)
        response.raise_for_status()
        return response.json()


def fetch_newsdata_io(endpoint: str, limit: int = 50) -> list[RawEvent]:
    url = _with_query_if_missing(
        endpoint,
        {
            "apikey": settings.newsdata_api_key,
            "language": "ar",
        },
    )
    payload = _fetch_json(url)
    rows = payload.get("results") if isinstance(payload, dict) else []
    items: list[RawEvent] = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        source_id = row.get("source_id") or row.get("source_name")
        details = []
        if source_id:
            details.append(f"source={source_id}")
        if row.get("category"):
            details.append(f"category={','.join(row.get('category') or [])}")
        items.append(
            RawEvent(
                external_id=str(row.get("article_id") or row.get("link") or ""),
                title=str(row.get("title") or "NewsData article"),
                summary=str(row.get("description") or row.get("content") or ""),
                details=" | ".join(details) if details else None,
                url=row.get("link"),
                event_time=_parse_date(row.get("pubDate")),
            )
        )
    return items


def fetch_gnews_io(endpoint: str, limit: int = 50) -> list[RawEvent]:
    url = _with_query_if_missing(
        endpoint,
        {
            "apikey": settings.gnews_api_key,
            "lang": "ar",
            "max": str(limit),
        },
    )
    payload = _fetch_json(url)
    rows = payload.get("articles") if isinstance(payload, dict) else []
    items: list[RawEvent] = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        source_name = ""
        if isinstance(row.get("source"), dict):
            source_name = str(row.get("source", {}).get("name") or "")
        details = f"source={source_name}" if source_name else None
        items.append(
            RawEvent(
                external_id=str(row.get("url") or row.get("title") or ""),
                title=str(row.get("title") or "GNews article"),
                summary=str(row.get("description") or ""),
                details=details,
                url=row.get("url"),
                event_time=_parse_date(row.get("publishedAt")),
            )
        )
    return items


def fetch_newsapi_org(endpoint: str, limit: int = 50) -> list[RawEvent]:
    url = _with_query_if_missing(
        endpoint,
        {
            "apiKey": settings.newsapi_api_key,
            "language": "ar",
            "pageSize": str(limit),
            "sortBy": "publishedAt",
        },
    )
    payload = _fetch_json(url)
    rows = payload.get("articles") if isinstance(payload, dict) else []
    items: list[RawEvent] = []
    for row in (rows or [])[:limit]:
        if not isinstance(row, dict):
            continue
        source_name = ""
        if isinstance(row.get("source"), dict):
            source_name = str(row.get("source", {}).get("name") or "")
        details = f"source={source_name}" if source_name else None
        items.append(
            RawEvent(
                external_id=str(row.get("url") or row.get("title") or ""),
                title=str(row.get("title") or "NewsAPI article"),
                summary=str(row.get("description") or row.get("content") or ""),
                details=details,
                url=row.get("url"),
                event_time=_parse_date(row.get("publishedAt")),
            )
        )
    return items


def fetch_apify_arab_news(endpoint: str, limit: int = 50) -> list[RawEvent]:
    url = _with_query_if_missing(
        endpoint,
        {
            "token": settings.apify_token,
            "clean": "true",
            "format": "json",
        },
    )
    payload = _fetch_json(url)
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        rows = payload.get("items") or payload.get("data") or []
    else:
        rows = []

    items: list[RawEvent] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        source_name = str(row.get("source") or row.get("publisher") or "")
        details = f"source={source_name}" if source_name else None
        items.append(
            RawEvent(
                external_id=str(row.get("id") or row.get("url") or row.get("title") or ""),
                title=str(row.get("title") or row.get("headline") or "Apify article"),
                summary=str(row.get("description") or row.get("text") or row.get("content") or ""),
                details=details,
                url=row.get("url"),
                event_time=_parse_date(row.get("publishedAt") or row.get("date") or row.get("published")),
            )
        )
    return items
