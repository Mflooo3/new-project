from datetime import datetime

import feedparser
from dateutil import parser

from app.services.fetchers.base import RawEvent


def _parse_date(raw_date: str | None) -> datetime | None:
    if not raw_date:
        return None
    try:
        return parser.parse(raw_date)
    except (ValueError, TypeError):
        return None


def fetch_news_rss(endpoint: str, limit: int = 50) -> list[RawEvent]:
    parsed = feedparser.parse(endpoint)
    items: list[RawEvent] = []
    for entry in parsed.entries[:limit]:
        title = entry.get("title", "Untitled news item")
        summary = entry.get("summary")
        link = entry.get("link")
        event_time = _parse_date(entry.get("published") or entry.get("updated"))
        external_id = entry.get("id") or link
        author = entry.get("author")
        tags = ",".join(tag.get("term", "") for tag in entry.get("tags", []) if tag.get("term"))
        published = entry.get("published") or entry.get("updated")
        details_parts = []
        if author:
            details_parts.append(f"author={author}")
        if published:
            details_parts.append(f"published={published}")
        if tags:
            details_parts.append(f"tags={tags}")
        details = " | ".join(details_parts) if details_parts else None
        items.append(
            RawEvent(
                external_id=external_id,
                title=title,
                summary=summary,
                details=details,
                url=link,
                event_time=event_time,
            )
        )
    return items
