import re


POSITIVE_WORDS = {
    "safe",
    "stable",
    "reopened",
    "calm",
    "recover",
    "positive",
    "improve",
    "growth",
    "agreement",
    "progress",
    "مستقر",
    "آمن",
    "تحسن",
    "إيجابي",
    "اتفاق",
    "تقدم",
}

NEGATIVE_WORDS = {
    "attack",
    "strike",
    "war",
    "threat",
    "crisis",
    "violence",
    "blocked",
    "shutdown",
    "protest",
    "panic",
    "hacked",
    "breach",
    "exploit",
    "اختراق",
    "هجوم",
    "تهديد",
    "أزمة",
    "إغلاق",
    "انقطاع",
    "خطر",
}


def _tokens(text: str) -> list[str]:
    return [token for token in re.split(r"[^\w\u0600-\u06FF]+", text.lower()) if token]


def sentiment(text: str) -> tuple[str, float]:
    tokens = _tokens(text)
    if not tokens:
        return ("neutral", 0.0)

    pos = sum(1 for token in tokens if token in POSITIVE_WORDS)
    neg = sum(1 for token in tokens if token in NEGATIVE_WORDS)

    if pos == 0 and neg == 0:
        return ("neutral", 0.0)

    score = (pos - neg) / max(1, pos + neg)
    if score > 0.2:
        return ("positive", round(score, 3))
    if score < -0.2:
        return ("negative", round(score, 3))
    return ("neutral", round(score, 3))
