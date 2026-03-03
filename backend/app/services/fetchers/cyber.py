from app.services.fetchers.base import RawEvent
from app.services.fetchers.news_rss import fetch_news_rss


def fetch_cyber_feed(endpoint: str, limit: int = 80) -> list[RawEvent]:
    events = fetch_news_rss(endpoint=endpoint, limit=limit)
    normalized: list[RawEvent] = []
    for event in events:
        title = event.title
        if not title.lower().startswith("cyber"):
            title = f"Cyber advisory: {title}"
        normalized.append(
            RawEvent(
                external_id=event.external_id,
                title=title,
                summary=event.summary,
                details=event.details,
                url=event.url,
                location=event.location,
                latitude=event.latitude,
                longitude=event.longitude,
                event_time=event.event_time,
            )
        )
    return normalized
