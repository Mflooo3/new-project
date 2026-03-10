from __future__ import annotations

import unittest
from dataclasses import dataclass

from app.services.source_policy import (
    X_NARRATIVE_POLICY,
    event_allowed_for_feature,
    filter_events_for_feature,
    get_source_policy_for_feature,
    normalize_x_source_filter,
    x_source_class_allowed,
)
from app.services.trust import is_trusted_event


@dataclass
class _Row:
    source_type: str
    source_name: str
    url: str | None = None


class SourcePolicyIsolationTests(unittest.TestCase):
    def test_news_feed_policy_is_trusted_only(self) -> None:
        policy = get_source_policy_for_feature("news_feed")
        self.assertTrue(policy.trusted_only)
        self.assertEqual(policy.ranking_scope, "trusted_only")

    def test_open_discovery_does_not_leak_to_news_when_news_policy_is_applied(self) -> None:
        self.assertFalse(
            event_allowed_for_feature(
                feature_name="news_feed",
                source_type="social",
                source_name="Random Public X Feed",
                url="https://x.com/random_account/status/1",
            )
        )

    def test_x_narrative_allows_public_unknown_sources(self) -> None:
        self.assertTrue(
            event_allowed_for_feature(
                feature_name="x_narrative_intelligence",
                source_type="social",
                source_name="Random Public X Feed",
                url="https://x.com/random_account/status/1",
            )
        )

    def test_x_narrative_keeps_official_accounts_supported(self) -> None:
        self.assertTrue(
            x_source_class_allowed(
                "official",
                normalize_x_source_filter("official"),
            )
        )

    def test_feature_policies_are_isolated(self) -> None:
        news = get_source_policy_for_feature("news_feed")
        xintel = get_source_policy_for_feature("x_narrative_intelligence")
        self.assertNotEqual(news.trusted_only, xintel.trusted_only)
        self.assertEqual(xintel, X_NARRATIVE_POLICY)

    def test_ranking_scope_respects_active_policy(self) -> None:
        # "official" scope should not allow generic public-user rows into hashtag ranking input.
        self.assertFalse(x_source_class_allowed("public_user", "official"))
        self.assertTrue(x_source_class_allowed("major_media", "media"))

    def test_ai_news_uses_trusted_inputs_only(self) -> None:
        rows = [
            _Row(source_type="news", source_name="Sky News Arabia", url="https://www.skynewsarabia.com"),
            _Row(source_type="social", source_name="Unknown X Public", url="https://x.com/unknown/status/1"),
        ]
        filtered = filter_events_for_feature("ai_news", rows)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0].source_name, "Sky News Arabia")

    def test_ai_x_narrative_allows_broader_inputs(self) -> None:
        rows = [
            _Row(source_type="news", source_name="Sky News Arabia", url="https://www.skynewsarabia.com"),
            _Row(source_type="social", source_name="Unknown X Public", url="https://x.com/unknown/status/1"),
        ]
        filtered = filter_events_for_feature("ai_x_narrative", rows)
        self.assertEqual(len(filtered), 2)

    def test_existing_trusted_source_logic_still_works(self) -> None:
        self.assertTrue(is_trusted_event("news", "Sky News Arabia", "https://www.skynewsarabia.com"))
        self.assertFalse(is_trusted_event("news", "Unknown Random Feed", "https://untrusted-source.invalid/story"))


if __name__ == "__main__":
    unittest.main()
