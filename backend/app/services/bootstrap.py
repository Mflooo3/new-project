from sqlmodel import Session, select

from app.config import settings
from app.models import Source


def _source_exists(session: Session, source_type: str, endpoint: str) -> bool:
    row = session.exec(
        select(Source.id).where(
            Source.source_type == source_type,
            Source.endpoint == endpoint,
        )
    ).first()
    return row is not None


def seed_default_sources(session: Session) -> None:
    defaults: list[Source] = []
    if settings.default_news_rss:
        defaults.append(
            Source(
                name="ReliefWeb Gulf/Regional Feed",
                source_type="news",
                endpoint=settings.default_news_rss,
                parser_hint=settings.default_news_parser_hint,
            )
        )
    if settings.default_incident_feed:
        defaults.append(
            Source(
                name="GDACS Incident Feed",
                source_type="incident",
                endpoint=settings.default_incident_feed,
                parser_hint=settings.default_incident_parser_hint,
            )
        )
    if settings.default_flight_feed:
        defaults.append(
            Source(
                name="OpenSky State Feed",
                source_type="flight",
                endpoint=settings.default_flight_feed,
                parser_hint=settings.default_flight_parser_hint,
            )
        )
    if settings.default_marine_feed:
        defaults.append(
            Source(
                name="Marine Feed",
                source_type="marine",
                endpoint=settings.default_marine_feed,
                parser_hint=settings.default_marine_parser_hint,
            )
        )
    if settings.default_cyber_feed:
        defaults.append(
            Source(
                name="Cyber Advisories Feed",
                source_type="cyber",
                endpoint=settings.default_cyber_feed,
                parser_hint=settings.default_cyber_parser_hint,
            )
        )
    if settings.default_social_feed:
        defaults.append(
            Source(
                name="Social Trends Feed",
                source_type="social",
                endpoint=settings.default_social_feed,
                parser_hint=settings.default_social_parser_hint,
            )
        )
    if settings.default_cnn_gulf_feed:
        defaults.append(
            Source(
                name="CNN Gulf Publisher Feed",
                source_type="news",
                endpoint=settings.default_cnn_gulf_feed,
                parser_hint="rss",
            )
        )
    if settings.default_alarabiya_gulf_feed:
        defaults.append(
            Source(
                name="Al Arabiya Gulf Publisher Feed",
                source_type="news",
                endpoint=settings.default_alarabiya_gulf_feed,
                parser_hint="rss",
            )
        )
    if settings.default_gulfnews_feed:
        defaults.append(
            Source(
                name="Gulf News Publisher Feed",
                source_type="news",
                endpoint=settings.default_gulfnews_feed,
                parser_hint="rss",
            )
        )
    if settings.default_bbc_arabic_feed:
        defaults.append(
            Source(
                name="BBC Arabic Feed",
                source_type="news",
                endpoint=settings.default_bbc_arabic_feed,
                parser_hint="rss",
            )
        )
    if settings.default_france24_ar_feed:
        defaults.append(
            Source(
                name="France 24 Arabic Feed",
                source_type="news",
                endpoint=settings.default_france24_ar_feed,
                parser_hint="rss",
            )
        )
    if settings.default_rt_arabic_feed:
        defaults.append(
            Source(
                name="RT Arabic Feed",
                source_type="news",
                endpoint=settings.default_rt_arabic_feed,
                parser_hint="rss",
            )
        )
    if settings.default_independentarabia_feed:
        defaults.append(
            Source(
                name="Independent Arabia Feed",
                source_type="news",
                endpoint=settings.default_independentarabia_feed,
                parser_hint="rss",
            )
        )
    if settings.default_skynews_feed:
        defaults.append(
            Source(
                name="Sky News Gulf Publisher Feed",
                source_type="news",
                endpoint=settings.default_skynews_feed,
                parser_hint="rss",
            )
        )
    inserted = False
    for source in defaults:
        if _source_exists(session=session, source_type=source.source_type, endpoint=source.endpoint):
            continue
        session.add(source)
        inserted = True
    if inserted:
        session.commit()
