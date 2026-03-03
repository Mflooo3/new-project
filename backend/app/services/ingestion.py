from datetime import datetime, timedelta, timezone
from typing import Callable

from sqlalchemy import true
from sqlmodel import Session, desc, select

from app.config import settings
from app.models import Alert, Event, Source
from app.services.alerts import build_alerts
from app.services.analysis import AIAnalyzer
from app.services.fetchers.base import RawEvent
from app.services.fetchers.cyber import fetch_cyber_feed
from app.services.fetchers.custom import fetch_custom_json
from app.services.fetchers.flight import fetch_flight_feed
from app.services.fetchers.flightradar24 import fetch_flightradar24_feed
from app.services.fetchers.incidents import fetch_incident_feed
from app.services.fetchers.marine import fetch_marine_feed
from app.services.fetchers.marinetraffic_official import fetch_marinetraffic_official_feed
from app.services.fetchers.news_apis import (
    fetch_apify_arab_news,
    fetch_gnews_io,
    fetch_newsapi_org,
    fetch_newsdata_io,
)
from app.services.fetchers.news_rss import fetch_news_rss
from app.services.fetchers.social import fetch_social_feed
from app.services.realtime import event_bus


Fetcher = Callable[[str], list[RawEvent]]
MONITORED_TOPICS = {
    "war",
    "conflict",
    "missile",
    "drone",
    "strike",
    "attack",
    "military",
    "naval",
    "cyber",
    "hacked",
    "breach",
    "ransomware",
    "threat",
    "terror",
    "breaking",
    "escalation",
    "حرب",
    "هجوم",
    "صاروخ",
    "عسكري",
    "تهديد",
    "اختراق",
    "تصعيد",
    "عاجل",
}


def _in_gulf(lat: float | None, lon: float | None) -> bool:
    if lat is None or lon is None:
        return False
    return (
        settings.gulf_min_lat <= lat <= settings.gulf_max_lat
        and settings.gulf_min_lon <= lon <= settings.gulf_max_lon
    )


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _keyword_hits(*values: str | None) -> int:
    text = " ".join(filter(None, values)).lower()
    return sum(1 for keyword in settings.keywords if keyword in text)


def _topic_hits(*values: str | None) -> int:
    text = " ".join(filter(None, values)).lower()
    return sum(1 for keyword in MONITORED_TOPICS if keyword in text)


def _relevance_score(raw: RawEvent) -> float:
    hits = _keyword_hits(raw.title, raw.summary, raw.details, raw.location)
    score = min(0.8, hits * 0.15)
    topic = _topic_hits(raw.title, raw.summary, raw.details)
    if topic > 0:
        score = min(1.0, score + min(0.3, topic * 0.07))
    if _in_gulf(raw.latitude, raw.longitude):
        score = min(1.0, score + 0.35)
    return round(score, 3)


def _is_relevant(raw: RawEvent, source_type: str) -> bool:
    if source_type == "news":
        # Keep all configured news records; operators can narrow using source + query filters in UI.
        return True
    if source_type == "cyber":
        return True
    if source_type == "social" and _keyword_hits(raw.title, raw.summary, raw.details, raw.location) > 0:
        return True
    if source_type in {"social", "news", "incident", "cyber"} and _topic_hits(raw.title, raw.summary, raw.details) > 0:
        return True
    if _in_gulf(raw.latitude, raw.longitude):
        return True
    if _keyword_hits(raw.title, raw.summary, raw.details, raw.location) > 0:
        return True
    return source_type in {"incident", "news"} and _keyword_hits(raw.title, raw.summary) > 0


def _fetchers_by_type() -> dict[str, Fetcher]:
    return {
        "news": fetch_news_rss,
        "flight": fetch_flight_feed,
        "marine": fetch_marine_feed,
        "incident": fetch_incident_feed,
        "cyber": fetch_cyber_feed,
        "social": fetch_social_feed,
        "custom": fetch_custom_json,
    }


def _fetchers_by_hint() -> dict[str, Fetcher]:
    return {
        "rss": fetch_news_rss,
        "newsdata_io": fetch_newsdata_io,
        "gnews_io": fetch_gnews_io,
        "newsapi_org": fetch_newsapi_org,
        "apify_arab_news": fetch_apify_arab_news,
        "opensky": fetch_flight_feed,
        "generic_json_list": fetch_custom_json,
        "flightradar24": fetch_flightradar24_feed,
        "fr24": fetch_flightradar24_feed,
        "marinetraffic": fetch_marinetraffic_official_feed,
        "marinetraffic_official": fetch_marinetraffic_official_feed,
        "cyber_rss": fetch_cyber_feed,
        "social_reddit_json": fetch_social_feed,
        "social_json": fetch_social_feed,
        "social_rss": fetch_social_feed,
    }


def _resolve_fetcher(source: Source) -> Fetcher | None:
    parser_hint = (source.parser_hint or "").strip().lower()
    by_hint = _fetchers_by_hint()
    by_type = _fetchers_by_type()
    if parser_hint and parser_hint in by_hint:
        return by_hint[parser_hint]
    return by_type.get(source.source_type)


class IngestionService:
    def __init__(self, session: Session, analyzer: AIAnalyzer | None = None):
        self.session = session
        self.analyzer = analyzer or AIAnalyzer()

    def run_once(self, force: bool = False) -> dict[str, int]:
        sources = self.session.exec(
            select(Source).where(Source.enabled == true()).order_by(desc(Source.created_at))
        ).all()

        events_collected = 0
        events_stored = 0
        alerts_created = 0
        sources_polled = 0
        now = datetime.now(timezone.utc)

        for source in sources:
            if not force and source.last_polled_at:
                last_polled_at = _as_utc(source.last_polled_at)
                elapsed = (now - last_polled_at).total_seconds()
                if elapsed < source.poll_interval_seconds:
                    continue
            fetcher = _resolve_fetcher(source)
            if not fetcher:
                continue
            try:
                raw_events = fetcher(source.endpoint)
                source.last_polled_at = now
                self.session.add(source)
                self.session.commit()
                sources_polled += 1
            except Exception:
                continue

            events_collected += len(raw_events)
            for raw in raw_events:
                if not raw.title:
                    continue
                if not _is_relevant(raw, source.source_type):
                    continue
                if self._exists(source, raw):
                    continue

                relevance_score = _relevance_score(raw)
                analysis = self.analyzer.analyze(
                    raw=raw,
                    source_type=source.source_type,
                    relevance_score=relevance_score,
                )
                event = Event(
                    source_id=source.id,
                    source_type=source.source_type,
                    source_name=source.name,
                    external_id=raw.external_id,
                    title=raw.title[:300],
                    summary=(raw.summary or "")[:1500] or None,
                    details=(raw.details or "")[:3000] or None,
                    url=raw.url,
                    location=raw.location,
                    latitude=raw.latitude,
                    longitude=raw.longitude,
                    event_time=raw.normalized_time(),
                    relevance_score=relevance_score,
                    severity=analysis.severity,
                    tags=",".join(analysis.tags),
                    ai_assessment=analysis.assessment,
                )
                self.session.add(event)
                self.session.commit()
                self.session.refresh(event)
                events_stored += 1

                created_alerts = self._create_alerts(event)
                alerts_created += created_alerts

                event_bus.publish_nowait(
                    {
                        "type": "event",
                        "event": {
                            "id": event.id,
                            "title": event.title,
                            "source_type": event.source_type,
                            "severity": event.severity,
                            "created_at": event.created_at.isoformat(),
                        },
                    }
                )

        return {
            "sources_polled": sources_polled,
            "events_collected": events_collected,
            "events_stored": events_stored,
            "alerts_created": alerts_created,
        }

    def _exists(self, source: Source, raw: RawEvent) -> bool:
        normalized_time = raw.normalized_time()
        if raw.external_id:
            existing = self.session.exec(
                select(Event.id).where(
                    Event.source_id == source.id,
                    Event.external_id == raw.external_id,
                )
            ).first()
            if existing:
                return True

        if raw.event_time is not None:
            exact_match = self.session.exec(
                select(Event.id).where(
                    Event.source_id == source.id,
                    Event.title == raw.title[:300],
                    Event.event_time == normalized_time,
                )
            ).first()
            return exact_match is not None

        recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
        recent_match = self.session.exec(
            select(Event.id).where(
                Event.source_id == source.id,
                Event.title == raw.title[:300],
                Event.created_at >= recent_cutoff,
            )
        ).first()
        return recent_match is not None

    def _create_alerts(self, event: Event) -> int:
        alerts: list[Alert] = build_alerts(event)
        count = 0
        for alert in alerts:
            alert.event_id = event.id or 0
            self.session.add(alert)
            self.session.commit()
            self.session.refresh(alert)
            count += 1
            event_bus.publish_nowait(
                {
                    "type": "alert",
                    "alert": {
                        "id": alert.id,
                        "event_id": alert.event_id,
                        "level": alert.level,
                        "title": alert.title,
                        "created_at": alert.created_at.isoformat(),
                    },
                }
            )
        return count
