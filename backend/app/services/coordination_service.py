from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from itertools import combinations
from typing import Any

from app.services.xintel_common import XPost, normalize_text


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    inter = len(a.intersection(b))
    union = len(a.union(b))
    if union <= 0:
        return 0.0
    return inter / union


class CoordinationService:
    def detectCoordination(self, posts: list[XPost]) -> dict[str, Any]:
        by_account: dict[str, list[XPost]] = defaultdict(list)
        for post in posts:
            by_account[post.author_username].append(post)

        account_tags: dict[str, set[str]] = {}
        account_phrases: dict[str, set[str]] = {}
        account_links: dict[str, set[str]] = {}
        phrase_groups: dict[str, list[str]] = defaultdict(list)
        post_rows: list[dict[str, Any]] = []

        for account, rows in by_account.items():
            tags: set[str] = set()
            phrases: set[str] = set()
            links: set[str] = set()
            for post in rows:
                tags.update(tag.lower() for tag in post.hashtags)
                tokens = normalize_text(post.text).split()
                if len(tokens) >= 4:
                    phrase = " ".join(tokens[:8])
                    phrases.add(phrase)
                    phrase_groups[phrase].append(account)
                if post.url:
                    links.add(post.url)
                post_rows.append(
                    {
                        "account": account,
                        "created_at": post.created_at,
                        "hashtags": set(tag.lower() for tag in post.hashtags),
                    }
                )
            account_tags[account] = tags
            account_phrases[account] = phrases
            account_links[account] = links

        pairs: list[dict[str, Any]] = []
        account_scores: dict[str, float] = defaultdict(float)
        accounts = sorted(by_account.keys())
        for a, b in combinations(accounts, 2):
            shared_hashtags = account_tags[a].intersection(account_tags[b])
            shared_links = account_links[a].intersection(account_links[b])
            phrase_similarity = _jaccard(account_phrases[a], account_phrases[b])
            synchronized = self._synchronized_posts(post_rows, a, b)

            score = 0.35 * min(1.0, len(shared_hashtags) / 5.0)
            score += 0.25 * min(1.0, synchronized / 4.0)
            score += 0.20 * phrase_similarity
            score += 0.20 * min(1.0, len(shared_links) / 3.0)
            score = round(score, 3)
            if score < 0.25:
                continue

            flags: list[str] = []
            if len(shared_hashtags) >= 2:
                flags.append("shared hashtags")
            if synchronized >= 2:
                flags.append("synchronized posting")
            if phrase_similarity >= 0.35:
                flags.append("repeated phrasing")
            if len(shared_links) >= 1:
                flags.append("link repetition")

            pair = {
                "account_a": a,
                "account_b": b,
                "shared_hashtags": sorted(shared_hashtags)[:8],
                "shared_links": sorted(shared_links)[:6],
                "phrase_similarity": round(phrase_similarity, 3),
                "synchronized_posts": synchronized,
                "coordination_score": score,
                "label": "possible coordination" if score >= 0.45 else "campaign-like behavior",
                "flags": flags,
            }
            pairs.append(pair)
            account_scores[a] = max(account_scores[a], score)
            account_scores[b] = max(account_scores[b], score)

        pairs.sort(key=lambda row: row["coordination_score"], reverse=True)
        clusters = self._clusters_from_pairs(pairs)

        phrase_similarity_groups = [
            {
                "phrase": phrase,
                "accounts": sorted(set(accounts_list))[:10],
                "count": len(set(accounts_list)),
            }
            for phrase, accounts_list in phrase_groups.items()
            if len(set(accounts_list)) >= 2
        ]
        phrase_similarity_groups.sort(key=lambda row: row["count"], reverse=True)

        return {
            "pairs": pairs[:80],
            "clusters": clusters[:20],
            "phrase_similarity_groups": phrase_similarity_groups[:40],
            "account_scores": {key: round(value, 3) for key, value in account_scores.items()},
        }

    def _synchronized_posts(self, post_rows: list[dict[str, Any]], account_a: str, account_b: str) -> int:
        a_rows = [row for row in post_rows if row["account"] == account_a]
        b_rows = [row for row in post_rows if row["account"] == account_b]
        synchronized = 0
        for row_a in a_rows:
            for row_b in b_rows:
                if not row_a["hashtags"] or not row_b["hashtags"]:
                    continue
                if not row_a["hashtags"].intersection(row_b["hashtags"]):
                    continue
                delta = abs((row_a["created_at"] - row_b["created_at"]).total_seconds())
                if delta <= timedelta(minutes=20).total_seconds():
                    synchronized += 1
                    break
        return synchronized

    def _clusters_from_pairs(self, pairs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        graph: dict[str, set[str]] = defaultdict(set)
        for pair in pairs:
            a = pair["account_a"]
            b = pair["account_b"]
            graph[a].add(b)
            graph[b].add(a)

        seen: set[str] = set()
        clusters: list[dict[str, Any]] = []
        cluster_id = 1
        for node in graph.keys():
            if node in seen:
                continue
            stack = [node]
            component: list[str] = []
            while stack:
                cur = stack.pop()
                if cur in seen:
                    continue
                seen.add(cur)
                component.append(cur)
                stack.extend(graph[cur] - seen)
            if len(component) < 2:
                continue
            clusters.append(
                {
                    "cluster_id": f"C{cluster_id}",
                    "accounts": sorted(component),
                    "size": len(component),
                    "label": "possible coordination",
                }
            )
            cluster_id += 1
        clusters.sort(key=lambda row: row["size"], reverse=True)
        return clusters
