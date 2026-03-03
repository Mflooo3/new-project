from datetime import datetime, timezone
from typing import Any

import httpx
from dateutil import parser

from app.config import settings
from app.services.fetchers.base import RawEvent


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


def fetch_flightradar24_feed(endpoint: str, limit: int = 300) -> list[RawEvent]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}

    if settings.fr24_api_key and settings.fr24_auth_header:
        headers[settings.fr24_auth_header] = settings.fr24_api_key
    if settings.fr24_api_key and settings.fr24_api_key_param:
        params[settings.fr24_api_key_param] = settings.fr24_api_key

    with httpx.Client(timeout=25) as client:
        response = client.get(endpoint, headers=headers or None, params=params or None)
        response.raise_for_status()
        payload = response.json()

    items: list[RawEvent] = []
    for row in _rows(payload)[:limit]:
        if not isinstance(row, dict):
            continue

        flight_id = row.get("id") or row.get("flight_id") or row.get("fr24_id")
        callsign = row.get("callsign") or row.get("flight") or row.get("flight_number") or flight_id
        lat = row.get("lat") or row.get("latitude")
        lon = row.get("lon") or row.get("lng") or row.get("longitude")
        airline = row.get("airline") or row.get("operator")
        origin = row.get("origin") or row.get("from")
        destination = row.get("destination") or row.get("to")
        speed = row.get("speed") or row.get("ground_speed")
        altitude = row.get("altitude")
        heading = row.get("heading") or row.get("track")
        registration = row.get("registration") or row.get("reg")
        aircraft_type = row.get("aircraft_type") or row.get("aircraft")
        status = row.get("status") or row.get("flight_status") or "unknown"
        timestamp = (
            row.get("timestamp")
            or row.get("time")
            or row.get("updated_at")
            or row.get("last_position_time")
        )
        link = row.get("url") or row.get("link")

        summary = (
            f"{airline or 'Unknown airline'} {callsign or 'unknown flight'} | "
            f"{origin or '?'} -> {destination or '?'} | status: {status}"
        )
        details = " | ".join(
            [
                f"flight_id={flight_id if flight_id is not None else 'n/a'}",
                f"callsign={callsign if callsign is not None else 'n/a'}",
                f"registration={registration if registration is not None else 'n/a'}",
                f"aircraft_type={aircraft_type if aircraft_type is not None else 'n/a'}",
                f"airline={airline if airline is not None else 'n/a'}",
                f"origin={origin if origin is not None else 'n/a'}",
                f"destination={destination if destination is not None else 'n/a'}",
                f"status={status}",
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
