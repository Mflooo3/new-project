from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from app.services.ai_brief_service import AIBriefService
from app.services.x_intel_service import XIntelFilters, XIntelService
from app.services.xintel_common import XPost, build_country_markers


class _ExecResult:
    def __init__(self, rows):
        self._rows = list(rows or [])

    def all(self):
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows=None):
        self._rows = list(rows or [])

    def exec(self, _query):
        return _ExecResult(self._rows)


def _mk_post(
    *,
    post_id: str,
    text: str,
    username: str,
    created_at: datetime,
    likes: int = 0,
    reposts: int = 0,
    replies: int = 0,
    raw_source: str = "X API public discovery",
    source_kind: str = "x_api_public",
) -> XPost:
    return XPost(
        post_id=post_id,
        text=text,
        created_at=created_at,
        lang="ar",
        author_username=username,
        author_display_name=username,
        author_id=username,
        url=f"https://x.com/{username}/status/{post_id}",
        hashtags=[],
        mentions=[],
        likes=likes,
        reposts=reposts,
        replies=replies,
        engagement=max(0, likes + reposts + replies),
        inferred_location="UAE",
        raw_source=raw_source,
        source_kind=source_kind,
    )


class XNarrativePublicVisibilityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = XIntelService(session=_FakeSession([]))
        self.now = datetime.now(timezone.utc)
        self.public_post = _mk_post(
            post_id="p1",
            text="UAE defense update missile interception debate",
            username="citizen_voice",
            created_at=self.now - timedelta(minutes=8),
            likes=2,
            reposts=1,
            replies=1,
        )
        self.unknown_post = _mk_post(
            post_id="p2",
            text="Dubai airport airspace concern and flight delays",
            username="unknown",
            created_at=self.now - timedelta(minutes=12),
            likes=1,
            reposts=0,
            replies=1,
        )
        self.official_post = _mk_post(
            post_id="p3",
            text="UAE official briefing on security",
            username="moiuae",
            created_at=self.now - timedelta(minutes=4),
            likes=30,
            reposts=20,
            replies=8,
            raw_source="UAE Ministry Official X",
        )

    def test_x_narrative_collects_public_user_posts(self) -> None:
        self.service._fetch_live_x_posts = lambda limit=220: [self.official_post]
        self.service._fetch_open_public_discovery_posts = lambda filters, markers, limit=360: [self.public_post, self.unknown_post]
        filters = XIntelFilters(country="UAE", region_preset="UAE", include_live=True, source_class="all")
        posts, diagnostics = self.service._collect_posts(filters, refresh=True)
        classes = {post.source_class for post in posts}
        self.assertIn("public_user", classes)
        self.assertIn("unknown", classes)
        self.assertGreaterEqual(diagnostics["total_public_posts_collected"], 1)

    def test_x_narrative_displays_public_user_posts(self) -> None:
        self.service._fetch_live_x_posts = lambda limit=220: [self.official_post]
        self.service._fetch_open_public_discovery_posts = lambda filters, markers, limit=360: [self.public_post, self.unknown_post]
        filters = XIntelFilters(country="UAE", region_preset="UAE", include_live=True, source_class="all")
        dashboard = self.service.build_dashboard(filters, refresh=True)
        self.assertGreater(len(dashboard.get("posts", {}).get("top_public_posts", [])), 0)
        self.assertGreater(dashboard.get("diagnostics", {}).get("displayed_public_posts_count", 0), 0)

    def test_default_ranking_keeps_public_and_unknown(self) -> None:
        posts = [self.public_post, self.unknown_post, self.official_post]
        for post in posts:
            post.source_class = "unknown" if post.author_username == "unknown" else ("official" if post.author_username == "moiuae" else "public_user")
        markers = build_country_markers("UAE", "UAE", None)
        ranked = self.service._rank_posts_for_display(posts, markers=markers, filters=XIntelFilters())
        top_classes = [row["post"].source_class for row in ranked[:3]]
        self.assertIn("public_user", top_classes)
        self.assertIn("unknown", top_classes)

    def test_official_accounts_remain_supported(self) -> None:
        self.service._fetch_live_x_posts = lambda limit=220: [self.official_post]
        self.service._fetch_open_public_discovery_posts = lambda filters, markers, limit=360: [self.public_post]
        dashboard = self.service.build_dashboard(XIntelFilters(include_live=True), refresh=True)
        self.assertGreater(len(dashboard.get("posts", {}).get("top_official_posts", [])), 0)

    def test_source_class_filter_behaves_correctly(self) -> None:
        self.service._fetch_live_x_posts = lambda limit=220: [self.official_post]
        self.service._fetch_open_public_discovery_posts = lambda filters, markers, limit=360: [self.public_post, self.unknown_post]
        official_only = self.service.build_dashboard(XIntelFilters(include_live=True, source_class="official"), refresh=True)
        public_all = self.service.build_dashboard(XIntelFilters(include_live=True, source_class="all"), refresh=True)
        self.assertEqual(len(official_only.get("posts", {}).get("top_public_posts", [])), 0)
        self.assertGreater(len(public_all.get("posts", {}).get("top_public_posts", [])), 0)

    def test_diagnostics_show_filter_stages(self) -> None:
        self.service._fetch_live_x_posts = lambda limit=220: [self.official_post]
        self.service._fetch_open_public_discovery_posts = lambda filters, markers, limit=360: [self.public_post, self.unknown_post]
        dashboard = self.service.build_dashboard(XIntelFilters(include_live=True), refresh=True)
        diagnostics = dashboard.get("diagnostics", {})
        self.assertIn("total_posts_collected", diagnostics)
        self.assertIn("posts_after_normalization", diagnostics)
        self.assertIn("posts_after_relevance_filter", diagnostics)
        self.assertIn("posts_after_ranking_filter", diagnostics)
        self.assertIn("displayed_public_posts_count", diagnostics)
        self.assertGreaterEqual(diagnostics.get("posts_after_normalization", 0), diagnostics.get("posts_after_ranking_filter", 0))

    def test_ai_fallback_can_reference_public_discussion(self) -> None:
        service = AIBriefService()
        snapshot = {
            "overview": {"total_posts": 30},
            "hashtags": {"ranking": [{"hashtag": "#UAE"}], "fastest_rising": {"hashtag": "#Gulf"}},
            "sentiment": {"overall_score": 0.1, "distribution": {"positive": 3, "neutral": 20, "negative": 7}},
            "narratives": {"items": [{"topic": "security"}]},
            "watchlist": {"accounts": []},
            "network": {"coordination_pairs": []},
            "early_warning": {"risk_level": "Moderate", "risk_score": 44},
            "diagnostics": {"displayed_public_posts_count": 12},
            "posts": {
                "top_official_posts": [{}],
                "top_media_posts": [{}],
                "top_public_posts": [{}, {}],
                "suspicious_posts": [{}],
            },
            "influence": {"leaders": [{"username": "x"}]},
        }
        text = service._fallback_brief(snapshot, {"time_window": "24h"})
        self.assertIn("النقاش العام", text)


if __name__ == "__main__":
    unittest.main()
