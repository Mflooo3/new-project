from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.trust import is_trusted_domain, is_trusted_event


@dataclass(frozen=True)
class SourcePolicy:
    feature: str
    trusted_only: bool
    allowed_source_classes: tuple[str, ...]
    open_public_discovery: bool
    suspicious_accounts_included: bool
    official_accounts_used_as_anchor: bool
    ranking_scope: str


SOURCE_CLASS_ALL: tuple[str, ...] = (
    "official",
    "semi_official",
    "major_media",
    "regional_media",
    "journalist",
    "commentator",
    "public_user",
    "unknown",
    "watchlist_candidate",
)

NEWS_FEED_POLICY = SourcePolicy(
    feature="news_feed",
    trusted_only=True,
    allowed_source_classes=("official", "semi_official", "major_media", "regional_media"),
    open_public_discovery=False,
    suspicious_accounts_included=False,
    official_accounts_used_as_anchor=True,
    ranking_scope="trusted_only",
)

X_NARRATIVE_POLICY = SourcePolicy(
    feature="x_narrative_intelligence",
    trusted_only=False,
    allowed_source_classes=SOURCE_CLASS_ALL,
    open_public_discovery=True,
    suspicious_accounts_included=True,
    official_accounts_used_as_anchor=True,
    ranking_scope="broad_discovery",
)

AI_NEWS_POLICY = SourcePolicy(
    feature="ai_news",
    trusted_only=True,
    allowed_source_classes=("official", "semi_official", "major_media", "regional_media"),
    open_public_discovery=False,
    suspicious_accounts_included=False,
    official_accounts_used_as_anchor=True,
    ranking_scope="trusted_only",
)

AI_X_POLICY = SourcePolicy(
    feature="ai_x_narrative",
    trusted_only=False,
    allowed_source_classes=SOURCE_CLASS_ALL,
    open_public_discovery=True,
    suspicious_accounts_included=True,
    official_accounts_used_as_anchor=True,
    ranking_scope="broad_discovery",
)


def get_source_policy_for_feature(feature_name: str | None) -> SourcePolicy:
    key = str(feature_name or "").strip().lower()
    if key in {
        "x",
        "xintel",
        "x_narrative",
        "x_narrative_intelligence",
        "narrative",
        "social_intel",
    }:
        return X_NARRATIVE_POLICY
    if key in {"ai_x", "ai_x_narrative", "x_brief"}:
        return AI_X_POLICY
    if key in {"ai", "ai_news", "ai_feed", "report", "summary"}:
        return AI_NEWS_POLICY
    if key in {"news", "news_feed", "live_feed", "event_monitoring", "events", "alerts"}:
        return NEWS_FEED_POLICY
    return NEWS_FEED_POLICY


def event_allowed_for_feature(
    *,
    feature_name: str | None,
    source_type: str,
    source_name: str | None,
    url: str | None,
) -> bool:
    policy = get_source_policy_for_feature(feature_name)
    if not policy.trusted_only:
        return True
    if str(source_type or "").strip().lower() == "social":
        name = str(source_name or "").strip().lower()
        trusted_social_markers = (
            "x trusted gcc agencies",
            "x trusted arab news channels",
            "x trusted intl arabic + gulf",
            "moiuae",
            "mod",
            "wam",
            "spa",
            "qna",
            "kuna",
            "bna",
            "sky news",
            "bbc",
            "cnn",
            "alarabiya",
            "al arabiya",
            "france 24",
            "abu dhabi",
            "الاتحاد",
            "الخليج",
            "البيان",
            "سكاي نيوز",
        )
        return any(marker in name for marker in trusted_social_markers)
    return is_trusted_event(source_type=source_type, source_name=source_name, url=url)


def filter_events_for_feature(feature_name: str | None, rows: list[Any]) -> list[Any]:
    out: list[Any] = []
    for row in rows:
        if event_allowed_for_feature(
            feature_name=feature_name,
            source_type=str(getattr(row, "source_type", "") or ""),
            source_name=getattr(row, "source_name", None),
            url=getattr(row, "url", None),
        ):
            out.append(row)
    return out


X_SOURCE_FILTER_CHOICES = ("all", "official", "media", "public", "unknown", "suspicious")

_AR_TO_EN_FILTER = {
    "الكل": "all",
    "رسمي": "official",
    "إعلام": "media",
    "اعلام": "media",
    "عام": "public",
    "مشبوه": "suspicious",
    "للمراجعة": "suspicious",
    "مشبوه/للمراجعة": "suspicious",
}

_X_FILTER_CLASS_MAP: dict[str, set[str]] = {
    "all": set(SOURCE_CLASS_ALL),
    "official": {"official", "semi_official"},
    "media": {"major_media", "regional_media", "journalist"},
    "public": {"public_user", "commentator", "unknown"},
    "unknown": {"unknown"},
    "suspicious": {"watchlist_candidate"},
}


def normalize_x_source_filter(value: str | None) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return "all"
    if raw in _AR_TO_EN_FILTER:
        raw = _AR_TO_EN_FILTER[raw]
    if raw not in _X_FILTER_CLASS_MAP:
        return "all"
    return raw


def x_source_class_allowed(source_class: str | None, source_filter: str | None) -> bool:
    selected = normalize_x_source_filter(source_filter)
    klass = str(source_class or "unknown").strip().lower() or "unknown"
    return klass in _X_FILTER_CLASS_MAP.get(selected, _X_FILTER_CLASS_MAP["all"])


_OFFICIAL_NAME_MARKERS = (
    "ministry",
    "وزارة",
    "moi",
    "mod",
    "wam",
    "spa",
    "qna",
    "kuna",
    "bna",
    "government",
    "gov",
    "official",
    "رئاسة",
    "الدفاع",
    "الداخلية",
)
_MAJOR_MEDIA_MARKERS = (
    "reuters",
    "associated press",
    "ap news",
    "cnn",
    "bbc",
    "sky news",
    "al jazeera",
    "france24",
    "france 24",
)
_REGIONAL_MEDIA_MARKERS = (
    "alarabiya",
    "al arabiya",
    "albayan",
    "al bayan",
    "al ittihad",
    "الاتحاد",
    "الخليج",
    "skynewsarabia",
    "سكاي نيوز",
    "وام",
)
_JOURNALIST_MARKERS = ("journalist", "editor", "مراسل", "صحفي", "كاتب")
_COMMENTATOR_MARKERS = ("analyst", "خبير", "commentator", "opinion", "رأي")
_WATCHLIST_MARKERS = (
    "coordination",
    "coordinated",
    "copy paste",
    "bot",
    "spam",
    "troll",
    "propaganda",
    "ممول",
    "ذباب",
    "مشكوك",
    "مشبوه",
)
_SEMI_OFFICIAL_MARKERS = ("agency", "news agency", "state media", "وكالة")
_OFFICIAL_HANDLE_MARKERS = (
    "moiuae",
    "modgovae",
    "wamnews",
    "admediaoffice",
    "uaegov",
    "uae",
    "spagov",
    "qnanews",
    "kunanews",
    "bnanews",
)


def classify_x_source(
    *,
    source_name: str | None,
    author_username: str | None,
    url: str | None,
    text: str | None = None,
    details: str | None = None,
) -> str:
    source = str(source_name or "").strip().lower()
    handle = str(author_username or "").strip().lower().lstrip("@")
    combined = " ".join(
        [
            source,
            handle,
            str(text or "").strip().lower(),
            str(details or "").strip().lower(),
        ]
    )

    if any(marker in combined for marker in _WATCHLIST_MARKERS):
        return "watchlist_candidate"

    if is_trusted_domain(url) and (".gov" in str(url or "").lower() or ".mil" in str(url or "").lower()):
        return "official"
    if any(marker in handle for marker in _OFFICIAL_HANDLE_MARKERS) or any(marker in source for marker in _OFFICIAL_NAME_MARKERS):
        return "official"
    if any(marker in source for marker in _SEMI_OFFICIAL_MARKERS):
        return "semi_official"
    if any(marker in source for marker in _MAJOR_MEDIA_MARKERS):
        return "major_media"
    if any(marker in source for marker in _REGIONAL_MEDIA_MARKERS):
        return "regional_media"
    if any(marker in combined for marker in _JOURNALIST_MARKERS):
        return "journalist"
    if any(marker in combined for marker in _COMMENTATOR_MARKERS):
        return "commentator"
    if not handle or handle in {"unknown", "user", "n/a"}:
        return "unknown"
    return "public_user"
