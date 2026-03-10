from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from app.services.xintel_common import XPost, normalize_text


NARRATIVE_KEYWORDS: dict[str, list[str]] = {
    "economy": ["economy", "markets", "trade", "inflation", "economy", "اقتصاد", "اسواق", "تجارة", "تضخم"],
    "politics": ["politics", "government", "minister", "diplomacy", "سياسة", "حكومة", "وزير", "دبلوماسية"],
    "security": ["security", "defense", "missile", "threat", "امن", "دفاع", "صاروخ", "تهديد"],
    "tourism": ["tourism", "travel", "airline", "hotel", "سياحة", "سفر", "طيران", "فنادق"],
    "energy": ["energy", "oil", "gas", "opec", "طاقة", "نفط", "غاز", "اوبك"],
    "conflict": ["conflict", "war", "strike", "attack", "نزاع", "حرب", "ضربة", "هجوم"],
    "rumors": ["rumor", "fake", "disinfo", "misleading", "اشاعة", "اشاعات", "مضلل", "كاذب"],
    "social_issues": ["society", "people", "community", "education", "مجتمع", "ناس", "تعليم", "خدمات"],
}


class NarrativeService:
    def detectNarratives(self, posts: list[XPost], post_sentiment: dict[str, float], window_key: str) -> dict[str, Any]:
        topic_rows: dict[str, dict[str, Any]] = {}
        topic_timeline: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

        for post in posts:
            text_norm = normalize_text(post.text)
            topics = self._topics_for_text(text_norm)
            if not topics:
                topics = ["social_issues"]
            bucket = self._bucket(post, window_key)
            score = post_sentiment.get(post.post_id, 0.0)

            for topic in topics:
                row = topic_rows.setdefault(
                    topic,
                    {
                        "topic": topic,
                        "post_volume": 0,
                        "sentiment_sum": 0.0,
                        "keywords_counter": Counter(),
                        "sample_posts": [],
                    },
                )
                row["post_volume"] += 1
                row["sentiment_sum"] += score
                row["keywords_counter"].update(self._keyword_hits(text_norm, topic))
                if len(row["sample_posts"]) < 5:
                    row["sample_posts"].append(
                        {
                            "username": post.author_username,
                            "text": post.text[:220],
                            "created_at": post.created_at.isoformat(),
                            "url": post.url,
                        }
                    )
                topic_timeline[topic][bucket] += 1

        narratives: list[dict[str, Any]] = []
        for topic, row in topic_rows.items():
            volume = int(row["post_volume"])
            avg_sent = row["sentiment_sum"] / max(1, volume)
            keywords = [word for word, _ in row["keywords_counter"].most_common(6)]
            narratives.append(
                {
                    "topic": topic,
                    "post_volume": volume,
                    "sentiment": round(avg_sent, 3),
                    "keywords": keywords,
                    "sample_posts": row["sample_posts"],
                    "timeline": [
                        {"bucket": bucket, "volume": int(count)}
                        for bucket, count in sorted(topic_timeline.get(topic, {}).items())
                    ],
                }
            )

        narratives.sort(key=lambda item: item["post_volume"], reverse=True)
        return {
            "items": narratives,
            "timeline": self.buildNarrativeTimeline(narratives),
        }

    def buildNarrativeTimeline(self, narratives: list[dict[str, Any]]) -> list[dict[str, Any]]:
        merged: dict[str, int] = defaultdict(int)
        for narrative in narratives:
            for row in narrative.get("timeline", []):
                merged[str(row.get("bucket") or "")] += int(row.get("volume") or 0)
        return [{"bucket": bucket, "volume": count} for bucket, count in sorted(merged.items()) if bucket]

    def _topics_for_text(self, text_norm: str) -> list[str]:
        out: list[str] = []
        for topic, keywords in NARRATIVE_KEYWORDS.items():
            if any(keyword in text_norm for keyword in keywords):
                out.append(topic)
        return out

    def _keyword_hits(self, text_norm: str, topic: str) -> list[str]:
        hits: list[str] = []
        for keyword in NARRATIVE_KEYWORDS.get(topic, []):
            if keyword in text_norm:
                hits.append(keyword)
        return hits

    def _bucket(self, post: XPost, window_key: str) -> str:
        fmt = "%Y-%m-%d %H:00" if window_key in {"1h", "6h", "24h"} else "%Y-%m-%d"
        return post.created_at.strftime(fmt)
