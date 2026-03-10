from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlmodel import Session, desc, select

from app.config import settings
from app.models import Event, Source
from app.services.account_risk_service import AccountRiskService
from app.services.ai_brief_service import AIBriefService
from app.services.api_usage_tracker import track_x_api_usage
from app.services.coordination_service import CoordinationService
from app.services.fetchers.base import RawEvent
from app.services.fetchers.x_recent import fetch_x_recent
from app.services.influence_service import InfluenceService
from app.services.narrative_service import NarrativeService
from app.services.public_discovery_query_builder import (
    build_public_discovery_queries,
    build_x_search_endpoint,
)
from app.services.source_policy import (
    classify_x_source,
    get_source_policy_for_feature,
    normalize_x_source_filter,
    x_source_class_allowed,
)
from app.services.xintel_common import (
    XPost,
    build_country_markers,
    country_match,
    detect_language,
    ensure_utc,
    extract_hashtags,
    extract_mentions,
    host_from_url,
    normalize_text,
    parse_details_map,
    parse_time_window,
    safe_int,
)
from app.services.xintel_sentiment_service import XIntelSentimentService


@dataclass
class XIntelFilters:
    country: str = "UAE"
    region_preset: str = "UAE"
    custom_country: str | None = None
    time_window: str = "24h"
    language: str = "both"
    threat_sensitivity: str = "medium"
    include_live: bool = True
    source_class: str = "all"


class XIntelService:
    _cache: dict[str, dict[str, Any]] = {}
    _cache_seconds: int = 120

    def __init__(
        self,
        session: Session,
        *,
        tenant_id: int | None = None,
        user_id: int | None = None,
        is_super_admin: bool = False,
    ) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.user_id = user_id
        self.is_super_admin = is_super_admin
        self.sentiment_service = XIntelSentimentService()
        self.narrative_service = NarrativeService()
        self.account_risk_service = AccountRiskService()
        self.influence_service = InfluenceService()
        self.coordination_service = CoordinationService()
        self.ai_brief_service = AIBriefService(
            session=session,
            user_id=user_id,
            tenant_id=tenant_id,
        )

    def fetchPosts(self, filters: XIntelFilters, refresh: bool = False) -> list[XPost]:
        posts, _ = self._collect_posts(filters, refresh=refresh)
        return posts

    def _collect_posts(self, filters: XIntelFilters, refresh: bool = False) -> tuple[list[XPost], dict[str, Any]]:
        cache_key = self._cache_key("posts", filters)
        cached = self._cache_get(cache_key, refresh=refresh)
        if cached is not None:
            if isinstance(cached, dict):
                return list(cached.get("posts") or []), dict(cached.get("diagnostics") or {})
            if isinstance(cached, list):
                # Backward compatibility for caches generated before diagnostics.
                fallback_diag = self._empty_diagnostics()
                fallback_diag["total_posts_collected"] = len(cached)
                fallback_diag["posts_after_normalization"] = len(cached)
                fallback_diag["posts_after_relevance_filter"] = len(cached)
                fallback_diag["posts_after_ranking_filter"] = len(cached)
                fallback_diag["source_class_counts_after_display"] = dict(Counter(post.source_class for post in cached))
                return cached, fallback_diag

        now = datetime.now(timezone.utc)
        window = parse_time_window(filters.time_window)
        cutoff = now - window
        markers = build_country_markers(filters.region_preset, filters.country, filters.custom_country)
        lang_pref = (filters.language or "both").strip().lower()
        source_filter = normalize_x_source_filter(filters.source_class)
        policy = get_source_policy_for_feature("x_narrative_intelligence")

        diagnostics = self._empty_diagnostics()
        x_api_stats: dict[str, int] = {"api_calls": 0, "rows": 0}
        query = select(Event).where(Event.source_type == "social", Event.event_time >= cutoff).order_by(desc(Event.event_time)).limit(3000)
        if self.tenant_id is not None and not self.is_super_admin:
            query = query.where(Event.tenant_id == self.tenant_id)
        rows = self.session.exec(query).all()
        diagnostics["db_social_rows"] = len(rows)

        posts: list[XPost] = []
        for row in rows:
            post = self._event_to_post(row)
            if post is None:
                continue
            if not self._is_x_like(post):
                continue
            posts.append(post)
        diagnostics["db_x_like_rows"] = len(posts)

        if filters.include_live:
            try:
                live_seeded = self._fetch_live_x_posts(limit=220, api_stats=x_api_stats)
            except TypeError:
                # Backward compatibility for tests that monkeypatch with old signature.
                live_seeded = self._fetch_live_x_posts(limit=220)
            diagnostics["seed_live_posts_collected"] = len(live_seeded)
            posts.extend(live_seeded)
            if policy.open_public_discovery:
                try:
                    public_live = self._fetch_open_public_discovery_posts(
                        filters,
                        markers,
                        limit=360,
                        api_stats=x_api_stats,
                    )
                except TypeError:
                    # Backward compatibility for tests that monkeypatch with old signature.
                    public_live = self._fetch_open_public_discovery_posts(
                        filters,
                        markers,
                        limit=360,
                    )
                diagnostics["open_discovery_posts_collected"] = len(public_live)
                posts.extend(public_live)

        diagnostics["x_api_calls"] = int(x_api_stats.get("api_calls", 0))
        diagnostics["x_api_rows"] = int(x_api_stats.get("rows", 0))
        if diagnostics["x_api_calls"] > 0 and self.user_id:
            track_x_api_usage(
                self.session,
                user_id=self.user_id,
                tenant_id=self.tenant_id,
                endpoint="/x-intel/dashboard",
                calls=diagnostics["x_api_calls"],
            )

        diagnostics["total_posts_collected"] = len(posts)

        deduped = self._dedupe_posts(posts)
        for post in deduped:
            post.source_class = classify_x_source(
                source_name=post.raw_source,
                author_username=post.author_username,
                url=post.url,
                text=post.text,
            )
        diagnostics["posts_after_normalization"] = len(deduped)
        diagnostics["total_public_posts_collected"] = sum(1 for post in deduped if post.source_class == "public_user")
        diagnostics["total_unknown_posts_collected"] = sum(1 for post in deduped if post.source_class == "unknown")
        diagnostics["source_class_counts_after_normalization"] = dict(Counter(post.source_class for post in deduped))

        scoped = [post for post in deduped if self._country_scope_match(post, markers)]
        scoped = self._filter_language(scoped, lang_pref)
        scoped = [post for post in scoped if x_source_class_allowed(post.source_class, source_filter)]
        if not policy.suspicious_accounts_included:
            scoped = [post for post in scoped if post.source_class != "watchlist_candidate"]
        diagnostics["posts_after_relevance_filter"] = len(scoped)

        ranked = self._rank_posts_for_display(scoped, markers=markers, filters=filters)
        scoped = [row["post"] for row in ranked[:1200]]
        diagnostics["posts_after_ranking_filter"] = len(scoped)
        diagnostics["source_class_counts_after_ranking"] = dict(Counter(post.source_class for post in scoped))

        self._cache_set(
            cache_key,
            {
                "posts": scoped,
                "diagnostics": diagnostics,
            },
        )
        return scoped, diagnostics

    def extractHashtags(self, posts: list[XPost]) -> dict[str, dict[str, Any]]:
        by_tag: dict[str, dict[str, Any]] = {}
        now = datetime.now(timezone.utc)
        for post in posts:
            age_hours = max(0.0, (now - post.created_at).total_seconds() / 3600.0)
            for tag in post.hashtags:
                key = tag.lower()
                row = by_tag.setdefault(
                    key,
                    {
                        "hashtag": f"#{tag}",
                        "post_count": 0,
                        "authors": set(),
                        "engagement": 0,
                        "ages": [],
                        "posts": [],
                        "first_seen": post.created_at,
                        "last_seen": post.created_at,
                        "recent_half": 0,
                        "early_half": 0,
                    },
                )
                row["post_count"] += 1
                row["authors"].add(post.author_username)
                row["engagement"] += post.engagement
                row["ages"].append(age_hours)
                if len(row["posts"]) < 10:
                    row["posts"].append(post)
                if post.created_at < row["first_seen"]:
                    row["first_seen"] = post.created_at
                if post.created_at > row["last_seen"]:
                    row["last_seen"] = post.created_at
        return by_tag

    def rankHashtags(self, posts: list[XPost], sentiment_scores: dict[str, float], filters: XIntelFilters) -> dict[str, Any]:
        by_tag = self.extractHashtags(posts)
        if not by_tag:
            return {"top_now": None, "fastest_rising": None, "ranking": [], "trend_chart": []}

        now = datetime.now(timezone.utc)
        window_seconds = max(3600.0, parse_time_window(filters.time_window).total_seconds())
        half_cut = now.timestamp() - (window_seconds / 2)

        rows: list[dict[str, Any]] = []
        for row in by_tag.values():
            early = 0
            recent = 0
            sentiment_list: list[float] = []
            for post in row["posts"]:
                if post.created_at.timestamp() >= half_cut:
                    recent += 1
                else:
                    early += 1
                sentiment_list.append(sentiment_scores.get(post.post_id, 0.0))
            growth = (recent - early) / max(1, early)
            row["early_half"] = early
            row["recent_half"] = recent
            recency = 1.0 / (1.0 + (sum(row["ages"]) / max(1, len(row["ages"]))))
            rows.append(
                {
                    "hashtag": row["hashtag"],
                    "post_count": row["post_count"],
                    "growth_rate": round(growth, 3),
                    "unique_authors": len(row["authors"]),
                    "engagement": int(row["engagement"]),
                    "recency": round(recency, 3),
                    "sentiment": round(sum(sentiment_list) / max(1, len(sentiment_list)), 3),
                }
            )

        self._apply_hashtag_scores(rows)
        for row in rows:
            row["risk_label"] = self._risk_label_for_hashtag(row, filters.threat_sensitivity)
        rows.sort(key=lambda item: item["trend_score"], reverse=True)

        top_now = rows[0] if rows else None
        fastest = max(rows, key=lambda item: item["growth_rate"]) if rows else None
        trend_chart = [{"hashtag": row["hashtag"], "trend_score": row["trend_score"]} for row in rows[:12]]
        return {
            "top_now": top_now,
            "fastest_rising": fastest,
            "ranking": rows[:40],
            "trend_chart": trend_chart,
        }

    def analyzeSentiment(self, posts: list[XPost], window_key: str) -> dict[str, Any]:
        return self.sentiment_service.analyzeSentiment(posts, window_key)

    def detectNarratives(self, posts: list[XPost], post_sentiment: dict[str, float], window_key: str) -> dict[str, Any]:
        return self.narrative_service.detectNarratives(posts, post_sentiment, window_key)

    def buildNarrativeTimeline(self, narratives: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self.narrative_service.buildNarrativeTimeline(narratives)

    def profileAccounts(self, posts: list[XPost], post_sentiment: dict[str, float], markers: list[str]) -> dict[str, Any]:
        return self.account_risk_service.profileAccounts(posts, post_sentiment, markers)

    def scoreHostileAccounts(
        self,
        profiles: list[dict[str, Any]],
        coordination_scores: dict[str, float],
        threat_sensitivity: str,
        country: str,
    ) -> list[dict[str, Any]]:
        return self.account_risk_service.scoreHostileAccounts(
            profiles, coordination_scores, threat_sensitivity, target_country=country
        )

    def detectCoordination(self, posts: list[XPost]) -> dict[str, Any]:
        return self.coordination_service.detectCoordination(posts)

    def buildInfluenceMap(self, posts: list[XPost]) -> dict[str, Any]:
        return self.influence_service.buildInfluenceMap(posts)

    def generateIntelBrief(self, snapshot: dict[str, Any], filters: XIntelFilters) -> dict[str, Any]:
        return self.ai_brief_service.generateIntelBrief(snapshot, filters.__dict__)

    def build_dashboard(self, filters: XIntelFilters, refresh: bool = False) -> dict[str, Any]:
        cache_key = self._cache_key("dashboard", filters)
        cached = self._cache_get(cache_key, refresh=refresh)
        if cached is not None:
            return cached

        posts, diagnostics = self._collect_posts(filters, refresh=refresh)
        sentiment = self.analyzeSentiment(posts, filters.time_window)
        scored_rows = sentiment.pop("scored_rows", [])
        post_sentiment = {post.post_id: score for post, _, score in scored_rows}
        hashtags = self.rankHashtags(posts, post_sentiment, filters)
        narratives = self.detectNarratives(posts, post_sentiment, filters.time_window)
        coordination = self.detectCoordination(posts)
        influence = self.buildInfluenceMap(posts)
        markers = build_country_markers(filters.region_preset, filters.country, filters.custom_country)
        account_profiles = self.profileAccounts(posts, post_sentiment, markers)
        watchlist_accounts = self.scoreHostileAccounts(
            account_profiles.get("profiles", []),
            coordination.get("account_scores", {}),
            filters.threat_sensitivity,
            filters.country,
        )

        sentiment_per_hashtag = self._sentiment_per_hashtag(posts, post_sentiment)
        sentiment_per_topic = self._sentiment_per_topic(narratives)
        sentiment["per_hashtag"] = sentiment_per_hashtag
        sentiment["per_topic"] = sentiment_per_topic

        early_warning = self._early_warning(hashtags, sentiment, narratives, influence)
        overview = self._overview(posts, hashtags, watchlist_accounts, coordination, early_warning)
        post_views = self._build_post_views(
            posts=posts,
            post_sentiment=post_sentiment,
            filters=filters,
            markers=markers,
            watchlist_accounts=watchlist_accounts,
        )
        source_class_counts = dict(Counter(post.source_class for post in posts))
        diagnostics["displayed_public_posts_count"] = int(post_views.get("displayed_public_posts_count") or 0)
        diagnostics["source_class_counts_after_display"] = source_class_counts
        diagnostics["official_count"] = int(
            source_class_counts.get("official", 0) + source_class_counts.get("semi_official", 0)
        )
        diagnostics["media_count"] = int(
            source_class_counts.get("major_media", 0)
            + source_class_counts.get("regional_media", 0)
            + source_class_counts.get("journalist", 0)
        )
        diagnostics["public_count"] = int(
            source_class_counts.get("public_user", 0) + source_class_counts.get("commentator", 0)
        )
        diagnostics["unknown_count"] = int(source_class_counts.get("unknown", 0))
        diagnostics["suspicious_count"] = int(source_class_counts.get("watchlist_candidate", 0))
        data = {
            "filters": filters.__dict__,
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "overview": overview,
            "source_classes": {
                "active_filter": normalize_x_source_filter(filters.source_class),
                "counts": source_class_counts,
            },
            "diagnostics": diagnostics,
            "hashtags": hashtags,
            "sentiment": sentiment,
            "narratives": narratives,
            "posts": post_views,
            "watchlist": {
                "accounts": watchlist_accounts,
                "disclaimer": (
                    "Accounts shown in this watchlist are flagged using heuristic behavioral and narrative signals. "
                    "These indicators do not constitute proof of malicious intent and require analyst verification."
                ),
            },
            "network": {
                "coordination_pairs": coordination.get("pairs", []),
                "clusters": coordination.get("clusters", []),
                "phrase_similarity_groups": coordination.get("phrase_similarity_groups", []),
            },
            "influence": influence,
            "early_warning": early_warning,
        }
        self._cache_set(cache_key, data)
        return data

    def explain_hashtag(self, dashboard: dict[str, Any], hashtag: str) -> dict[str, Any]:
        target = str(hashtag or "").strip().lstrip("#").lower()
        ranking = dashboard.get("hashtags", {}).get("ranking", [])
        for row in ranking:
            row_tag = str(row.get("hashtag") or "").lstrip("#").lower()
            if row_tag != target:
                continue
            return {
                "hashtag": row.get("hashtag"),
                "why_trending": (
                    f"الوسم {row.get('hashtag')} يتصدر بسبب حجم منشورات ({row.get('post_count')}) "
                    f"ومعدل نمو ({row.get('growth_rate')}) ومشاركة ({row.get('unique_authors')} حسابًا) "
                    f"وتفاعل ({row.get('engagement')})."
                ),
                "metrics": row,
            }
        return {"hashtag": f"#{target}" if target else "#", "why_trending": "لا تتوفر بيانات كافية لهذا الوسم.", "metrics": {}}

    def _event_to_post(self, row: Event) -> XPost | None:
        text = (row.summary or row.title or "").strip()
        if not text:
            return None
        details = parse_details_map(row.details)
        username = str(details.get("author", "")).strip().lstrip("@") or f"user_{row.id}"
        lang = str(details.get("lang") or "").strip().lower()
        if lang not in {"ar", "en"}:
            lang = detect_language(text)
        likes = safe_int(details.get("likes"))
        reposts = safe_int(details.get("reposts"))
        replies = safe_int(details.get("replies"))
        created_at = ensure_utc(row.event_time)
        tags = extract_hashtags(text)
        mentions = extract_mentions(text)
        inferred_location = (row.location or details.get("location") or details.get("geo") or "").strip()
        post_id = str(row.external_id or row.id)
        url = str(row.url or "").strip()
        return XPost(
            post_id=post_id,
            text=text,
            created_at=created_at,
            lang=lang,
            author_username=username,
            author_display_name=username,
            author_id=str(details.get("author_id") or ""),
            url=url,
            hashtags=tags,
            mentions=mentions,
            likes=likes,
            reposts=reposts,
            replies=replies,
            engagement=max(0, likes + reposts + replies),
            inferred_location=inferred_location,
            raw_source=row.source_name,
            source_kind="db",
        )

    def _raw_to_post(self, raw: RawEvent) -> XPost | None:
        text = (raw.summary or raw.title or "").strip()
        if not text:
            return None
        details = parse_details_map(raw.details)
        username = str(details.get("author", "")).strip().lstrip("@") or "unknown"
        created_at = ensure_utc(raw.event_time)
        tags = extract_hashtags(text)
        mentions = extract_mentions(text)
        likes = safe_int(details.get("likes"))
        reposts = safe_int(details.get("reposts"))
        replies = safe_int(details.get("replies"))
        lang = detect_language(text)
        post_id = str(raw.external_id or raw.url or f"xapi-{abs(hash(text))}")
        return XPost(
            post_id=post_id,
            text=text,
            created_at=created_at,
            lang=lang,
            author_username=username,
            author_display_name=username,
            author_id="",
            url=str(raw.url or "").strip(),
            hashtags=tags,
            mentions=mentions,
            likes=likes,
            reposts=reposts,
            replies=replies,
            engagement=max(0, likes + reposts + replies),
            inferred_location="",
            raw_source="X API live",
            source_kind="x_api",
        )

    def _is_x_like(self, post: XPost) -> bool:
        host = host_from_url(post.url)
        if host.endswith("x.com") or host.endswith("twitter.com"):
            return True
        source = (post.raw_source or "").lower()
        if source.startswith("x ") or source == "x":
            return True
        return " x " in f" {source} "

    def _fetch_live_x_posts(self, limit: int = 200, api_stats: dict[str, int] | None = None) -> list[XPost]:
        query = select(Source).where(Source.source_type == "social", Source.enabled == True)  # noqa: E712
        if self.tenant_id is not None and not self.is_super_admin:
            query = query.where(Source.tenant_id == self.tenant_id)
        sources = self.session.exec(query.order_by(desc(Source.created_at))).all()
        x_sources = [
            row
            for row in sources
            if (row.parser_hint or "").strip().lower() in {"x_recent", "x_api_v2", "twitter_recent"}
            or "api.x.com/2" in (row.endpoint or "").strip().lower()
            or "api.twitter.com/2" in (row.endpoint or "").strip().lower()
        ]
        if not x_sources:
            return []

        per_source_limit = max(10, min(80, limit // max(1, len(x_sources))))
        out: list[XPost] = []
        for source in x_sources[:4]:
            try:
                rows = fetch_x_recent(source.endpoint, limit=per_source_limit, stats=api_stats)
            except Exception:
                rows = []
            for raw in rows:
                parsed = self._raw_to_post(raw)
                if parsed is None:
                    continue
                out.append(parsed)
        return out

    def _fetch_open_public_discovery_posts(
        self,
        filters: XIntelFilters,
        markers: list[str],
        *,
        limit: int = 300,
        api_stats: dict[str, int] | None = None,
    ) -> list[XPost]:
        token = (settings.x_api_bearer_token or settings.x_api_key or "").strip()
        if not token:
            return []
        query_pack = build_public_discovery_queries(
            region_preset=filters.region_preset,
            country=filters.country,
            custom_country=filters.custom_country,
            markers=markers,
            seed_hashtags=None,
        )
        rows = self._run_open_discovery_queries(query_pack, total_limit=max(80, limit), api_stats=api_stats)
        if not rows:
            return []

        # Expansion: co-occurring hashtags + account/conversation expansion.
        seeded_hashtags = self._top_hashtags(rows, limit=8)
        if seeded_hashtags:
            expanded_pack = build_public_discovery_queries(
                region_preset=filters.region_preset,
                country=filters.country,
                custom_country=filters.custom_country,
                markers=markers,
                seed_hashtags=seeded_hashtags,
            )
            rows.extend(self._run_open_discovery_queries(expanded_pack, total_limit=max(40, limit // 3), api_stats=api_stats))

        rows.extend(self._run_author_expansion(rows, total_limit=max(20, limit // 4), api_stats=api_stats))
        rows.extend(self._run_conversation_expansion(rows, total_limit=max(20, limit // 4), api_stats=api_stats))

        posts: list[XPost] = []
        for raw in rows:
            post = self._raw_to_post(raw)
            if post is None:
                continue
            # Preserve signal that this came from open public discovery.
            post.source_kind = "x_api_public"
            posts.append(post)
        return posts

    def _run_open_discovery_queries(
        self,
        query_pack: dict[str, list[str]],
        *,
        total_limit: int,
        api_stats: dict[str, int] | None = None,
    ) -> list[RawEvent]:
        all_queries = [*query_pack.get("keyword_pack", []), *query_pack.get("hashtag_pack", []), *query_pack.get("entity_pack", [])]
        if not all_queries:
            return []
        queries = all_queries[:8]
        per_query_limit = max(10, min(35, int(total_limit / max(1, len(queries)))))
        out: list[RawEvent] = []
        base_url = settings.x_api_base_url
        for query in queries:
            endpoint = build_x_search_endpoint(base_url, query, per_query_limit)
            try:
                out.extend(fetch_x_recent(endpoint, limit=per_query_limit, stats=api_stats))
            except Exception:
                continue
        return out

    def _run_author_expansion(
        self,
        rows: list[RawEvent],
        *,
        total_limit: int,
        api_stats: dict[str, int] | None = None,
    ) -> list[RawEvent]:
        if not rows:
            return []
        handles: list[str] = []
        seen: set[str] = set()
        for raw in rows:
            details = parse_details_map(raw.details)
            handle = str(details.get("author") or "").strip().lstrip("@")
            if not handle:
                continue
            low = handle.lower()
            if low in seen:
                continue
            seen.add(low)
            handles.append(handle)
            if len(handles) >= 6:
                break
        if not handles:
            return []
        per_query_limit = max(10, min(20, int(total_limit / max(1, len(handles)))))
        out: list[RawEvent] = []
        for handle in handles:
            query = f"(from:{handle} OR @{handle}) -is:retweet"
            endpoint = build_x_search_endpoint(settings.x_api_base_url, query, per_query_limit)
            try:
                out.extend(fetch_x_recent(endpoint, limit=per_query_limit, stats=api_stats))
            except Exception:
                continue
        return out

    def _run_conversation_expansion(
        self,
        rows: list[RawEvent],
        *,
        total_limit: int,
        api_stats: dict[str, int] | None = None,
    ) -> list[RawEvent]:
        if not rows:
            return []
        ids: list[str] = []
        seen: set[str] = set()
        for raw in rows:
            post_id = str(raw.external_id or "").strip()
            if not post_id or post_id in seen:
                continue
            seen.add(post_id)
            ids.append(post_id)
            if len(ids) >= 5:
                break
        if not ids:
            return []
        per_query_limit = max(10, min(20, int(total_limit / max(1, len(ids)))))
        out: list[RawEvent] = []
        for post_id in ids:
            query = f"(conversation_id:{post_id} OR url:\"x.com/i/web/status/{post_id}\") -is:retweet"
            endpoint = build_x_search_endpoint(settings.x_api_base_url, query, per_query_limit)
            try:
                out.extend(fetch_x_recent(endpoint, limit=per_query_limit, stats=api_stats))
            except Exception:
                continue
        return out

    def _dedupe_posts(self, posts: list[XPost]) -> list[XPost]:
        by_key: dict[str, XPost] = {}
        for post in posts:
            key = post.post_id or f"{post.author_username}|{post.created_at.isoformat()}|{post.text[:80]}"
            existing = by_key.get(key)
            if existing is None or post.created_at > existing.created_at:
                by_key[key] = post
        return list(by_key.values())

    def _top_hashtags(self, rows: list[RawEvent], *, limit: int = 8) -> list[str]:
        tags: Counter[str] = Counter()
        for raw in rows:
            text = f"{raw.title or ''} {raw.summary or ''}".strip()
            for tag in extract_hashtags(text):
                norm = tag.lower().lstrip("#")
                if len(norm) < 2:
                    continue
                tags[norm] += 1
        out: list[str] = []
        for tag, _count in tags.most_common(limit):
            out.append(tag)
        return out

    def _country_scope_match(self, post: XPost, markers: list[str]) -> bool:
        # Public discovery queries are already country-scoped. Do not over-filter them.
        if str(post.source_kind or "").strip().lower() == "x_api_public":
            return True
        return country_match(post, markers)

    def _filter_language(self, posts: list[XPost], language: str) -> list[XPost]:
        if language == "both":
            return posts
        if language == "arabic":
            return [post for post in posts if post.lang == "ar"]
        if language == "english":
            return [post for post in posts if post.lang == "en"]
        return posts

    def _empty_diagnostics(self) -> dict[str, Any]:
        return {
            "db_social_rows": 0,
            "db_x_like_rows": 0,
            "seed_live_posts_collected": 0,
            "open_discovery_posts_collected": 0,
            "x_api_calls": 0,
            "x_api_rows": 0,
            "total_posts_collected": 0,
            "total_public_posts_collected": 0,
            "total_unknown_posts_collected": 0,
            "posts_after_normalization": 0,
            "posts_after_relevance_filter": 0,
            "posts_after_ranking_filter": 0,
            "displayed_public_posts_count": 0,
            "official_count": 0,
            "media_count": 0,
            "public_count": 0,
            "unknown_count": 0,
            "suspicious_count": 0,
            "source_class_counts_after_normalization": {},
            "source_class_counts_after_ranking": {},
            "source_class_counts_after_display": {},
        }

    def _rank_posts_for_display(
        self,
        posts: list[XPost],
        *,
        markers: list[str],
        filters: XIntelFilters,
        post_sentiment: dict[str, float] | None = None,
    ) -> list[dict[str, Any]]:
        if not posts:
            return []
        now = datetime.now(timezone.utc)
        hashtags = Counter(tag.lower() for post in posts for tag in post.hashtags)
        phrases = Counter(self._phrase_key(post.text) for post in posts if self._phrase_key(post.text))
        activity = Counter(post.author_username.lower() for post in posts)
        relevance_terms = self._ranking_terms(markers, filters)
        sentiment_map = post_sentiment or {}

        ranked: list[dict[str, Any]] = []
        for post in posts:
            text_norm = normalize_text(post.text)
            age_hours = max(0.0, (now - post.created_at).total_seconds() / 3600.0)
            recency = 1.0 / (1.0 + (age_hours / 3.0))
            relevance = self._text_relevance(text_norm, relevance_terms)
            engagement = min(1.0, float(post.engagement) / 200.0)
            hashtag_density = 0.0
            if post.hashtags:
                hashtag_density = min(
                    1.0,
                    sum(max(0, hashtags.get(tag.lower(), 0) - 1) for tag in post.hashtags) / max(1.0, len(post.hashtags) * 6.0),
                )
            phrase = self._phrase_key(post.text)
            novelty = 1.0
            if phrase:
                novelty = max(0.0, 1.0 - ((phrases.get(phrase, 1) - 1) / 8.0))
            velocity = min(1.0, activity.get(post.author_username.lower(), 1) / 8.0)
            sentiment_value = float(sentiment_map.get(post.post_id, 0.0))

            class_boost = 0.0
            if post.source_class in {"public_user", "unknown", "commentator"}:
                class_boost += 0.06
            elif post.source_class in {"official", "semi_official"}:
                class_boost -= 0.02

            score = (
                0.30 * relevance
                + 0.22 * recency
                + 0.14 * hashtag_density
                + 0.12 * novelty
                + 0.12 * engagement
                + 0.10 * velocity
                + class_boost
            )

            # Low-volume public signal protection:
            # keep highly relevant public/unknown posts visible even if engagement is low.
            if post.source_class in {"public_user", "unknown"} and relevance >= 0.60:
                score = max(score, 0.66 + (0.05 if recency >= 0.5 else 0.0))
            if post.source_class in {"public_user", "unknown"} and relevance >= 0.40 and hashtag_density >= 0.30:
                score += 0.04

            ranked.append(
                {
                    "post": post,
                    "score": round(max(0.0, min(1.0, score)), 4),
                    "relevance": round(relevance, 4),
                    "recency": round(recency, 4),
                    "engagement_norm": round(engagement, 4),
                    "velocity": round(velocity, 4),
                    "novelty": round(novelty, 4),
                    "cluster_centrality": round(hashtag_density, 4),
                    "sentiment": round(sentiment_value, 3),
                }
            )
        ranked.sort(key=lambda row: (row["score"], row["post"].created_at), reverse=True)
        return ranked

    def _ranking_terms(self, markers: list[str], filters: XIntelFilters) -> set[str]:
        base = {
            "uae",
            "emirates",
            "dubai",
            "abu dhabi",
            "gulf",
            "iran",
            "war",
            "missile",
            "drone",
            "interception",
            "air defense",
            "airspace",
            "airport",
            "flight",
            "maritime",
            "port",
            "shipping",
            "politics",
            "diplomacy",
            "\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a",
            "\u062f\u0628\u064a",
            "\u0623\u0628\u0648\u0638\u0628\u064a",
            "\u0627\u0644\u062e\u0644\u064a\u062c",
            "\u0625\u064a\u0631\u0627\u0646",
            "\u0635\u0627\u0631\u0648\u062e",
            "\u0645\u0633\u064a\u0631\u0629",
            "\u0627\u0639\u062a\u0631\u0627\u0636",
            "\u062f\u0641\u0627\u0639 \u062c\u0648\u064a",
            "\u0637\u064a\u0631\u0627\u0646",
            "\u0645\u0637\u0627\u0631",
            "\u0645\u0644\u0627\u062d\u0629",
            "\u0645\u064a\u0646\u0627\u0621",
            "\u062f\u0628\u0644\u0648\u0645\u0627\u0633\u064a",
            "\u0633\u064a\u0627\u0633\u064a",
        }
        for marker in markers:
            val = normalize_text(marker)
            if val:
                base.add(val)
        for field in (filters.country, filters.region_preset, filters.custom_country):
            val = normalize_text(str(field or ""))
            if val:
                base.add(val)
        return {item for item in base if item}

    def _text_relevance(self, text_norm: str, terms: set[str]) -> float:
        if not text_norm:
            return 0.0
        hits = 0.0
        for term in terms:
            if term and term in text_norm:
                # Longer entities should contribute a bit more.
                hits += min(1.6, 0.35 + (len(term) / 22.0))
        if hits <= 0:
            return 0.0
        return min(1.0, hits / 6.0)

    def _phrase_key(self, text: str) -> str:
        tokens = normalize_text(text).split()
        if len(tokens) < 3:
            return ""
        return " ".join(tokens[:8])

    def _apply_hashtag_scores(self, rows: list[dict[str, Any]]) -> None:
        def normalize(values: list[float]) -> list[float]:
            if not values:
                return []
            lo = min(values)
            hi = max(values)
            if hi - lo <= 1e-9:
                return [1.0 for _ in values]
            return [(value - lo) / (hi - lo) for value in values]

        n_post = normalize([float(row["post_count"]) for row in rows])
        n_growth = normalize([float(row["growth_rate"]) for row in rows])
        n_authors = normalize([float(row["unique_authors"]) for row in rows])
        n_engagement = normalize([float(row["engagement"]) for row in rows])
        for index, row in enumerate(rows):
            score = 0.35 * n_post[index] + 0.30 * n_growth[index] + 0.20 * n_authors[index] + 0.15 * n_engagement[index]
            row["trend_score"] = round(score * 100, 2)

    def _risk_label_for_hashtag(self, row: dict[str, Any], sensitivity: str) -> str:
        base = float(row.get("trend_score") or 0)
        sentiment = float(row.get("sentiment") or 0)
        score = base + (abs(min(0.0, sentiment)) * 25)
        if sensitivity == "high":
            hi, med = 70, 45
        elif sensitivity == "low":
            hi, med = 82, 58
        else:
            hi, med = 76, 50
        if score >= hi:
            return "High"
        if score >= med:
            return "Medium"
        return "Low"

    def _sentiment_per_hashtag(self, posts: list[XPost], post_sentiment: dict[str, float]) -> list[dict[str, Any]]:
        sums: dict[str, float] = defaultdict(float)
        counts: dict[str, int] = defaultdict(int)
        for post in posts:
            score = post_sentiment.get(post.post_id, 0.0)
            for tag in post.hashtags:
                key = f"#{tag}"
                sums[key] += score
                counts[key] += 1
        out = [
            {"hashtag": tag, "score": round(sums[tag] / max(1, counts[tag]), 3), "volume": counts[tag]}
            for tag in counts
        ]
        out.sort(key=lambda row: row["volume"], reverse=True)
        return out[:30]

    def _sentiment_per_topic(self, narratives: dict[str, Any]) -> list[dict[str, Any]]:
        out = [
            {
                "topic": row.get("topic"),
                "score": row.get("sentiment", 0.0),
                "volume": row.get("post_volume", 0),
            }
            for row in narratives.get("items", [])
        ]
        out.sort(key=lambda row: row["volume"], reverse=True)
        return out[:20]

    def _early_warning(
        self,
        hashtags: dict[str, Any],
        sentiment: dict[str, Any],
        narratives: dict[str, Any],
        influence: dict[str, Any],
    ) -> dict[str, Any]:
        top_growth = float((hashtags.get("fastest_rising") or {}).get("growth_rate") or 0.0)
        lang_break = sentiment.get("language_breakdown", {})
        ar_count = float((lang_break.get("arabic") or {}).get("count") or 0)
        en_count = float((lang_break.get("english") or {}).get("count") or 0)
        cross_lang_spread = min(1.0, min(ar_count, en_count) / max(1.0, max(ar_count, en_count)))
        timeline = sentiment.get("timeline", [])
        neg_spike = 0.0
        if len(timeline) >= 2:
            latest = float(timeline[-1].get("score") or 0)
            prev = float(timeline[-2].get("score") or 0)
            neg_spike = abs(min(0.0, latest - prev))
        narrative_items = narratives.get("items", [])
        concentration = 0.0
        if narrative_items:
            total = sum(float(item.get("post_volume") or 0) for item in narrative_items)
            top = max(float(item.get("post_volume") or 0) for item in narrative_items)
            concentration = top / max(1.0, total)
        leaders = influence.get("leaders", [])
        amplification = min(1.0, (float(leaders[0]["influence_score"]) / 100.0) if leaders else 0.0)

        risk = (
            0.30 * min(1.0, max(0.0, top_growth))
            + 0.20 * cross_lang_spread
            + 0.20 * min(1.0, neg_spike * 2)
            + 0.15 * concentration
            + 0.15 * amplification
        )
        score = round(risk * 100, 2)
        if score >= 80:
            level = "Critical"
        elif score >= 60:
            level = "High"
        elif score >= 40:
            level = "Moderate"
        else:
            level = "Low"
        return {
            "risk_score": score,
            "risk_level": level,
            "signals": {
                "rapid_hashtag_velocity": round(top_growth, 3),
                "cross_language_spread": round(cross_lang_spread, 3),
                "negative_spike": round(neg_spike, 3),
                "narrative_concentration": round(concentration, 3),
                "influencer_amplification": round(amplification, 3),
            },
        }

    def _build_post_views(
        self,
        *,
        posts: list[XPost],
        post_sentiment: dict[str, float],
        filters: XIntelFilters,
        markers: list[str],
        watchlist_accounts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        ranked = self._rank_posts_for_display(posts, markers=markers, filters=filters, post_sentiment=post_sentiment)
        watchlist_users = {str(row.get("username") or "").strip().lower() for row in watchlist_accounts}
        watchlist_users = {row for row in watchlist_users if row}

        official_classes = {"official", "semi_official"}
        media_classes = {"major_media", "regional_media", "journalist"}
        public_classes = {"public_user", "commentator", "unknown"}

        top_official_posts: list[dict[str, Any]] = []
        top_media_posts: list[dict[str, Any]] = []
        top_public_posts: list[dict[str, Any]] = []
        latest_public_posts: list[dict[str, Any]] = []
        emerging_public_posts: list[dict[str, Any]] = []
        narrative_evidence_posts: list[dict[str, Any]] = []
        suspicious_posts: list[dict[str, Any]] = []

        for row in ranked:
            post = row["post"]
            compact = self._compact_post(post=post, row=row, markers=markers)
            if post.source_class in official_classes and len(top_official_posts) < 20:
                top_official_posts.append(compact)
            if post.source_class in media_classes and len(top_media_posts) < 20:
                top_media_posts.append(compact)
            if post.source_class in public_classes and len(top_public_posts) < 24:
                top_public_posts.append(compact)
            if (
                (post.source_class == "watchlist_candidate" or post.author_username.lower() in watchlist_users)
                and len(suspicious_posts) < 20
            ):
                suspicious_posts.append(compact)
            if len(compact.get("narrative_tags") or []) > 0 and len(narrative_evidence_posts) < 24:
                narrative_evidence_posts.append(compact)

        latest_public_sorted = sorted(
            [row for row in ranked if row["post"].source_class in public_classes],
            key=lambda row: row["post"].created_at,
            reverse=True,
        )
        for row in latest_public_sorted[:24]:
            latest_public_posts.append(self._compact_post(post=row["post"], row=row, markers=markers))

        emerging_rows = sorted(
            [row for row in ranked if row["post"].source_class in public_classes],
            key=lambda row: (row["velocity"], row["recency"], row["relevance"], row["score"]),
            reverse=True,
        )
        for row in emerging_rows[:24]:
            emerging_public_posts.append(self._compact_post(post=row["post"], row=row, markers=markers))

        return {
            "top_official_posts": top_official_posts,
            "top_media_posts": top_media_posts,
            "top_public_posts": top_public_posts,
            "latest_public_posts": latest_public_posts,
            "emerging_public_posts": emerging_public_posts,
            "narrative_evidence_posts": narrative_evidence_posts,
            "suspicious_posts": suspicious_posts,
            "displayed_public_posts_count": len(top_public_posts) + len(latest_public_posts) + len(emerging_public_posts),
        }

    def _compact_post(self, *, post: XPost, row: dict[str, Any], markers: list[str]) -> dict[str, Any]:
        return {
            "post_id": post.post_id,
            "username": post.author_username,
            "display_name": post.author_display_name,
            "source_class": post.source_class,
            "created_at": post.created_at.isoformat(),
            "text": post.text[:350],
            "url": post.url,
            "relevance_score": round(float(row.get("relevance") or 0.0), 3),
            "ranking_score": round(float(row.get("score") or 0.0), 3),
            "sentiment": round(float(row.get("sentiment") or 0.0), 3),
            "engagement_summary": {
                "likes": int(post.likes),
                "reposts": int(post.reposts),
                "replies": int(post.replies),
                "total": int(post.engagement),
            },
            "country_tags": self._country_tags(post, markers),
            "narrative_tags": self._narrative_tags(post.text),
            "hashtags": [f"#{tag}" for tag in post.hashtags[:8]],
        }

    def _country_tags(self, post: XPost, markers: list[str]) -> list[str]:
        text_pool = normalize_text(" ".join([post.text, post.inferred_location, " ".join(post.hashtags)]))
        out: list[str] = []
        seen: set[str] = set()
        for marker in markers:
            val = normalize_text(marker)
            if not val or val in seen:
                continue
            if val in text_pool:
                seen.add(val)
                out.append(marker)
            if len(out) >= 4:
                break
        return out

    def _narrative_tags(self, text: str) -> list[str]:
        src = normalize_text(text)
        if not src:
            return []
        topic_markers: dict[str, tuple[str, ...]] = {
            "economy": ("economy", "trade", "market", "\u0627\u0642\u062a\u0635\u0627\u062f"),
            "politics": ("politics", "minister", "diplomacy", "\u0633\u064a\u0627\u0633", "\u062f\u0628\u0644\u0648\u0645\u0627\u0633"),
            "security": ("security", "missile", "drone", "intercept", "\u062f\u0641\u0627\u0639", "\u0627\u0639\u062a\u0631\u0627\u0636"),
            "aviation": ("flight", "airport", "airspace", "\u0637\u064a\u0631\u0627\u0646", "\u0645\u0637\u0627\u0631"),
            "maritime": ("ship", "port", "maritime", "\u0633\u0641\u064a\u0646", "\u0645\u064a\u0646\u0627\u0621"),
            "conflict": ("war", "strike", "attack", "\u062d\u0631\u0628", "\u0636\u0631\u0628", "\u0647\u062c\u0648\u0645"),
            "rumors": ("rumor", "fake", "disinfo", "\u0627\u0634\u0627\u0639", "\u0645\u0636\u0644\u0644"),
        }
        out: list[str] = []
        for topic, words in topic_markers.items():
            if any(word in src for word in words):
                out.append(topic)
        return out[:4]

    def _overview(
        self,
        posts: list[XPost],
        hashtags: dict[str, Any],
        watchlist_accounts: list[dict[str, Any]],
        coordination: dict[str, Any],
        early_warning: dict[str, Any],
    ) -> dict[str, Any]:
        unique_authors = len({post.author_username for post in posts})
        top_now = hashtags.get("top_now")
        fastest = hashtags.get("fastest_rising")
        return {
            "total_posts": len(posts),
            "unique_authors": unique_authors,
            "top_hashtag_now": top_now.get("hashtag") if isinstance(top_now, dict) else None,
            "fastest_rising_hashtag": fastest.get("hashtag") if isinstance(fastest, dict) else None,
            "watchlist_accounts": len(watchlist_accounts),
            "possible_coordination_pairs": len(coordination.get("pairs", [])),
            "narrative_risk_score": early_warning.get("risk_score", 0),
            "narrative_risk_level": early_warning.get("risk_level", "Low"),
            "source_class_counts": dict(Counter(post.source_class for post in posts)),
        }

    def _cache_key(self, suffix: str, filters: XIntelFilters) -> str:
        tenant_key = "global" if self.tenant_id is None else f"tenant-{self.tenant_id}"
        return (
            f"{tenant_key}|{suffix}|{filters.country}|{filters.region_preset}|{filters.custom_country}|"
            f"{filters.time_window}|{filters.language}|{filters.threat_sensitivity}|"
            f"{int(filters.include_live)}|{normalize_x_source_filter(filters.source_class)}"
        )

    def _cache_get(self, key: str, refresh: bool) -> Any | None:
        if refresh:
            return None
        row = self.__class__._cache.get(key)
        if not row:
            return None
        ts = float(row.get("ts") or 0.0)
        if (datetime.now(timezone.utc).timestamp() - ts) > self.__class__._cache_seconds:
            return None
        return row.get("value")

    def _cache_set(self, key: str, value: Any) -> None:
        self.__class__._cache[key] = {
            "ts": datetime.now(timezone.utc).timestamp(),
            "value": value,
        }
