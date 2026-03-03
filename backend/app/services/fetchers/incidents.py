from app.services.fetchers.base import RawEvent
from app.services.fetchers.news_rss import fetch_news_rss


def fetch_incident_feed(endpoint: str, limit: int = 50) -> list[RawEvent]:
    return fetch_news_rss(endpoint=endpoint, limit=limit)
