from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from app.services.xintel_common import XPost, detect_language, normalize_text


POSITIVE_AR = {
    "استقرار",
    "امن",
    "تحسن",
    "تقدم",
    "اتفاق",
    "تعافي",
    "طمأنينة",
    "نجاح",
}
NEGATIVE_AR = {
    "هجوم",
    "تهديد",
    "حرب",
    "تصعيد",
    "اشاعة",
    "اشاعات",
    "ضربة",
    "صاروخ",
    "ازمة",
    "قلق",
    "خوف",
    "اصابة",
    "وفيات",
}
POSITIVE_EN = {
    "stable",
    "safety",
    "improvement",
    "progress",
    "agreement",
    "deescalation",
    "recovery",
    "success",
}
NEGATIVE_EN = {
    "attack",
    "threat",
    "war",
    "escalation",
    "rumor",
    "missile",
    "strike",
    "crisis",
    "fear",
    "injured",
    "fatalities",
}


class XIntelSentimentService:
    def analyzeSentiment(self, posts: list[XPost], window_key: str) -> dict[str, Any]:
        if not posts:
            return {
                "overall_score": 0.0,
                "distribution": {"positive": 0, "neutral": 0, "negative": 0},
                "timeline": [],
                "language_breakdown": {
                    "arabic": {"score": 0.0, "count": 0},
                    "english": {"score": 0.0, "count": 0},
                },
                "representative_posts": {"positive": [], "neutral": [], "negative": []},
            }

        scored_rows = []
        distribution = {"positive": 0, "neutral": 0, "negative": 0}
        lang_scores: dict[str, list[float]] = {"ar": [], "en": []}

        for post in posts:
            label, score = self.score_text(post.text, post.lang)
            scored_rows.append((post, label, score))
            distribution[label] += 1
            lang = post.lang if post.lang in {"ar", "en"} else detect_language(post.text)
            if lang in {"ar", "en"}:
                lang_scores[lang].append(score)

        overall_score = round(sum(score for _, _, score in scored_rows) / max(1, len(scored_rows)), 3)
        timeline = self._timeline(scored_rows, window_key)
        representative = self._representative_posts(scored_rows)

        return {
            "overall_score": overall_score,
            "distribution": distribution,
            "timeline": timeline,
            "language_breakdown": {
                "arabic": {
                    "score": round(sum(lang_scores["ar"]) / max(1, len(lang_scores["ar"])), 3),
                    "count": len(lang_scores["ar"]),
                },
                "english": {
                    "score": round(sum(lang_scores["en"]) / max(1, len(lang_scores["en"])), 3),
                    "count": len(lang_scores["en"]),
                },
            },
            "representative_posts": representative,
            "scored_rows": scored_rows,  # internal field consumed by orchestrator
        }

    def score_text(self, text: str, lang_hint: str | None = None) -> tuple[str, float]:
        normalized = normalize_text(text)
        tokens = normalized.split()
        if not tokens:
            return ("neutral", 0.0)

        lang = (lang_hint or "").strip().lower()
        if lang not in {"ar", "en"}:
            lang = detect_language(text)
        positive = POSITIVE_AR if lang == "ar" else POSITIVE_EN
        negative = NEGATIVE_AR if lang == "ar" else NEGATIVE_EN

        pos = sum(1 for token in tokens if token in positive)
        neg = sum(1 for token in tokens if token in negative)
        if pos == 0 and neg == 0:
            return ("neutral", 0.0)

        score = (pos - neg) / max(1, pos + neg)
        score = max(-1.0, min(1.0, score))
        if score > 0.2:
            return ("positive", round(score, 3))
        if score < -0.2:
            return ("negative", round(score, 3))
        return ("neutral", round(score, 3))

    def _timeline(self, scored_rows: list[tuple[XPost, str, float]], window_key: str) -> list[dict[str, Any]]:
        bucket_fmt = "%Y-%m-%d %H:00" if window_key in {"1h", "6h", "24h"} else "%Y-%m-%d"
        bucket_stats: dict[str, dict[str, float]] = defaultdict(lambda: {"sum": 0.0, "count": 0})
        for post, _, score in scored_rows:
            ts = post.created_at.astimezone(timezone.utc)
            key = ts.strftime(bucket_fmt)
            bucket_stats[key]["sum"] += score
            bucket_stats[key]["count"] += 1
        out: list[dict[str, Any]] = []
        for key in sorted(bucket_stats.keys()):
            row = bucket_stats[key]
            avg = row["sum"] / max(1, row["count"])
            out.append({"bucket": key, "score": round(avg, 3), "volume": int(row["count"])})
        return out

    def _representative_posts(self, scored_rows: list[tuple[XPost, str, float]]) -> dict[str, list[dict[str, Any]]]:
        buckets: dict[str, list[tuple[XPost, float]]] = {"positive": [], "neutral": [], "negative": []}
        for post, label, score in scored_rows:
            buckets[label].append((post, score))

        out: dict[str, list[dict[str, Any]]] = {"positive": [], "neutral": [], "negative": []}
        for label in ("positive", "neutral", "negative"):
            rows = buckets[label]
            if label == "neutral":
                rows.sort(key=lambda row: abs(row[1]))
            else:
                rows.sort(key=lambda row: abs(row[1]), reverse=True)
            for post, score in rows[:4]:
                out[label].append(
                    {
                        "username": post.author_username,
                        "text": post.text[:280],
                        "score": round(score, 3),
                        "created_at": post.created_at.isoformat(),
                        "url": post.url,
                    }
                )
        return out
