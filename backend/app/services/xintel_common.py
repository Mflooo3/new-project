from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse


ARABIC_DIACRITICS_RE = re.compile(r"[\u0610-\u061A\u064B-\u065F\u06D6-\u06ED]")
ARABIC_TATWEEL_RE = re.compile(r"\u0640+")
HASHTAG_RE = re.compile(r"(?:^|\s)#([\w\u0600-\u06FF_]{2,80})", re.UNICODE)
MENTION_RE = re.compile(r"(?:^|\s)@([A-Za-z0-9_]{2,40})")
URL_RE = re.compile(r"https?://\S+")
NON_WORD_RE = re.compile(r"[^\w\u0600-\u06FF\s#@]+")


REGION_PRESET_KEYWORDS: dict[str, list[str]] = {
    "UAE": [
        "uae",
        "emirates",
        "united arab emirates",
        "abu dhabi",
        "dubai",
        "sharjah",
        "ajman",
        "fujairah",
        "ras al khaimah",
        "umm al quwain",
        "الإمارات",
        "الامارات",
        "أبوظبي",
        "ابوظبي",
        "دبي",
        "الشارقة",
        "عجمان",
        "الفجيرة",
        "رأس الخيمة",
        "أم القيوين",
    ],
    "Saudi Arabia": ["saudi", "ksa", "riyadh", "jeddah", "السعودية", "الرياض", "جدة"],
    "Qatar": ["qatar", "doha", "قطر", "الدوحة"],
    "Kuwait": ["kuwait", "الكويت"],
    "Bahrain": ["bahrain", "البحرين"],
    "Oman": ["oman", "muscat", "عمان", "مسقط"],
}
REGION_PRESET_KEYWORDS["Gulf"] = sorted(
    {
        *REGION_PRESET_KEYWORDS["UAE"],
        *REGION_PRESET_KEYWORDS["Saudi Arabia"],
        *REGION_PRESET_KEYWORDS["Qatar"],
        *REGION_PRESET_KEYWORDS["Kuwait"],
        *REGION_PRESET_KEYWORDS["Bahrain"],
        *REGION_PRESET_KEYWORDS["Oman"],
        "gulf",
        "gcc",
        "الخليج",
        "مجلس التعاون",
    }
)


TIME_WINDOW_MAP = {
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "24h": timedelta(hours=24),
    "3d": timedelta(days=3),
    "7d": timedelta(days=7),
}


@dataclass
class XPost:
    post_id: str
    text: str
    created_at: datetime
    lang: str
    author_username: str
    author_display_name: str
    author_id: str
    url: str
    hashtags: list[str]
    mentions: list[str]
    likes: int
    reposts: int
    replies: int
    engagement: int
    inferred_location: str
    raw_source: str
    source_kind: str  # db | x_api
    source_class: str = "unknown"


def ensure_utc(value: datetime | None) -> datetime:
    now = datetime.now(timezone.utc)
    if value is None:
        return now
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def normalize_arabic(text: str) -> str:
    value = str(text or "")
    value = ARABIC_DIACRITICS_RE.sub("", value)
    value = ARABIC_TATWEEL_RE.sub("", value)
    value = (
        value.replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ى", "ي")
        .replace("ة", "ه")
        .replace("ؤ", "و")
        .replace("ئ", "ي")
    )
    return value


def normalize_text(text: str) -> str:
    value = normalize_arabic(str(text or "").lower())
    value = URL_RE.sub(" ", value)
    value = NON_WORD_RE.sub(" ", value)
    value = re.sub(r"\s{2,}", " ", value).strip()
    return value


def detect_language(text: str) -> str:
    value = str(text or "")
    arabic = len(re.findall(r"[\u0600-\u06FF]", value))
    latin = len(re.findall(r"[A-Za-z]", value))
    if arabic > max(3, latin):
        return "ar"
    if latin >= max(3, arabic):
        return "en"
    return "other"


def extract_hashtags(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in HASHTAG_RE.finditer(str(text or "")):
        tag = match.group(1).strip()
        if not tag:
            continue
        lowered = tag.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(tag)
    return out


def extract_mentions(text: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for match in MENTION_RE.finditer(str(text or "")):
        handle = match.group(1).strip()
        if not handle:
            continue
        lowered = handle.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        out.append(handle)
    return out


def parse_details_map(details: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in str(details or "").split("|"):
        chunk = part.strip()
        if not chunk or "=" not in chunk:
            continue
        key, value = chunk.split("=", 1)
        k = key.strip().lower()
        if not k:
            continue
        out[k] = value.strip()
    return out


def safe_int(value: str | int | float | None, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(float(str(value).strip()))
    except Exception:
        return default


def host_from_url(url: str | None) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        host = urlparse(raw).hostname or ""
    except Exception:
        host = ""
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def build_country_markers(region_preset: str, country: str, custom_country: str | None) -> list[str]:
    preset = str(region_preset or "UAE").strip()
    country_name = str(country or "").strip()
    custom = str(custom_country or "").strip()
    out: list[str] = []
    if preset == "Custom" and custom:
        out.extend([custom.lower(), normalize_arabic(custom.lower())])
    elif preset in REGION_PRESET_KEYWORDS:
        out.extend([item.lower() for item in REGION_PRESET_KEYWORDS[preset]])
    elif country_name in REGION_PRESET_KEYWORDS:
        out.extend([item.lower() for item in REGION_PRESET_KEYWORDS[country_name]])
    if country_name:
        out.extend([country_name.lower(), normalize_arabic(country_name.lower())])
    dedup: list[str] = []
    seen: set[str] = set()
    for marker in out:
        marker = marker.strip()
        if not marker or marker in seen:
            continue
        seen.add(marker)
        dedup.append(marker)
    return dedup


def country_match(post: XPost, markers: list[str]) -> bool:
    if not markers:
        return True
    text_pool = " ".join(
        [
            post.text,
            post.inferred_location,
            " ".join(post.hashtags),
            " ".join(post.mentions),
            post.author_username,
            post.author_display_name,
        ]
    )
    lowered = normalize_text(text_pool)
    for marker in markers:
        m = normalize_text(marker)
        if m and m in lowered:
            return True
    return False


def parse_time_window(value: str) -> timedelta:
    key = str(value or "24h").strip().lower()
    return TIME_WINDOW_MAP.get(key, TIME_WINDOW_MAP["24h"])
