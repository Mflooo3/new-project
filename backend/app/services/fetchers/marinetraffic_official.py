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


def fetch_marinetraffic_official_feed(endpoint: str, limit: int = 300) -> list[RawEvent]:
    headers: dict[str, str] = {}
    params: dict[str, str] = {}

    if settings.marinetraffic_api_key and settings.marinetraffic_auth_header:
        headers[settings.marinetraffic_auth_header] = settings.marinetraffic_api_key
    if settings.marinetraffic_api_key and settings.marinetraffic_api_key_param:
        params[settings.marinetraffic_api_key_param] = settings.marinetraffic_api_key

    with httpx.Client(timeout=25) as client:
        response = client.get(endpoint, headers=headers or None, params=params or None)
        response.raise_for_status()
        payload = response.json()

    items: list[RawEvent] = []
    for row in _rows(payload)[:limit]:
        if not isinstance(row, dict):
            continue

        mmsi = _get(row, "mmsi", "MMSI")
        vessel = _get(row, "shipname", "SHIPNAME", "vessel_name", "name") or "Unknown vessel"
        status = _get(row, "status", "STATUS", "nav_status", "NAV_STATUS") or "unknown"
        lat = _get(row, "lat", "LAT", "latitude")
        lon = _get(row, "lon", "LON", "lng", "longitude")
        timestamp = _get(row, "timestamp", "TIMESTAMP", "last_update", "LAST_UPDATE")
        destination = _get(row, "destination", "DESTINATION")
        speed = _get(row, "speed", "SPEED")
        course = _get(row, "course", "COURSE")
        link = _get(row, "url", "link")

        items.append(
            RawEvent(
                external_id=str(mmsi) if mmsi else None,
                title=f"MarineTraffic update: {vessel}",
                summary=f"Status: {status} | destination: {destination or 'n/a'}",
                details=f"speed: {speed if speed is not None else 'n/a'} | course: {course if course is not None else 'n/a'}",
                url=link,
                location=destination,
                latitude=_as_float(lat),
                longitude=_as_float(lon),
                event_time=_parse_time(timestamp),
            )
        )

    return items
