from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from dateutil import parser

from app.config import settings
from app.services.fetchers.base import RawEvent

GULF_COUNTRY_ISOS = ("AE", "QA", "KW", "BH", "SA", "OM", "JO")


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc)
        except (OverflowError, ValueError):
            return None
    if isinstance(value, str):
        try:
            parsed = parser.parse(value)
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _get(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return payload.get("data") or payload.get("vessels") or payload.get("items") or []
    return []


def _is_jsoncargo_endpoint(endpoint: str) -> bool:
    value = (endpoint or "").strip().lower()
    return "jsoncargo.com" in value


def _build_auth(endpoint: str) -> tuple[str, bool, dict[str, str], dict[str, str]]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}
    if _is_jsoncargo_endpoint(endpoint):
        key = settings.jsoncargo_api_key or settings.marinetraffic_api_key
        if key:
            header_name = (settings.jsoncargo_auth_header or "x-api-key").strip() or "x-api-key"
            headers[header_name] = key
            if settings.jsoncargo_api_key_param:
                params[settings.jsoncargo_api_key_param] = key
        return "JSONCargo", True, headers, params

    if settings.marinetraffic_api_key and settings.marinetraffic_auth_header:
        headers[settings.marinetraffic_auth_header] = settings.marinetraffic_api_key
    if settings.marinetraffic_api_key and settings.marinetraffic_api_key_param:
        params[settings.marinetraffic_api_key_param] = settings.marinetraffic_api_key
    return "MarineTraffic", False, headers, params


def _replace_query(parsed: Any, query: str) -> str:
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, query, parsed.fragment))


def _expand_jsoncargo_endpoints(endpoint: str) -> list[tuple[str, str]]:
    parsed = urlparse(endpoint)
    query = parse_qs(parsed.query, keep_blank_values=True)
    country_raw = (query.get("country_iso", [""])[0] or "").strip().upper()
    if country_raw and country_raw not in {"GULF", "ALL"}:
        return [(endpoint, country_raw)]

    flat_query = {key: values[-1] if values else "" for key, values in query.items()}
    # Rate-safe rotation: probe one Gulf country per cycle instead of bursting all countries.
    slot = int(datetime.now(timezone.utc).timestamp() // 120) % len(GULF_COUNTRY_ISOS)
    country_iso = GULF_COUNTRY_ISOS[slot]
    next_query = dict(flat_query)
    next_query["country_iso"] = country_iso
    expanded_query = urlencode(next_query, doseq=False)
    return [(_replace_query(parsed, expanded_query), country_iso)]


def _lookup_jsoncargo_port(
    *,
    client: httpx.Client,
    headers: dict[str, str],
    port_name: str | None,
    country_iso: str | None,
    cache: dict[tuple[str, str], dict[str, Any] | None],
) -> dict[str, Any] | None:
    normalized_port = str(port_name or "").strip()
    normalized_country = str(country_iso or "").strip().upper()
    if not normalized_port:
        return None
    cache_key = (normalized_port.lower(), normalized_country)
    if cache_key in cache:
        return cache[cache_key]

    params = {"name": normalized_port, "fuzzy": "1"}
    if normalized_country:
        params["country_iso"] = normalized_country
    try:
        response = client.get(
            "https://api.jsoncargo.com/api/v1/port/find",
            headers=headers or None,
            params=params,
        )
        response.raise_for_status()
        payload = response.json()
        rows = _rows(payload)
        row = rows[0] if rows and isinstance(rows[0], dict) else None
        cache[cache_key] = row
        return row
    except Exception:
        cache[cache_key] = None
        return None


def fetch_marinetraffic_official_feed(endpoint: str, limit: int = 300) -> list[RawEvent]:
    provider_label, is_jsoncargo, headers, params = _build_auth(endpoint)
    request_endpoints = (
        _expand_jsoncargo_endpoints(endpoint)
        if is_jsoncargo
        else [(endpoint, str(params.get("country_iso", "") or "").upper())]
    )

    payload_rows: list[tuple[dict[str, Any], str]] = []
    with httpx.Client(timeout=25) as client:
        for request_endpoint, endpoint_country_iso in request_endpoints:
            try:
                response = client.get(request_endpoint, headers=headers or None, params=params or None)
                response.raise_for_status()
                payload = response.json()
            except Exception:
                # Keep ingesting other Gulf country slices even if one request fails.
                continue
            for item in _rows(payload):
                if isinstance(item, dict):
                    payload_rows.append((item, endpoint_country_iso))
            if len(payload_rows) >= max(limit * 2, limit):
                break

        port_cache: dict[tuple[str, str], dict[str, Any] | None] = {}
        dedupe_ids: set[str] = set()
        items: list[RawEvent] = []
        for row, endpoint_country_iso in payload_rows:
            if len(items) >= limit:
                break
            mmsi = _get(row, "mmsi", "MMSI")
            imo = _get(row, "imo", "IMO")
            uuid = _get(row, "uuid", "id")
            external_id = str(mmsi or imo or uuid) if (mmsi or imo or uuid) else None
            if external_id and external_id in dedupe_ids:
                continue
            if external_id:
                dedupe_ids.add(external_id)

            vessel = _get(row, "shipname", "SHIPNAME", "vessel_name", "name", "name_ais") or "Unknown vessel"
            status = _get(row, "status", "STATUS", "nav_status", "NAV_STATUS", "source") or "unknown"
            lat = _get(row, "lat", "LAT", "latitude", "current_lat", "position_lat")
            lon = _get(row, "lon", "LON", "lng", "longitude", "current_lon", "position_lon")
            timestamp = _get(
                row,
                "timestamp",
                "TIMESTAMP",
                "last_update",
                "LAST_UPDATE",
                "updated_at",
                "position_time",
            )
            from_port = _get(row, "from_port", "origin_port", "home_port", "port_name")
            to_port = _get(row, "to_port", "destination_port", "destination", "next_port")
            speed = _get(row, "speed", "SPEED", "speed_avg", "sog")
            course = _get(row, "course", "COURSE", "heading", "cog")
            vessel_type = _get(row, "vessel_type", "type", "SHIPTYPE")
            vessel_type_specific = _get(row, "type_specific", "vessel_subtype")
            country_iso = _get(row, "country_iso", "COUNTRY_ISO") or endpoint_country_iso
            from_country = _get(row, "from_country", "country_name", "country") or country_iso
            to_country = _get(row, "to_country", "destination_country")
            link = _get(row, "url", "link")

            from_port_row = None
            to_port_row = None
            if is_jsoncargo:
                from_port_row = _lookup_jsoncargo_port(
                    client=client,
                    headers=headers,
                    port_name=str(from_port or "").strip(),
                    country_iso=str(country_iso or "").strip().upper(),
                    cache=port_cache,
                )
                to_port_row = _lookup_jsoncargo_port(
                    client=client,
                    headers=headers,
                    port_name=str(to_port or "").strip(),
                    country_iso=str(country_iso or "").strip().upper(),
                    cache=port_cache,
                )
                if to_port_row and not to_country:
                    to_country = _get(to_port_row or {}, "country", "country_iso")
                if from_port_row and not from_country:
                    from_country = _get(from_port_row, "country", "country_iso")
                if lat is None and lon is None:
                    lat = _get(from_port_row or to_port_row or {}, "lat", "latitude")
                    lon = _get(from_port_row or to_port_row or {}, "lon", "lng", "longitude")

            summary = (
                f"route_country: {from_country or 'unknown'} -> {to_country or from_country or 'unknown'}"
                f" | route_port: {from_port or 'unknown'} -> {to_port or 'unknown'}"
                f" | type: {vessel_type or 'n/a'}"
            )
            details = " | ".join(
                [
                    f"provider={provider_label.lower()}",
                    f"ship_name={vessel}",
                    f"mmsi={mmsi if mmsi is not None else 'n/a'}",
                    f"imo={imo if imo is not None else 'n/a'}",
                    f"country={from_country if from_country is not None else 'n/a'}",
                    f"country_iso={country_iso if country_iso is not None else 'n/a'}",
                    f"from_country={from_country if from_country is not None else 'n/a'}",
                    f"to_country={to_country if to_country is not None else 'n/a'}",
                    f"from_port={from_port if from_port is not None else 'n/a'}",
                    f"to_port={to_port if to_port is not None else 'n/a'}",
                    f"vessel_type={vessel_type if vessel_type is not None else 'n/a'}",
                    f"vessel_type_specific={vessel_type_specific if vessel_type_specific is not None else 'n/a'}",
                    f"speed_kn={speed if speed is not None else 'n/a'}",
                    f"heading={course if course is not None else 'n/a'}",
                    f"status={status}",
                    f"lat={lat if lat is not None else 'n/a'}",
                    f"lon={lon if lon is not None else 'n/a'}",
                ]
            )
            items.append(
                RawEvent(
                    external_id=external_id,
                    title=f"{provider_label} update: {vessel}",
                    summary=summary,
                    details=details,
                    url=link,
                    location=to_port or from_port,
                    latitude=_as_float(lat),
                    longitude=_as_float(lon),
                    event_time=_parse_time(timestamp),
                )
            )
    return items


def probe_jsoncargo_status(endpoint: str | None = None) -> dict[str, Any]:
    probe_endpoint = (endpoint or "").strip() or "https://api.jsoncargo.com/api/v1/vessel/finder?country_iso=AE&type=cargo"
    provider_label, is_jsoncargo, headers, params = _build_auth(probe_endpoint)
    checked_at = datetime.now(timezone.utc).isoformat()
    configured = bool(settings.jsoncargo_api_key or settings.marinetraffic_api_key)
    if not configured:
        return {
            "configured": False,
            "state": "not_configured",
            "status_code": None,
            "message": "JSONCargo API key is not configured.",
            "detail": None,
            "checked_at": checked_at,
            "endpoint": probe_endpoint,
        }
    if not is_jsoncargo:
        return {
            "configured": True,
            "state": "unsupported",
            "status_code": None,
            "message": "Selected marine source is not JSONCargo.",
            "detail": None,
            "checked_at": checked_at,
            "endpoint": probe_endpoint,
        }

    try:
        request_endpoints = _expand_jsoncargo_endpoints(probe_endpoint)
        first_failure: dict[str, Any] | None = None
        saw_quota_exceeded = False

        with httpx.Client(timeout=18) as client:
            for request_endpoint, _country_iso in request_endpoints:
                response = client.get(request_endpoint, headers=headers or None, params=params or None)
                status_code = int(response.status_code)
                detail = None
                sample_count = None
                try:
                    payload = response.json()
                    if isinstance(payload, dict):
                        error_obj = payload.get("error")
                        if isinstance(error_obj, dict):
                            detail = str(error_obj.get("title") or error_obj.get("message") or "").strip() or None
                        elif isinstance(error_obj, str):
                            detail = error_obj.strip() or None
                    rows = _rows(payload)
                    sample_count = len(rows) if isinstance(rows, list) else None
                except Exception:
                    payload = None

                if status_code < 400:
                    sample_text = f" sample={sample_count}" if sample_count is not None else ""
                    return {
                        "configured": True,
                        "state": "ok",
                        "status_code": status_code,
                        "message": f"{provider_label} reachable.{sample_text}".strip(),
                        "detail": None,
                        "checked_at": checked_at,
                        "endpoint": request_endpoint,
                    }

                detail_lc = (detail or "").lower()
                if status_code == 429 or "rate limit" in detail_lc or "exceeds rate limit" in detail_lc:
                    saw_quota_exceeded = True
                if first_failure is None:
                    first_failure = {
                        "status_code": status_code,
                        "detail": detail,
                        "endpoint": request_endpoint,
                    }

        if saw_quota_exceeded:
            return {
                "configured": True,
                "state": "quota_exceeded",
                "status_code": 429,
                "message": "JSONCargo quota exceeded.",
                "detail": "API Key exceeds rate limit.",
                "checked_at": checked_at,
                "endpoint": probe_endpoint,
            }

        failure = first_failure or {}
        status_code = failure.get("status_code")
        detail = failure.get("detail")
        return {
            "configured": True,
            "state": "auth_error" if status_code in {401, 403} else "error",
            "status_code": status_code,
            "message": "JSONCargo authentication failed." if status_code in {401, 403} else f"JSONCargo returned HTTP {status_code}.",
            "detail": detail,
            "checked_at": checked_at,
            "endpoint": failure.get("endpoint") or probe_endpoint,
        }
    except Exception as exc:
        return {
            "configured": True,
            "state": "error",
            "status_code": None,
            "message": "JSONCargo status probe failed.",
            "detail": str(exc)[:240],
            "checked_at": checked_at,
            "endpoint": probe_endpoint,
        }
