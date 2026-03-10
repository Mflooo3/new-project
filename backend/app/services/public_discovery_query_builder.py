from __future__ import annotations

from urllib.parse import quote_plus


AR_UAE = "\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a"
AR_GULF = "\u0627\u0644\u062e\u0644\u064a\u062c"
AR_ABU_DHABI = "\u0623\u0628\u0648\u0638\u0628\u064a"
AR_DUBAI = "\u062f\u0628\u064a"
AR_SHARJAH = "\u0627\u0644\u0634\u0627\u0631\u0642\u0629"
AR_QATAR = "\u0642\u0637\u0631"
AR_KUWAIT = "\u0627\u0644\u0643\u0648\u064a\u062a"
AR_BAHRAIN = "\u0627\u0644\u0628\u062d\u0631\u064a\u0646"
AR_OMAN = "\u0639\u0645\u0627\u0646"
AR_SAUDI = "\u0627\u0644\u0633\u0639\u0648\u062f\u064a\u0629"
AR_IRAN = "\u0625\u064a\u0631\u0627\u0646"
AR_MISSILE = "\u0635\u0627\u0631\u0648\u062e"
AR_DRONE = "\u0645\u0633\u064a\u0631\u0629"
AR_INTERCEPT = "\u0627\u0639\u062a\u0631\u0627\u0636"
AR_AIR_DEFENSE = "\u062f\u0641\u0627\u0639 \u062c\u0648\u064a"
AR_PORT = "\u0645\u064a\u0646\u0627\u0621"
AR_AIRPORT = "\u0645\u0637\u0627\u0631"
AR_DIPLOMACY = "\u062f\u0628\u0644\u0648\u0645\u0627\u0633\u064a"
AR_POLITICS = "\u0633\u064a\u0627\u0633\u064a"
AR_WAR = "\u062d\u0631\u0628"
AR_STRIKE = "\u0636\u0631\u0628\u0629"
AR_TENSION = "\u062a\u0635\u0639\u064a\u062f"
AR_HORMUZ = "\u0647\u0631\u0645\u0632"


def _norm_terms(raw_terms: list[str], *, limit: int = 8) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in raw_terms:
        term = str(value or "").strip()
        if not term:
            continue
        low = term.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(term)
        if len(out) >= limit:
            break
    return out


def _q(term: str) -> str:
    # Keep terms safe for X query language, especially multi-word entities.
    clean = str(term or "").strip().replace('"', "")
    if not clean:
        return ""
    if " " in clean or "-" in clean:
        return f'"{clean}"'
    return clean


def _or_join(terms: list[str]) -> str:
    ready = [_q(term) for term in terms if str(term or "").strip()]
    ready = [term for term in ready if term]
    if not ready:
        return ""
    if len(ready) == 1:
        return ready[0]
    return "(" + " OR ".join(ready) + ")"


def _hashtags(terms: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for term in terms:
        raw = str(term or "").strip().lstrip("#")
        if not raw:
            continue
        # X hashtags cannot include spaces.
        token = raw.replace(" ", "")
        if len(token) < 2:
            continue
        key = token.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(f"#{token}")
    return out


def build_public_discovery_queries(
    *,
    region_preset: str,
    country: str,
    custom_country: str | None,
    markers: list[str],
    seed_hashtags: list[str] | None = None,
) -> dict[str, list[str]]:
    country_terms = _norm_terms(
        [
            country,
            custom_country or "",
            "UAE",
            AR_UAE,
            "Emirates",
            "Abu Dhabi",
            AR_ABU_DHABI,
            "Dubai",
            AR_DUBAI,
            "Sharjah",
            AR_SHARJAH,
            "Saudi Arabia",
            AR_SAUDI,
            "Qatar",
            AR_QATAR,
            "Kuwait",
            AR_KUWAIT,
            "Bahrain",
            AR_BAHRAIN,
            "Oman",
            AR_OMAN,
            "Gulf",
            AR_GULF,
            "Hormuz",
            AR_HORMUZ,
            "Iran",
            AR_IRAN,
            *markers,
        ],
        limit=14 if str(region_preset or "").lower() == "gulf" else 10,
    )
    security_terms = _norm_terms(
        [
            "missile",
            AR_MISSILE,
            "ballistic",
            "cruise missile",
            AR_DRONE,
            "drone",
            "interception",
            AR_INTERCEPT,
            "air defense",
            AR_AIR_DEFENSE,
            AR_WAR,
            "war",
            AR_STRIKE,
            "strike",
            AR_TENSION,
            "escalation",
        ],
        limit=10,
    )
    transport_terms = _norm_terms(
        [
            "airport",
            AR_AIRPORT,
            "flight",
            "aviation",
            "airspace",
            "port",
            AR_PORT,
            "shipping",
            "maritime",
            "vessel",
        ],
        limit=8,
    )
    diplomacy_terms = _norm_terms(
        [
            AR_DIPLOMACY,
            "diplomacy",
            AR_POLITICS,
            "politics",
            "statement",
            "ceasefire",
            "summit",
            "minister",
        ],
        limit=8,
    )
    hashtag_terms = _hashtags(
        [
            "UAE",
            "Dubai",
            "AbuDhabi",
            "Gulf",
            "Iran",
            "Israel",
            "MiddleEast",
            "\u0627\u0644\u0625\u0645\u0627\u0631\u0627\u062a",
            "\u0627\u0644\u062e\u0644\u064a\u062c",
            "\u062f\u0628\u064a",
            "\u0623\u0628\u0648\u0638\u0628\u064a",
            "\u0625\u064a\u0631\u0627\u0646",
            "\u062d\u0631\u0628",
            "\u0635\u0648\u0627\u0631\u064a\u062e",
            "\u0645\u0633\u064a\u0631\u0627\u062a",
            *(seed_hashtags or []),
        ]
    )

    c = _or_join(country_terms[:8])
    sec = _or_join(security_terms[:8])
    trn = _or_join(transport_terms[:6])
    dip = _or_join(diplomacy_terms[:6])
    tag = _or_join(hashtag_terms[:10])

    queries: dict[str, list[str]] = {
        "keyword_pack": [],
        "hashtag_pack": [],
        "entity_pack": [],
    }

    if c and sec:
        queries["keyword_pack"].append(f"{c} {sec} -is:retweet")
        queries["keyword_pack"].append(f"{c} ({sec} OR {trn}) -is:retweet")
    if c and dip:
        queries["keyword_pack"].append(f"{c} {dip} -is:retweet")
    if c and trn:
        queries["keyword_pack"].append(f"{c} {trn} -is:retweet")

    if tag and c:
        queries["hashtag_pack"].append(f"{tag} {c} -is:retweet")
    if tag:
        queries["hashtag_pack"].append(f"{tag} ({sec} OR {trn} OR {dip}) -is:retweet")

    queries["entity_pack"].append(f"{c} -is:retweet")
    if c and sec and dip:
        queries["entity_pack"].append(f"{c} ({sec} OR {dip}) -is:retweet")

    # Remove empties and exact duplicates while preserving order.
    for key, rows in queries.items():
        seen: set[str] = set()
        dedup: list[str] = []
        for row in rows:
            val = str(row or "").strip()
            if not val or val in seen:
                continue
            seen.add(val)
            dedup.append(val)
        queries[key] = dedup
    return queries


def build_x_search_endpoint(base_url: str, query: str, max_results: int) -> str:
    size = max(10, min(100, int(max_results)))
    encoded = quote_plus(str(query or "").strip())
    root = str(base_url or "").strip().rstrip("/")
    if root.endswith("/tweets/search/recent"):
        api = root
    else:
        api = f"{root}/tweets/search/recent"
    return f"{api}?query={encoded}&max_results={size}&sort_order=recency"
