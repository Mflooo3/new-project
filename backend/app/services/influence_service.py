from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.services.xintel_common import XPost


class InfluenceService:
    def buildInfluenceMap(self, posts: list[XPost]) -> dict[str, Any]:
        by_account: dict[str, list[XPost]] = defaultdict(list)
        hashtag_first_seen: dict[str, tuple[str, float]] = {}
        mention_inbound: dict[str, int] = defaultdict(int)

        for post in posts:
            by_account[post.author_username].append(post)
            ts = post.created_at.timestamp()
            for tag in post.hashtags:
                lowered = tag.lower()
                current = hashtag_first_seen.get(lowered)
                if current is None or ts < current[1]:
                    hashtag_first_seen[lowered] = (post.author_username, ts)
            for mention in post.mentions:
                mention_inbound[mention.lower()] += 1

        rows: list[dict[str, Any]] = []
        for account, account_posts in by_account.items():
            engagement = sum(max(0, post.engagement) for post in account_posts)
            repost_centrality = sum(max(0, post.reposts) for post in account_posts)
            mention_centrality = mention_inbound.get(account.lower(), 0)
            hashtag_initiation = sum(1 for owner, _ in hashtag_first_seen.values() if owner == account)
            volume = len(account_posts)
            score = (
                0.35 * min(1.0, engagement / 1200.0)
                + 0.25 * min(1.0, repost_centrality / 500.0)
                + 0.20 * min(1.0, mention_centrality / 40.0)
                + 0.20 * min(1.0, hashtag_initiation / 10.0)
            )
            rows.append(
                {
                    "username": account,
                    "engagement_generation": engagement,
                    "repost_centrality": repost_centrality,
                    "mention_centrality": mention_centrality,
                    "hashtag_initiation": hashtag_initiation,
                    "volume": volume,
                    "influence_score": round(score * 100, 2),
                }
            )

        rows.sort(key=lambda row: row["influence_score"], reverse=True)
        for row in rows:
            row["role"] = self._role_for_row(row)

        nodes = [
            {
                "id": row["username"],
                "label": row["username"],
                "score": row["influence_score"],
                "role": row["role"],
            }
            for row in rows[:120]
        ]
        edges = self._build_edges(posts, allowed={node["id"] for node in nodes})

        return {
            "leaders": rows[:50],
            "nodes": nodes,
            "edges": edges[:220],
        }

    def _role_for_row(self, row: dict[str, Any]) -> str:
        if row["hashtag_initiation"] >= 2 and row["engagement_generation"] >= 120:
            return "originator"
        if row["repost_centrality"] >= 80:
            return "amplifier"
        if row["mention_centrality"] >= 15:
            return "bridge account"
        return "commentator"

    def _build_edges(self, posts: list[XPost], allowed: set[str]) -> list[dict[str, Any]]:
        edge_counts: dict[tuple[str, str], int] = defaultdict(int)
        for post in posts:
            src = post.author_username
            if src not in allowed:
                continue
            for mention in post.mentions:
                dst = mention
                if dst not in allowed:
                    continue
                if src == dst:
                    continue
                edge_counts[(src, dst)] += 1
        edges = [
            {"source": src, "target": dst, "weight": count}
            for (src, dst), count in edge_counts.items()
            if count >= 1
        ]
        edges.sort(key=lambda row: row["weight"], reverse=True)
        return edges
