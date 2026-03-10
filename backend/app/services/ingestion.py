from datetime import datetime, timedelta, timezone
import logging
import re
from typing import Callable

from sqlalchemy import true
from sqlmodel import Session, desc, select

from app.config import settings
from app.models import Alert, Event, Source
from app.services.alerts import build_alerts
from app.services.analysis import AIAnalyzer
from app.services.ai_workspace import AIWorkspaceService
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
from app.services.ocr import EventImageOCRService
from app.services.fetchers.social import fetch_social_feed
from app.services.fetchers.x_recent import fetch_x_recent
from app.services.realtime import event_bus


Fetcher = Callable[[str], list[RawEvent]]
logger = logging.getLogger(__name__)
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

SPORTS_KEYWORDS = {
    "football",
    "soccer",
    "premier league",
    "la liga",
    "champions league",
    "fifa",
    "uefa",
    "liverpool",
    "arsenal",
    "barcelona",
    "real madrid",
    "match",
    "matches",
    "goal",
    "goals",
    "coach",
    "transfer",
    "sports",
    "sport",
    "كورة",
    "كرة",
    "كرة القدم",
    "مباراة",
    "مباريات",
    "هدف",
    "أهداف",
    "دوري",
    "الدوري",
    "الدوري الإنجليزي",
    "الدوري الاسباني",
    "كأس",
    "رياضة",
    "رياضي",
    "ليفربول",
    "برشلونة",
    "ريال مدريد",
}

ARABIC_ONLY_UAE_FEED_MARKERS = (
    "wam uae feed",
    "24.ae uae feed",
    "sharjah24 uae feed",
    "emarat al youm uae feed",
    "al bayan uae feed",
    "al khaleej uae feed",
    "al ittihad uae feed",
    "al roeya uae feed",
)

LONG_LOOKBACK_NEWS_FEED_MARKERS = (
    "wam uae feed",
    "khaleej times uae feed",
    "emirates 24/7 uae feed",
    "the national uae feed",
    "uae casualty verified feed",
)


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


def _contains_arabic(*values: str | None) -> bool:
    text = " ".join(filter(None, values))
    return bool(re.search(r"[\u0600-\u06FF]", text))


def _details_quality(value: str | None) -> int:
    parts = [part.strip().lower() for part in str(value or "").split("|") if part.strip()]
    if not parts:
        return 0
    score = 0
    for part in parts:
        if part.endswith("=n/a") or part.endswith("=?"):
            continue
        if "unknown" in part:
            continue
        score += 1
    return score


def _is_sports_content(*values: str | None) -> bool:
    text = " ".join(filter(None, values)).lower()
    return any(keyword in text for keyword in SPORTS_KEYWORDS)


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
    if source_type == "news" and _is_sports_content(raw.title, raw.summary, raw.details):
        return False
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
        "jsoncargo": fetch_marinetraffic_official_feed,
        "jsoncargo_official": fetch_marinetraffic_official_feed,
        "marinetraffic": fetch_marinetraffic_official_feed,
        "marinetraffic_official": fetch_marinetraffic_official_feed,
        "cyber_rss": fetch_cyber_feed,
        "social_reddit_json": fetch_social_feed,
        "social_json": fetch_social_feed,
        "social_rss": fetch_social_feed,
        "x_recent": fetch_x_recent,
        "x_api_v2": fetch_x_recent,
        "twitter_recent": fetch_x_recent,
    }


def _resolve_fetcher(source: Source) -> Fetcher | None:
    parser_hint = (source.parser_hint or "").strip().lower()
    by_hint = _fetchers_by_hint()
    by_type = _fetchers_by_type()
    if parser_hint and parser_hint in by_hint:
        return by_hint[parser_hint]
    return by_type.get(source.source_type)


class IngestionService:
    def __init__(self, session: Session, analyzer: AIAnalyzer | None = None, tenant_id: int | None = None):
        self.session = session
        self.analyzer = analyzer or AIAnalyzer()
        self.tenant_id = tenant_id
        self.ocr = EventImageOCRService()

    def run_once(self, force: bool = False) -> dict[str, int]:
        query = select(Source).where(Source.enabled == true())
        if self.tenant_id is not None:
            query = query.where(Source.tenant_id == self.tenant_id)
        sources = self.session.exec(query.order_by(desc(Source.created_at))).all()

        events_collected = 0
        events_stored = 0
        alerts_created = 0
        sources_polled = 0
        now = datetime.now(timezone.utc)

        for source in sources:
            source_parser_hint = (source.parser_hint or "").strip().lower()
            is_x_recent_source = source_parser_hint in {"x_recent", "x_api_v2", "twitter_recent"}
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
            except Exception as exc:
                logger.warning(
                    "Ingestion source failed source=%s type=%s parser=%s endpoint=%s error=%s",
                    source.name,
                    source.source_type,
                    source.parser_hint,
                    source.endpoint,
                    str(exc)[:280],
                )
                continue

            events_collected += len(raw_events)
            for raw in raw_events:
                if not raw.title:
                    continue
                if source.source_type == "news" and raw.event_time is not None:
                    raw_event_time = _as_utc(raw.event_time)
                    max_age_hours = max(1, int(settings.news_max_age_hours))
                    source_name_lower = (source.name or "").lower()
                    if any(marker in source_name_lower for marker in LONG_LOOKBACK_NEWS_FEED_MARKERS):
                        max_age_hours = max(max_age_hours, 168)
                    if raw_event_time < now - timedelta(hours=max_age_hours):
                        continue
                if source.source_type == "news":
                    source_name_lower = (source.name or "").lower()
                    if any(marker in source_name_lower for marker in ARABIC_ONLY_UAE_FEED_MARKERS):
                        if not _contains_arabic(raw.title, raw.summary):
                            continue
                if not is_x_recent_source and not _is_relevant(raw, source.source_type):
                    continue
                existing_event = self._find_existing_by_external_id(source, raw)
                if existing_event is not None:
                    raw = self._maybe_enrich_raw_with_ocr(raw=raw, source=source, existing_event=existing_event)
                    self._refresh_existing_event(source=source, raw=raw, event=existing_event)
                    continue
                if self._exists(source, raw):
                    continue

                raw = self._maybe_enrich_raw_with_ocr(raw=raw, source=source, existing_event=None)

                relevance_score = _relevance_score(raw)
                analysis = self.analyzer.analyze(
                    raw=raw,
                    source_type=source.source_type,
                    relevance_score=relevance_score,
                )
                event = Event(
                    tenant_id=source.tenant_id,
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

                try:
                    prediction_updates = AIWorkspaceService(
                        session=self.session,
                        tenant_id=event.tenant_id,
                    ).auto_update_predictions_for_event(event)
                    for update in prediction_updates:
                        event_bus.publish_nowait(
                            {
                                "type": "prediction",
                                "action": "auto_update",
                                "ticket_id": update.ticket_id,
                                "update_id": update.id,
                                "created_at": update.created_at.isoformat(),
                            }
                        )
                except Exception:
                    # Prediction updates should not block ingestion.
                    pass

        return {
            "sources_polled": sources_polled,
            "events_collected": events_collected,
            "events_stored": events_stored,
            "alerts_created": alerts_created,
        }

    def backfill_ocr_for_existing_events(
        self,
        *,
        hours: int = 720,
        limit: int = 450,
        force: bool = False,
    ) -> dict[str, int]:
        now = datetime.now(timezone.utc)
        start = now - timedelta(hours=max(1, int(hours)))
        rows = self.session.exec(
            select(Event)
            .where(Event.event_time >= start)
            .where(Event.source_type.in_(["news", "social", "custom", "incident"]))
            .order_by(desc(Event.event_time))
            .limit(max(1, min(int(limit), 3000)))
        ).all()
        if self.tenant_id is not None:
            rows = [row for row in rows if row.tenant_id == self.tenant_id]

        scanned = 0
        updated = 0
        skipped = 0
        failed = 0

        for event in rows:
            scanned += 1
            before_details = event.details or ""
            if not force and ("ocr_status=ok" in before_details.lower() or "ocr_status=failed" in before_details.lower()):
                skipped += 1
                continue

            raw = RawEvent(
                external_id=event.external_id,
                title=event.title,
                summary=event.summary,
                details=event.details,
                url=event.url,
                location=event.location,
                latitude=event.latitude,
                longitude=event.longitude,
                event_time=event.event_time,
            )
            enriched = self._maybe_enrich_raw_with_ocr(raw=raw, source=None, existing_event=event, force=force)
            if (enriched.details or "") == before_details:
                skipped += 1
                continue

            event.summary = (enriched.summary or "")[:1500] or None
            event.details = (enriched.details or "")[:3000] or None

            try:
                relevance_score = _relevance_score(enriched)
                analysis = self.analyzer.analyze(
                    raw=enriched,
                    source_type=event.source_type,
                    relevance_score=relevance_score,
                )
                event.relevance_score = relevance_score
                event.severity = analysis.severity
                event.tags = ",".join(analysis.tags)
                event.ai_assessment = analysis.assessment
                self.session.add(event)
                self.session.commit()
                updated += 1
            except Exception:
                self.session.rollback()
                failed += 1

        return {
            "scanned": scanned,
            "updated": updated,
            "skipped": skipped,
            "failed": failed,
        }

    def _find_existing_by_external_id(self, source: Source, raw: RawEvent) -> Event | None:
        if not raw.external_id:
            return None
        query = select(Event).where(
            Event.source_id == source.id,
            Event.external_id == raw.external_id,
        )
        if source.tenant_id is not None:
            query = query.where(Event.tenant_id == source.tenant_id)
        return self.session.exec(query.order_by(desc(Event.created_at)).limit(1)).first()

    def _refresh_existing_event(self, *, source: Source, raw: RawEvent, event: Event) -> None:
        changed = False
        new_title = raw.title[:300]
        new_summary = (raw.summary or "")[:1500] or None
        new_details = (raw.details or "")[:3000] or None

        if new_title and new_title != event.title:
            event.title = new_title
            changed = True

        if new_summary and (not event.summary or len(new_summary) > len(event.summary or "")):
            event.summary = new_summary
            changed = True

        if new_details and _details_quality(new_details) > _details_quality(event.details):
            event.details = new_details
            changed = True

        if raw.url and not event.url:
            event.url = raw.url
            changed = True

        if raw.location and not event.location:
            event.location = raw.location
            changed = True

        if raw.latitude is not None and event.latitude is None:
            event.latitude = raw.latitude
            changed = True
        if raw.longitude is not None and event.longitude is None:
            event.longitude = raw.longitude
            changed = True

        normalized_time = raw.normalized_time()
        if normalized_time and normalized_time != event.event_time:
            event.event_time = normalized_time
            changed = True

        if not changed:
            return

        relevance_score = _relevance_score(raw)
        analysis = self.analyzer.analyze(
            raw=raw,
            source_type=source.source_type,
            relevance_score=relevance_score,
        )
        event.relevance_score = relevance_score
        event.severity = analysis.severity
        event.tags = ",".join(analysis.tags)
        event.ai_assessment = analysis.assessment
        self.session.add(event)
        self.session.commit()

    def _maybe_enrich_raw_with_ocr(
        self,
        *,
        raw: RawEvent,
        source: Source | None,
        existing_event: Event | None,
        force: bool = False,
    ) -> RawEvent:
        if not self.ocr.available():
            return raw
        try:
            source_name = source.name if source else (existing_event.source_name if existing_event else "source")
            source_type = source.source_type if source else (existing_event.source_type if existing_event else "news")
            return self.ocr.enrich_raw_event(raw=raw, source_name=source_name, source_type=source_type, force=force)
        except Exception:
            return raw

    def _exists(self, source: Source, raw: RawEvent) -> bool:
        normalized_time = raw.normalized_time()
        if raw.external_id:
            query = select(Event.id).where(
                Event.source_id == source.id,
                Event.external_id == raw.external_id,
            )
            if source.tenant_id is not None:
                query = query.where(Event.tenant_id == source.tenant_id)
            existing = self.session.exec(query).first()
            if existing:
                return True

        if raw.event_time is not None:
            query = select(Event.id).where(
                Event.source_id == source.id,
                Event.title == raw.title[:300],
                Event.event_time == normalized_time,
            )
            if source.tenant_id is not None:
                query = query.where(Event.tenant_id == source.tenant_id)
            exact_match = self.session.exec(query).first()
            return exact_match is not None

        recent_cutoff = datetime.now(timezone.utc) - timedelta(hours=6)
        query = select(Event.id).where(
            Event.source_id == source.id,
            Event.title == raw.title[:300],
            Event.created_at >= recent_cutoff,
        )
        if source.tenant_id is not None:
            query = query.where(Event.tenant_id == source.tenant_id)
        recent_match = self.session.exec(query).first()
        return recent_match is not None

    def _create_alerts(self, event: Event) -> int:
        alerts: list[Alert] = build_alerts(event)
        count = 0
        for alert in alerts:
            alert.tenant_id = event.tenant_id
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
