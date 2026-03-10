from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

from app.services.xintel_common import XPost, normalize_text


HOSTILE_KEYWORDS = {
    "attack",
    "destroy",
    "collapse",
    "boycott",
    "threat",
    "chaos",
    "هجوم",
    "تدمير",
    "اسقاط",
    "مقاطعة",
    "تهديد",
    "فوضى",
}


class AccountRiskService:
    def profileAccounts(
        self,
        posts: list[XPost],
        post_sentiment: dict[str, float],
        country_markers: list[str],
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        grouped: dict[str, list[XPost]] = defaultdict(list)
        for post in posts:
            grouped[post.author_username].append(post)

        profiles: list[dict[str, Any]] = []
        for account, rows in grouped.items():
            rows.sort(key=lambda row: row.created_at, reverse=True)
            hours_span = max(1.0, (now - rows[-1].created_at).total_seconds() / 3600.0)
            posting_frequency = len(rows) / hours_span
            all_text = " ".join(normalize_text(post.text) for post in rows)
            tokens = all_text.split()
            hostile_hits = sum(1 for token in tokens if token in HOSTILE_KEYWORDS)
            marker_hits = sum(1 for marker in country_markers if normalize_text(marker) in all_text)
            negative_mentions = [
                post_sentiment.get(post.post_id, 0.0)
                for post in rows
                if any(normalize_text(marker) in normalize_text(post.text) for marker in country_markers)
            ]
            targeted_negative_sentiment = abs(min(0.0, sum(negative_mentions) / max(1, len(negative_mentions))))

            top_hashtags = Counter(tag.lower() for post in rows for tag in post.hashtags).most_common(5)
            recurring_phrases = self._top_phrases(rows)
            language = self._dominant_language(rows)
            inferred_location = next((post.inferred_location for post in rows if post.inferred_location), "")
            avg_engagement = sum(post.engagement for post in rows) / max(1, len(rows))

            profiles.append(
                {
                    "username": account,
                    "display_name": rows[0].author_display_name or account,
                    "account_age_days": None,
                    "followers": None,
                    "following": None,
                    "posting_frequency": round(posting_frequency, 3),
                    "language": language,
                    "inferred_location": inferred_location,
                    "hostile_keyword_density": hostile_hits / max(1, len(tokens)),
                    "anti_country_narrative_frequency": marker_hits / max(1, len(rows)),
                    "targeted_negative_sentiment": round(targeted_negative_sentiment, 3),
                    "abnormal_posting_pattern": min(1.0, posting_frequency / 6.0),
                    "engagement_anomaly": min(1.0, (posting_frequency / max(1.0, avg_engagement + 1.0))),
                    "top_hashtags": [row[0] for row in top_hashtags],
                    "recurring_phrases": recurring_phrases,
                    "sample_posts": [
                        {
                            "text": post.text[:220],
                            "created_at": post.created_at.isoformat(),
                            "url": post.url,
                        }
                        for post in rows[:4]
                    ],
                    "_post_count": len(rows),
                }
            )

        return {"profiles": profiles}

    def scoreHostileAccounts(
        self,
        profiles: list[dict[str, Any]],
        coordination_scores: dict[str, float],
        threat_sensitivity: str,
        target_country: str,
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in profiles:
            username = row["username"]
            coordination_similarity = float(coordination_scores.get(username, 0.0))
            bot_likelihood = min(1.0, 0.6 * row["abnormal_posting_pattern"] + 0.4 * row["engagement_anomaly"])

            hostility_score = (
                0.25 * row["hostile_keyword_density"]
                + 0.20 * row["anti_country_narrative_frequency"]
                + 0.15 * row["targeted_negative_sentiment"]
                + 0.15 * coordination_similarity
                + 0.10 * row["abnormal_posting_pattern"]
                + 0.10 * bot_likelihood
                + 0.05 * row["engagement_anomaly"]
            )
            coordination_score = (
                0.45 * coordination_similarity
                + 0.30 * row["abnormal_posting_pattern"]
                + 0.25 * bot_likelihood
            )

            level_threshold = {"low": 0.35, "medium": 0.27, "high": 0.20}.get((threat_sensitivity or "medium").lower(), 0.27)
            if hostility_score < level_threshold and coordination_score < level_threshold:
                continue

            labels: list[str] = []
            if hostility_score >= 0.45:
                labels.append("hostile narrative")
            if row["anti_country_narrative_frequency"] >= 0.4:
                labels.append("repeated anti-country messaging")
            if coordination_similarity >= 0.35:
                labels.append("possible coordination")
            if bot_likelihood >= 0.45:
                labels.append("bot-like behavior")
            if not labels:
                labels.append("suspicious amplification")

            out.append(
                {
                    "username": username,
                    "display_name": row["display_name"],
                    "account_age_days": row["account_age_days"],
                    "followers": row["followers"],
                    "following": row["following"],
                    "posting_frequency": row["posting_frequency"],
                    "language": row["language"],
                    "inferred_location": row["inferred_location"],
                    "hostility_score": round(hostility_score * 100, 2),
                    "coordination_score": round(coordination_score * 100, 2),
                    "bot_likelihood": round(bot_likelihood * 100, 2),
                    "target_country": target_country,
                    "top_hashtags": row["top_hashtags"],
                    "recurring_phrases": row["recurring_phrases"],
                    "sample_posts": row["sample_posts"],
                    "labels": labels,
                    "why_flagged": {
                        "hostile_keyword_density": round(row["hostile_keyword_density"], 3),
                        "anti_country_narrative_frequency": round(row["anti_country_narrative_frequency"], 3),
                        "targeted_negative_sentiment": round(row["targeted_negative_sentiment"], 3),
                        "coordination_similarity": round(coordination_similarity, 3),
                        "abnormal_posting_pattern": round(row["abnormal_posting_pattern"], 3),
                        "bot_likelihood": round(bot_likelihood, 3),
                        "engagement_anomaly": round(row["engagement_anomaly"], 3),
                    },
                }
            )

        out.sort(key=lambda item: (item["hostility_score"], item["coordination_score"]), reverse=True)
        return out[:120]

    def _dominant_language(self, posts: list[XPost]) -> str:
        counts = Counter(post.lang for post in posts)
        if not counts:
            return "unknown"
        winner = counts.most_common(1)[0][0]
        if winner == "ar":
            return "Arabic"
        if winner == "en":
            return "English"
        return "Mixed"

    def _top_phrases(self, posts: list[XPost]) -> list[str]:
        counter: Counter[str] = Counter()
        for post in posts:
            tokens = normalize_text(post.text).split()
            if len(tokens) < 4:
                continue
            phrase = " ".join(tokens[:8])
            counter[phrase] += 1
        return [phrase for phrase, _ in counter.most_common(5)]
