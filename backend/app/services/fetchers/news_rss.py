from datetime import datetime, timedelta, timezone
import html
import re

import feedparser
from dateutil import parser

from app.services.fetchers.base import RawEvent


def _parse_date(raw_date: str | None) -> datetime | None:
    if not raw_date:
        return None
    try:
        parsed = parser.parse(raw_date)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        else:
            parsed = parsed.astimezone(timezone.utc)

        # Some publishers occasionally emit future publish times.
        # Clamp suspicious future timestamps by ignoring them.
        if parsed > datetime.now(timezone.utc) + timedelta(minutes=10):
            return None
        return parsed
    except (ValueError, TypeError):
        return None


def _strip_html(value: str | None) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _looks_like_blob(text: str) -> bool:
    compact = text.replace(" ", "")
    if len(compact) < 70:
        return False
    # Long encoded-like payloads or trackers should not be used as human summary text.
    if re.fullmatch(r"[A-Za-z0-9+/=_-]+", compact):
        return True
    return False


def _sanitize_summary(value: str | None) -> str | None:
    text = _strip_html(value)
    if not text:
        return None
    # Remove direct URLs and common tracker-style leftovers.
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\bwww\.\S+", " ", text)
    text = re.sub(r"<a\b[^>]*>", " ", text, flags=re.IGNORECASE)
    text = text.replace("<", " ").replace(">", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None
    if "href=" in text.lower():
        return None
    if _looks_like_blob(text):
        return None
    return text


def _extract_image_url(entry: dict) -> str | None:
    media_content = entry.get("media_content")
    if isinstance(media_content, list):
        for item in media_content:
            if not isinstance(item, dict):
                continue
            value = str(item.get("url") or "").strip()
            if value:
                return value

    media_thumbnail = entry.get("media_thumbnail")
    if isinstance(media_thumbnail, list):
        for item in media_thumbnail:
            if not isinstance(item, dict):
                continue
            value = str(item.get("url") or "").strip()
            if value:
                return value

    links = entry.get("links")
    if isinstance(links, list):
        for item in links:
            if not isinstance(item, dict):
                continue
            media_type = str(item.get("type") or "").lower()
            if media_type.startswith("image/"):
                value = str(item.get("href") or "").strip()
                if value:
                    return value

    rich_html = str(entry.get("summary") or entry.get("description") or "")
    if rich_html:
        match = re.search(r"<img[^>]+src=[\"']([^\"']+)[\"']", rich_html, flags=re.IGNORECASE)
        if match and match.group(1):
            return html.unescape(match.group(1)).strip()

    return None


def fetch_news_rss(endpoint: str, limit: int = 50) -> list[RawEvent]:
    parsed = feedparser.parse(endpoint)
    is_google_rss = "news.google.com" in (endpoint or "").lower()
    now = datetime.now(timezone.utc)
    stale_cutoff = now - timedelta(days=30)
    items: list[RawEvent] = []

    for entry in parsed.entries[:limit]:
        published_raw = entry.get("published") or entry.get("updated")
        event_time = _parse_date(published_raw)

        if is_google_rss:
            # Google-syndicated entries without a trustworthy publish timestamp
            # frequently surface very old stories as if they were new.
            if event_time is None:
                continue
            if event_time < stale_cutoff:
                continue

        title = entry.get("title", "Untitled news item")
        summary = _sanitize_summary(entry.get("summary"))
        if not summary:
            summary = _sanitize_summary(entry.get("description"))
        if not summary:
            # Keep summary always readable for UI panels.
            summary = _strip_html(title)

        link = entry.get("link")
        external_id = entry.get("id") or link
        author = entry.get("author")
        tags = ",".join(tag.get("term", "") for tag in entry.get("tags", []) if tag.get("term"))

        details_parts = []
        if author:
            details_parts.append(f"author={author}")
        if published_raw and event_time is not None:
            details_parts.append(f"published={published_raw}")
        if tags:
            details_parts.append(f"tags={tags}")
        image_url = _extract_image_url(entry)
        if image_url:
            details_parts.append(f"image_url={image_url}")
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
