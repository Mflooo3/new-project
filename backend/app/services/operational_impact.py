from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import re
from typing import Any

import httpx
from sqlmodel import Session, select

from app.config import settings
from app.models import AppUser, Event


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            parsed = datetime.fromisoformat(text)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def _to_iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    parsed = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_lower(value: Any) -> str:
    return _clean_text(value).lower()


def _parse_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _parse_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            text = value.replace(",", "").strip()
            if not text:
                return None
            return int(float(text))
        return int(float(value))
    except Exception:
        return None


def _split_details_tokens(details: str | None) -> dict[str, str]:
    out: dict[str, str] = {}
    raw = _clean_text(details)
    if not raw:
        return out
    for token in raw.split("|"):
        part = token.strip()
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        k = key.strip().lower()
        if not k:
            continue
        out[k] = value.strip()
    return out


def _route_key(dep: str | None, arr: str | None) -> str:
    return f"{_clean_text(dep).upper() or 'NA'}->{_clean_text(arr).upper() or 'NA'}"


@dataclass(frozen=True)
class CountryProfile:
    code: str
    ar: str
    reporter: str
    airports: tuple[str, ...]
    markers: tuple[str, ...]


COUNTRY_PROFILES: dict[str, CountryProfile] = {
    "UAE": CountryProfile(
        code="UAE",
        ar="الإمارات",
        reporter="ARE",
        airports=("DXB", "AUH", "SHJ", "DWC"),
        markers=("uae", "united arab emirates", "الإمارات", "الامارات", "abu dhabi", "dubai"),
    ),
    "Saudi Arabia": CountryProfile(
        code="Saudi Arabia",
        ar="السعودية",
        reporter="SAU",
        airports=("RUH", "JED", "DMM", "MED"),
        markers=("saudi", "ksa", "saudi arabia", "السعودية", "الرياض", "جدة"),
    ),
    "Qatar": CountryProfile(
        code="Qatar",
        ar="قطر",
        reporter="QAT",
        airports=("DOH",),
        markers=("qatar", "قطر", "الدوحة", "doha"),
    ),
    "Kuwait": CountryProfile(
        code="Kuwait",
        ar="الكويت",
        reporter="KWT",
        airports=("KWI",),
        markers=("kuwait", "الكويت"),
    ),
    "Oman": CountryProfile(
        code="Oman",
        ar="عمان",
        reporter="OMN",
        airports=("MCT", "DQM", "SLL"),
        markers=("oman", "عمان", "muscat", "مسقط"),
    ),
    "Bahrain": CountryProfile(
        code="Bahrain",
        ar="البحرين",
        reporter="BHR",
        airports=("BAH",),
        markers=("bahrain", "البحرين", "المنامة"),
    ),
}

COUNTRY_ALIASES: dict[str, str] = {
    "uae": "UAE",
    "emirates": "UAE",
    "united arab emirates": "UAE",
    "الإمارات": "UAE",
    "الامارات": "UAE",
    "saudi": "Saudi Arabia",
    "ksa": "Saudi Arabia",
    "saudi arabia": "Saudi Arabia",
    "السعودية": "Saudi Arabia",
    "qatar": "Qatar",
    "قطر": "Qatar",
    "kuwait": "Kuwait",
    "الكويت": "Kuwait",
    "oman": "Oman",
    "عمان": "Oman",
    "bahrain": "Bahrain",
    "البحرين": "Bahrain",
}

SENSITIVE_COMMODITY_MARKERS = (
    "fuel",
    "oil",
    "gas",
    "petroleum",
    "wheat",
    "rice",
    "medicine",
    "medical",
    "semiconductor",
    "electronics",
    "steel",
    "iron",
    "aircraft",
    "defense",
    "الوقود",
    "النفط",
    "الغاز",
    "القمح",
    "الأرز",
    "دواء",
    "طبية",
    "إلكترون",
    "رقائق",
    "حديد",
    "صلب",
    "طائرات",
    "دفاع",
)


_AIR_CACHE: dict[str, dict[str, Any]] = {}
_TRADE_CACHE: dict[str, dict[str, Any]] = {}


def resolve_country_profile(country: str | None) -> CountryProfile:
    raw = _clean_text(country)
    if raw in COUNTRY_PROFILES:
        return COUNTRY_PROFILES[raw]
    key = COUNTRY_ALIASES.get(raw.lower())
    if key and key in COUNTRY_PROFILES:
        return COUNTRY_PROFILES[key]
    return COUNTRY_PROFILES["UAE"]


def _event_in_country_scope(event: Event, profile: CountryProfile) -> bool:
    text = " ".join(
        filter(
            None,
            [
                event.title,
                event.summary,
                event.details,
                event.location,
                event.source_name,
            ],
        )
    ).lower()
    if any(marker.lower() in text for marker in profile.markers):
        return True
    details = _split_details_tokens(event.details)
    from_country = _normalize_lower(details.get("from_country"))
    to_country = _normalize_lower(details.get("to_country"))
    if any(marker.lower() in from_country for marker in profile.markers):
        return True
    if any(marker.lower() in to_country for marker in profile.markers):
        return True
    from_port = _clean_text(details.get("from_port")).upper()
    to_port = _clean_text(details.get("to_port")).upper()
    return from_port in profile.airports or to_port in profile.airports


def derive_air_snapshot_from_events(
    session: Session,
    *,
    user: AppUser,
    profile: CountryProfile,
    hours: int = 24,
    delay_threshold: int = 45,
) -> dict[str, Any]:
    since = _utcnow() - timedelta(hours=max(1, int(hours)))
    query = select(Event).where(Event.source_type == "flight").where(Event.event_time >= since)
    if user.role != "super_admin":
        query = query.where(Event.tenant_id == user.tenant_id)
    rows = session.exec(query.order_by(Event.event_time.desc()).limit(3500)).all()
    scoped = [row for row in rows if _event_in_country_scope(row, profile)]

    monitored = 0
    delayed = 0
    cancelled = 0
    affected_airports: set[str] = set()
    delayed_by_airport: Counter[str] = Counter()
    feed: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in scoped:
        details = _split_details_tokens(row.details)
        callsign = _clean_text(details.get("callsign") or details.get("flight_id") or row.external_id or row.id)
        status = _normalize_lower(details.get("status") or details.get("flight_status") or row.summary or row.title)
        delay_minutes = _parse_int(details.get("delay") or details.get("departure_delay") or details.get("arrival_delay"))
        from_iata = _clean_text(details.get("orig_iata") or details.get("from_port"))
        to_iata = _clean_text(details.get("dest_iata") or details.get("to_port"))
        event_time = _parse_dt(row.event_time or row.created_at)
        bucket = int((event_time or _utcnow()).timestamp() // 600)
        key = f"{callsign.upper() or row.id}:{_route_key(from_iata, to_iata)}:{bucket}"
        if key in seen:
            continue
        seen.add(key)
        monitored += 1

        is_cancelled = "cancel" in status or "ملغ" in status
        is_delayed = (delay_minutes is not None and delay_minutes >= delay_threshold) or "delay" in status or "متأخر" in status
        if is_cancelled:
            cancelled += 1
        if is_delayed:
            delayed += 1
        if is_cancelled or is_delayed:
            if from_iata:
                affected_airports.add(from_iata.upper())
                if is_delayed:
                    delayed_by_airport[from_iata.upper()] += 1
            if to_iata:
                affected_airports.add(to_iata.upper())
                if is_delayed:
                    delayed_by_airport[to_iata.upper()] += 1
            feed.append(
                {
                    "id": f"derived-{row.id}",
                    "time": _to_iso(event_time),
                    "status": "cancelled" if is_cancelled else "delayed" if is_delayed else "monitoring",
                    "flight": callsign or "flight",
                    "from_iata": from_iata or None,
                    "to_iata": to_iata or None,
                    "delay_minutes": delay_minutes,
                    "source_label": row.source_name or "Flight feed",
                    "confidence": "medium",
                    "operational_implication": (
                        "إلغاء ضمن المسارات المراقبة"
                        if is_cancelled
                        else "تأخير يؤثر على تدفق الرحلات"
                    ),
                    "derived_indicator": True,
                }
            )

    airport_rows = []
    for airport in sorted(affected_airports):
        airport_rows.append(
            {
                "airport_iata": airport,
                "airport": airport,
                "delayed": int(delayed_by_airport.get(airport, 0)),
                "cancelled": 0,
                "total_impact": int(delayed_by_airport.get(airport, 0)),
                "derived_indicator": True,
            }
        )
    airport_rows.sort(key=lambda row: row["total_impact"], reverse=True)

    clusters = sum(1 for _, value in delayed_by_airport.items() if value >= 3)
    latest = max((_parse_dt(item.get("time")) for item in feed), default=None)

    return {
        "available": monitored > 0,
        "source": "events_derived",
        "source_label": "مؤشر تشغيلي مشتق من بيانات الرحلات",
        "country": profile.code,
        "country_ar": profile.ar,
        "last_updated": _to_iso(latest) or _to_iso(_utcnow()),
        "summary": {
            "monitored_flights": monitored,
            "delayed_flights": delayed,
            "cancelled_flights": cancelled,
            "affected_airports": len(affected_airports),
            "delay_clusters": clusters,
            "derived_indicator": True,
        },
        "feed": sorted(feed, key=lambda row: row.get("time") or "", reverse=True)[:60],
        "airport_table": airport_rows[:25],
        "meta": {
            "delay_threshold_minutes": delay_threshold,
            "time_scope_hours": max(1, int(hours)),
        },
    }


def _fetch_aviationstack_rows(profile: CountryProfile) -> tuple[list[dict[str, Any]], list[str]]:
    api_key = _clean_text(getattr(settings, "aviationstack_api_key", ""))
    if not api_key:
        return [], ["aviationstack_api_key_missing"]

    base_url = _clean_text(getattr(settings, "aviationstack_base_url", "")) or "https://api.aviationstack.com/v1"
    limit = max(20, min(100, int(getattr(settings, "aviationstack_request_limit", 60) or 60)))
    endpoint = f"{base_url.rstrip('/')}/flights"
    rows: list[dict[str, Any]] = []
    errors: list[str] = []
    seen: set[str] = set()

    with httpx.Client(timeout=20) as client:
        for airport in profile.airports[:3]:
            for mode in ("dep_iata", "arr_iata"):
                params = {
                    "access_key": api_key,
                    "limit": str(limit),
                    mode: airport,
                }
                try:
                    response = client.get(endpoint, params=params)
                    response.raise_for_status()
                    payload = response.json()
                except Exception as exc:
                    errors.append(f"{mode}:{airport}:{exc.__class__.__name__}")
                    continue
                data_rows = payload.get("data") if isinstance(payload, dict) else None
                if not isinstance(data_rows, list):
                    continue
                for row in data_rows:
                    if not isinstance(row, dict):
                        continue
                    flight = row.get("flight") if isinstance(row.get("flight"), dict) else {}
                    dep = row.get("departure") if isinstance(row.get("departure"), dict) else {}
                    arr = row.get("arrival") if isinstance(row.get("arrival"), dict) else {}
                    dedup_key = "|".join(
                        [
                            _clean_text(flight.get("iata") or flight.get("icao") or row.get("flight_date")),
                            _clean_text(dep.get("iata")),
                            _clean_text(arr.get("iata")),
                            _clean_text(dep.get("scheduled") or dep.get("estimated")),
                        ]
                    )
                    if dedup_key in seen:
                        continue
                    seen.add(dedup_key)
                    rows.append(row)
    return rows, errors


def _aviationstack_snapshot(profile: CountryProfile, *, delay_threshold: int = 45) -> dict[str, Any]:
    rows, errors = _fetch_aviationstack_rows(profile)
    if not rows:
        return {
            "available": False,
            "source": "aviationstack",
            "source_label": "Aviationstack API",
            "country": profile.code,
            "country_ar": profile.ar,
            "last_updated": _to_iso(_utcnow()),
            "summary": {
                "monitored_flights": 0,
                "delayed_flights": 0,
                "cancelled_flights": 0,
                "affected_airports": 0,
                "delay_clusters": 0,
                "derived_indicator": False,
            },
            "feed": [],
            "airport_table": [],
            "meta": {"errors": errors, "delay_threshold_minutes": delay_threshold},
        }

    monitored = 0
    delayed = 0
    cancelled = 0
    affected_airports: set[str] = set()
    delay_by_airport: Counter[str] = Counter()
    airport_table_map: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"airport_iata": "", "airport": "", "delayed": 0, "cancelled": 0, "total_impact": 0, "derived_indicator": False}
    )
    feed: list[dict[str, Any]] = []

    for row in rows:
        flight = row.get("flight") if isinstance(row.get("flight"), dict) else {}
        dep = row.get("departure") if isinstance(row.get("departure"), dict) else {}
        arr = row.get("arrival") if isinstance(row.get("arrival"), dict) else {}
        status = _normalize_lower(row.get("flight_status"))
        delay = _parse_int(dep.get("delay"))
        arr_delay = _parse_int(arr.get("delay"))
        if arr_delay is not None:
            delay = max(delay or 0, arr_delay)
        dep_iata = _clean_text(dep.get("iata")).upper()
        arr_iata = _clean_text(arr.get("iata")).upper()
        monitored += 1

        is_cancelled = "cancel" in status
        is_delayed = (delay is not None and delay >= delay_threshold) or status == "delayed"
        if is_delayed:
            delayed += 1
        if is_cancelled:
            cancelled += 1

        relevant = is_delayed or is_cancelled
        if not relevant:
            continue

        event_time = _parse_dt(dep.get("estimated") or dep.get("scheduled") or arr.get("estimated") or row.get("flight_date"))
        implication = "إلغاء يؤثر على الجدولة التشغيلية" if is_cancelled else "تأخير قد ينعكس على خط الرحلة"
        feed.append(
            {
                "id": "|".join([_clean_text(flight.get("iata") or flight.get("icao") or "flight"), dep_iata or "NA", arr_iata or "NA"]),
                "time": _to_iso(event_time),
                "status": "cancelled" if is_cancelled else "delayed",
                "flight": _clean_text(flight.get("iata") or flight.get("icao") or "flight"),
                "from_iata": dep_iata or None,
                "to_iata": arr_iata or None,
                "delay_minutes": delay,
                "source_label": "Aviationstack API",
                "confidence": "high",
                "operational_implication": implication,
                "derived_indicator": False,
            }
        )

        for iata, airport_name in ((dep_iata, _clean_text(dep.get("airport"))), (arr_iata, _clean_text(arr.get("airport")))):
            if not iata:
                continue
            affected_airports.add(iata)
            bucket = airport_table_map[iata]
            bucket["airport_iata"] = iata
            bucket["airport"] = airport_name or iata
            if is_delayed:
                bucket["delayed"] += 1
            if is_cancelled:
                bucket["cancelled"] += 1
            bucket["total_impact"] += 1
            if is_delayed:
                delay_by_airport[iata] += 1

    airport_rows = sorted(airport_table_map.values(), key=lambda row: row["total_impact"], reverse=True)
    clusters = sum(1 for _, value in delay_by_airport.items() if value >= 3)
    latest = max((_parse_dt(item.get("time")) for item in feed), default=None)
    return {
        "available": True,
        "source": "aviationstack",
        "source_label": "Aviationstack API",
        "country": profile.code,
        "country_ar": profile.ar,
        "last_updated": _to_iso(latest) or _to_iso(_utcnow()),
        "summary": {
            "monitored_flights": monitored,
            "delayed_flights": delayed,
            "cancelled_flights": cancelled,
            "affected_airports": len(affected_airports),
            "delay_clusters": clusters,
            "derived_indicator": False,
        },
        "feed": sorted(feed, key=lambda row: row.get("time") or "", reverse=True)[:60],
        "airport_table": airport_rows[:25],
        "meta": {"errors": errors, "delay_threshold_minutes": delay_threshold},
    }


def build_air_operations_snapshot(
    session: Session,
    *,
    user: AppUser,
    country: str = "UAE",
    hours: int = 24,
    delay_threshold: int = 45,
) -> dict[str, Any]:
    profile = resolve_country_profile(country)
    cache_key = f"{user.tenant_id}:{profile.code}:{max(1, int(hours))}:{max(10, int(delay_threshold))}"
    cached = _AIR_CACHE.get(cache_key)
    now_ts = _utcnow().timestamp()
    if cached and now_ts - float(cached.get("cached_at", 0.0)) < 180:
        payload = dict(cached.get("payload") or {})
        payload["meta"] = dict(payload.get("meta") or {})
        payload["meta"]["cached"] = True
        return payload

    aviation = _aviationstack_snapshot(profile, delay_threshold=max(10, int(delay_threshold)))
    fallback = derive_air_snapshot_from_events(
        session,
        user=user,
        profile=profile,
        hours=max(1, int(hours)),
        delay_threshold=max(10, int(delay_threshold)),
    )

    if aviation.get("available") and fallback.get("available"):
        merged_feed = {str(row.get("id")): row for row in fallback.get("feed", [])}
        for row in aviation.get("feed", []):
            merged_feed[str(row.get("id"))] = row
        payload = {
            **aviation,
            "source": "mixed",
            "source_label": "Aviationstack API + مؤشر مشتق",
            "feed": sorted(merged_feed.values(), key=lambda row: row.get("time") or "", reverse=True)[:80],
            "meta": {
                **(aviation.get("meta") or {}),
                "fallback_source": fallback.get("source"),
                "cached": False,
            },
        }
    elif aviation.get("available"):
        payload = {**aviation}
        payload["meta"] = {**(payload.get("meta") or {}), "cached": False}
    else:
        payload = {**fallback}
        payload["meta"] = {
            **(fallback.get("meta") or {}),
            "aviationstack_available": False,
            "aviationstack_reason": (aviation.get("meta") or {}).get("errors", []),
            "cached": False,
        }

    _AIR_CACHE[cache_key] = {"cached_at": now_ts, "payload": payload}
    return payload


def _extract_comtrade_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        for key in ("data", "dataset", "results", "items"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    return []


def _comtrade_flow(row: dict[str, Any]) -> str:
    raw = _normalize_lower(row.get("flowDesc") or row.get("rgDesc") or row.get("flowCode") or row.get("rgCode") or row.get("rg"))
    if raw in {"1", "m", "import", "imports"} or "import" in raw:
        return "import"
    if raw in {"2", "x", "export", "exports"} or "export" in raw:
        return "export"
    return "other"


def _comtrade_value(row: dict[str, Any]) -> float:
    for key in ("primaryValue", "tradeValue", "TradeValue", "trade_value", "value"):
        parsed = _parse_float(row.get(key))
        if parsed is not None:
            return max(0.0, parsed)
    return 0.0


def _commodity_name(row: dict[str, Any]) -> str:
    for key in ("cmdDescE", "cmdDesc", "commodityDesc", "commodity", "cmdCode", "hsCode"):
        value = _clean_text(row.get(key))
        if value:
            return value
    return "غير محدد"


def _partner_name(row: dict[str, Any]) -> str:
    for key in ("partnerDesc", "partner", "partnerCode", "ptCode"):
        value = _clean_text(row.get(key))
        if value:
            return value
    return "غير محدد"


def _top_from_counter(counter: dict[str, float], *, limit: int = 6) -> list[dict[str, Any]]:
    total = sum(counter.values()) or 0.0
    rows = sorted(counter.items(), key=lambda item: item[1], reverse=True)[:limit]
    out: list[dict[str, Any]] = []
    for name, value in rows:
        share = (value / total * 100.0) if total > 0 else 0.0
        out.append({"name": name, "value": round(value, 2), "share_pct": round(share, 1)})
    return out


def build_trade_snapshot_from_rows(
    rows: list[dict[str, Any]],
    *,
    profile: CountryProfile,
    period: str,
    source_label: str,
) -> dict[str, Any]:
    imports_by_commodity: dict[str, float] = defaultdict(float)
    exports_by_commodity: dict[str, float] = defaultdict(float)
    partners_total: dict[str, float] = defaultdict(float)
    sensitive_counter: dict[str, float] = defaultdict(float)
    imports_total = 0.0
    exports_total = 0.0

    for row in rows:
        flow = _comtrade_flow(row)
        value = _comtrade_value(row)
        if value <= 0:
            continue
        commodity = _commodity_name(row)
        partner = _partner_name(row)
        partners_total[partner] += value

        if flow == "import":
            imports_by_commodity[commodity] += value
            imports_total += value
        elif flow == "export":
            exports_by_commodity[commodity] += value
            exports_total += value

        lower = commodity.lower()
        if any(marker in lower for marker in SENSITIVE_COMMODITY_MARKERS):
            sensitive_counter[commodity] += value

    top_imports = _top_from_counter(imports_by_commodity, limit=8)
    top_exports = _top_from_counter(exports_by_commodity, limit=8)
    top_partners = _top_from_counter(partners_total, limit=8)
    sensitive = _top_from_counter(sensitive_counter, limit=8)

    top_import_share = top_imports[0]["share_pct"] if top_imports else 0.0
    top_partner_share = top_partners[0]["share_pct"] if top_partners else 0.0
    sensitive_ratio = round((sum(item["value"] for item in sensitive) / ((imports_total + exports_total) or 1.0)) * 100.0, 1) if sensitive else 0.0
    exposure_score = round(min(100.0, 0.45 * top_import_share + 0.35 * top_partner_share + 0.20 * sensitive_ratio), 1)

    insights = []
    if top_imports:
        insights.append(f"أعلى تركّز واردات: {top_imports[0]['name']} ({top_imports[0]['share_pct']}%).")
    if top_partners:
        insights.append(f"الشريك التجاري الأكثر تأثيرًا: {top_partners[0]['name']} ({top_partners[0]['share_pct']}%).")
    if sensitive:
        insights.append(f"تم رصد سلع حساسة ضمن التدفقات التجارية ({len(sensitive)} فئة).")
    if not insights:
        insights.append("البيانات المتاحة لا تكفي لاستخراج مؤشرات تعرض مرتفعة.")

    confidence = "high" if len(rows) >= 200 else "medium" if len(rows) >= 60 else "low"
    return {
        "available": bool(rows),
        "country": profile.code,
        "country_ar": profile.ar,
        "source": "un_comtrade",
        "source_label": source_label,
        "period": period,
        "last_updated": _to_iso(_utcnow()),
        "summary": {
            "top_imports": top_imports,
            "top_exports": top_exports,
            "top_partners": top_partners,
            "sensitive_commodities": sensitive,
            "exposure_score": exposure_score,
            "imports_total": round(imports_total, 2),
            "exports_total": round(exports_total, 2),
        },
        "insights": {
            "trade_concentration": f"{top_import_share:.1f}%" if top_import_share else "0%",
            "partner_exposure": f"{top_partner_share:.1f}%" if top_partner_share else "0%",
            "strategic_vulnerability": f"{sensitive_ratio:.1f}%" if sensitive_ratio else "0%",
            "notes_ar": insights,
        },
        "confidence": confidence,
    }


def fetch_comtrade_snapshot(country: str = "UAE", period: str | None = None) -> dict[str, Any]:
    profile = resolve_country_profile(country)
    period_value = _clean_text(period) or str((_utcnow() - timedelta(days=365)).year)
    cache_key = f"{profile.code}:{period_value}"
    cached = _TRADE_CACHE.get(cache_key)
    now_ts = _utcnow().timestamp()
    if cached and now_ts - float(cached.get("cached_at", 0.0)) < 3600:
        payload = dict(cached.get("payload") or {})
        payload["meta"] = dict(payload.get("meta") or {})
        payload["meta"]["cached"] = True
        return payload

    base_url = _clean_text(getattr(settings, "comtrade_base_url", "")) or "https://comtradeapi.worldbank.org"
    api_key = _clean_text(getattr(settings, "comtrade_api_key", ""))
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Ocp-Apim-Subscription-Key"] = api_key

    endpoint = f"{base_url.rstrip('/')}/data/v1/get/C/A/HS"
    candidate_params = [
        {
            "reporterCode": profile.reporter,
            "partnerCode": "0",
            "period": period_value,
            "flowCode": "M,X",
            "cmdCode": "TOTAL",
            "maxRecords": "1200",
            "format": "json",
        },
        {
            "r": profile.reporter,
            "p": "0",
            "ps": period_value,
            "rg": "all",
            "cc": "TOTAL",
            "max": "1200",
            "fmt": "json",
        },
    ]

    extracted: list[dict[str, Any]] = []
    errors: list[str] = []
    with httpx.Client(timeout=25) as client:
        for params in candidate_params:
            try:
                response = client.get(endpoint, params=params, headers=headers)
                response.raise_for_status()
                payload = response.json()
                rows = _extract_comtrade_rows(payload)
                if rows:
                    extracted = rows
                    break
            except Exception as exc:
                errors.append(exc.__class__.__name__)

    if extracted:
        snapshot = build_trade_snapshot_from_rows(
            extracted,
            profile=profile,
            period=period_value,
            source_label="UN Comtrade API",
        )
        snapshot["meta"] = {"cached": False, "errors": errors, "rows": len(extracted)}
    else:
        snapshot = {
            "available": False,
            "country": profile.code,
            "country_ar": profile.ar,
            "source": "un_comtrade",
            "source_label": "UN Comtrade API",
            "period": period_value,
            "last_updated": _to_iso(_utcnow()),
            "summary": {
                "top_imports": [],
                "top_exports": [],
                "top_partners": [],
                "sensitive_commodities": [],
                "exposure_score": 0.0,
                "imports_total": 0.0,
                "exports_total": 0.0,
            },
            "insights": {
                "trade_concentration": "0%",
                "partner_exposure": "0%",
                "strategic_vulnerability": "0%",
                "notes_ar": ["تعذر جلب بيانات Comtrade في الوقت الحالي."],
            },
            "confidence": "low",
            "meta": {"cached": False, "errors": errors},
        }

    _TRADE_CACHE[cache_key] = {"cached_at": now_ts, "payload": snapshot}
    return snapshot

