from datetime import datetime, timezone
from typing import Any

import httpx
from dateutil import parser

from app.config import settings
from app.services.fetchers.base import RawEvent


ICAO_COUNTRY_PREFIXES: dict[str, str] = {
    "OM": "UAE",
    "OE": "Saudi Arabia",
    "OT": "Qatar",
    "OK": "Kuwait",
    "OB": "Bahrain",
    "OO": "Oman",
    "OJ": "Jordan",
    "OI": "Iran",
    "OR": "Iraq",
    "OP": "Pakistan",
    "HE": "Egypt",
    "LT": "Turkey",
    "LL": "Israel",
    "OL": "Lebanon",
    "EG": "United Kingdom",
    "LF": "France",
    "ED": "Germany",
    "ET": "Germany",
    "LE": "Spain",
    "LI": "Italy",
    "EH": "Netherlands",
    "LS": "Switzerland",
    "LK": "Czech Republic",
    "LO": "Austria",
    "LP": "Portugal",
    "LG": "Greece",
    "UU": "Russia",
    "UE": "Russia",
    "UH": "Russia",
    "UI": "Russia",
    "UL": "Russia",
    "UN": "Russia",
    "UR": "Ukraine",
    "US": "Russia",
    "UT": "Russia",
    "VI": "India",
    "VO": "India",
    "RJ": "Japan",
    "RK": "South Korea",
    "VT": "Thailand",
    "VQ": "Singapore",
    "WS": "Singapore",
    "WM": "Malaysia",
    "ZB": "China",
    "ZS": "China",
    "ZG": "China",
    "ZY": "China",
}


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


def _rows(payload: Any) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return (
            payload.get("data")
            or payload.get("flights")
            or payload.get("result")
            or payload.get("aircraft")
            or []
        )
    return []


def _get(row: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in row and row[key] is not None:
            return row[key]
    return None


def _infer_country_from_icao(value: Any) -> str | None:
    code = str(value or "").strip().upper()
    if len(code) < 2:
        return None
    prefix2 = code[:2]
    if prefix2 in ICAO_COUNTRY_PREFIXES:
        return ICAO_COUNTRY_PREFIXES[prefix2]
    prefix1 = code[:1]
    if prefix1 == "K":
        return "United States"
    if prefix1 == "C":
        return "Canada"
    if prefix1 == "Y":
        return "Australia"
    return None


def fetch_flightradar24_feed(endpoint: str, limit: int = 300) -> list[RawEvent]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}

    if settings.fr24_api_key and settings.fr24_auth_header:
        header_name = settings.fr24_auth_header
        scheme = (settings.fr24_auth_scheme or "").strip()
        header_value = settings.fr24_api_key
        if scheme:
            header_value = f"{scheme} {settings.fr24_api_key}"
        elif header_name.lower() == "authorization":
            # FR24 requires bearer token format on Authorization header.
            header_value = f"Bearer {settings.fr24_api_key}"
        headers[header_name] = header_value
    if settings.fr24_accept_version:
        headers["Accept-Version"] = settings.fr24_accept_version
    if settings.fr24_api_key and settings.fr24_api_key_param:
        params[settings.fr24_api_key_param] = settings.fr24_api_key

    with httpx.Client(timeout=25) as client:
        response = client.get(endpoint, headers=headers or None, params=params or None)
        if response.status_code in {401, 403} and settings.fr24_api_key:
            # Backward compatibility for legacy env values (x-apikey) while FR24 expects bearer auth.
            retry_headers = dict(headers)
            retry_headers["Authorization"] = f"Bearer {settings.fr24_api_key}"
            retry_headers.setdefault("Accept-Version", "v1")
            response = client.get(endpoint, headers=retry_headers, params=params or None)
        response.raise_for_status()
        payload = response.json()

    items: list[RawEvent] = []
    for row in _rows(payload)[:limit]:
        if not isinstance(row, dict):
            continue

        flight_id = _get(row, "id", "flight_id", "fr24_id")
        callsign = _get(row, "callsign", "flight", "flight_number") or flight_id
        lat = _get(row, "lat", "latitude")
        lon = _get(row, "lon", "lng", "longitude")
        airline = _get(row, "airline", "operator", "operator_name")
        origin_iata = _get(row, "orig_iata", "origin_iata")
        destination_iata = _get(row, "dest_iata", "destination_iata")
        origin_icao = _get(row, "orig_icao", "origin_icao")
        destination_icao = _get(row, "dest_icao", "destination_icao")
        origin = _get(row, "origin", "from", "origin_airport") or origin_iata or origin_icao
        destination = _get(row, "destination", "to", "destination_airport") or destination_iata or destination_icao
        origin_country = _get(row, "origin_country", "from_country", "departure_country") or _infer_country_from_icao(origin_icao)
        destination_country = _get(row, "destination_country", "to_country", "arrival_country") or _infer_country_from_icao(
            destination_icao
        )
        speed = _get(row, "speed", "ground_speed", "gspeed")
        altitude = _get(row, "altitude", "alt")
        heading = _get(row, "heading", "track")
        registration = _get(row, "registration", "reg")
        aircraft_type = _get(row, "aircraft_type", "aircraft")
        status = _get(row, "status", "flight_status") or "unknown"
        timestamp = (
            _get(row, "timestamp")
            or _get(row, "time")
            or _get(row, "updated_at")
            or _get(row, "last_position_time")
        )
        link = _get(row, "url", "link")
        source_kind = _get(row, "source")

        summary = (
            f"route_country: {origin_country or 'unknown'} -> {destination_country or 'unknown'}"
            f" | route_port: {origin or '?'} -> {destination or '?'}"
            f" | status: {status}"
        )
        details = " | ".join(
            [
                "provider=flightradar24",
                f"flight_id={flight_id if flight_id is not None else 'n/a'}",
                f"callsign={callsign if callsign is not None else 'n/a'}",
                f"registration={registration if registration is not None else 'n/a'}",
                f"aircraft_type={aircraft_type if aircraft_type is not None else 'n/a'}",
                f"airline={airline if airline is not None else 'n/a'}",
                f"from_port={origin if origin is not None else 'n/a'}",
                f"to_port={destination if destination is not None else 'n/a'}",
                f"from_country={origin_country if origin_country is not None else 'n/a'}",
                f"to_country={destination_country if destination_country is not None else 'n/a'}",
                f"orig_iata={origin_iata if origin_iata is not None else 'n/a'}",
                f"dest_iata={destination_iata if destination_iata is not None else 'n/a'}",
                f"orig_icao={origin_icao if origin_icao is not None else 'n/a'}",
                f"dest_icao={destination_icao if destination_icao is not None else 'n/a'}",
                f"origin={origin if origin is not None else 'n/a'}",
                f"destination={destination if destination is not None else 'n/a'}",
                f"status={status}",
                f"source={source_kind if source_kind is not None else 'n/a'}",
                f"speed_kt={speed if speed is not None else 'n/a'}",
                f"speed={speed if speed is not None else 'n/a'}",
                f"altitude={altitude if altitude is not None else 'n/a'}",
                f"heading={heading if heading is not None else 'n/a'}",
                f"lon={lon if lon is not None else 'n/a'}",
                f"lat={lat if lat is not None else 'n/a'}",
            ]
        )

        items.append(
            RawEvent(
                external_id=str(flight_id) if flight_id else None,
                title=f"FlightRadar24 update: {callsign or 'flight'}",
                summary=summary,
                details=details,
                url=link,
                location=destination or origin,
                latitude=_as_float(lat),
                longitude=_as_float(lon),
                event_time=_parse_time(timestamp),
            )
        )
    return items
