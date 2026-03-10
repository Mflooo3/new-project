from sqlmodel import Session, select

from app.config import settings
from app.models import Source


def _source_exists(session: Session, source_type: str, endpoint: str, tenant_id: int | None) -> bool:
    row = session.exec(
        select(Source.id).where(
            Source.source_type == source_type,
            Source.endpoint == endpoint,
            Source.tenant_id == tenant_id,
        )
    ).first()
    return row is not None


def seed_default_sources(session: Session, *, tenant_id: int | None = None) -> None:
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
    if settings.default_x_recent_feed:
        defaults.append(
            Source(
                name="X Gulf Live Feed",
                source_type="social",
                endpoint=settings.default_x_recent_feed,
                parser_hint=settings.default_x_recent_parser_hint,
            )
        )
    defaults.append(
        Source(
            name="X Oloumaldar + Aletihadae",
            source_type="social",
            endpoint=(
                "https://api.x.com/2/tweets/search/recent?query="
                "(from%3Aoloumaldar%20OR%20from%3Aaletihadae)%20"
                "(%D8%B9%D8%A7%D8%AC%D9%84%20OR%20%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA%20OR%20UAE)%20"
                "lang%3Aar%20-is%3Aretweet&max_results=60"
            ),
            parser_hint="x_recent",
        )
    )
    defaults.append(
        Source(
            name="Oloumaldar/Aletihadae Publisher Feed",
            source_type="news",
            endpoint=(
                "https://news.google.com/rss/search?q="
                "(oloumaldar%20OR%20aletihadae%20OR%20%22%D8%B9%D9%84%D9%88%D9%85%20%D8%A7%D9%84%D8%AF%D8%A7%D8%B1%22%20OR%20site:alittihad.ae)%20"
                "(uae%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA)"
                "&hl=ar&gl=AE&ceid=AE:ar"
            ),
            parser_hint="rss",
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
    if settings.default_uae_casualty_feed:
        defaults.append(
            Source(
                name="UAE Casualty Verified Feed",
                source_type="news",
                endpoint=settings.default_uae_casualty_feed,
                parser_hint="rss",
            )
        )
    inserted = False
    for source in defaults:
        source.tenant_id = tenant_id
        if _source_exists(
            session=session,
            source_type=source.source_type,
            endpoint=source.endpoint,
            tenant_id=tenant_id,
        ):
            continue
        session.add(source)
        inserted = True
    if inserted:
        session.commit()
