from datetime import datetime
from typing import Any

import httpx
from dateutil import parser

from app.services.fetchers.base import RawEvent


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value)
        except (OverflowError, ValueError):
            return None
    if isinstance(value, str):
        try:
            return parser.parse(value)
        except ValueError:
            return None
    return None


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_marine_feed(endpoint: str, limit: int = 300) -> list[RawEvent]:
    with httpx.Client(timeout=20) as client:
        response = client.get(endpoint)
        response.raise_for_status()
        payload = response.json()

    if isinstance(payload, dict):
        rows = payload.get("data") or payload.get("vessels") or payload.get("items") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    items: list[RawEvent] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        mmsi = row.get("mmsi") or row.get("MMSI")
        vessel = row.get("name") or row.get("vessel_name") or "Unknown vessel"
        status = row.get("status") or row.get("nav_status") or "unknown"
        speed = row.get("speed") or row.get("sog")
        course = row.get("course") or row.get("cog")
        lat = row.get("lat") or row.get("latitude")
        lon = row.get("lon") or row.get("lng") or row.get("longitude")
        timestamp = row.get("timestamp") or row.get("time") or row.get("last_update")
        location = row.get("port") or row.get("area") or row.get("location")
        url = row.get("url")

        items.append(
            RawEvent(
                external_id=str(mmsi) if mmsi else None,
                title=f"Marine update: {vessel}",
                summary=f"status={status} | port={location or 'n/a'} | speed={speed if speed is not None else 'n/a'}",
                details=(
                    f"mmsi={mmsi if mmsi is not None else 'n/a'} | vessel={vessel} | "
                    f"status={status} | speed={speed if speed is not None else 'n/a'} | "
                    f"course={course if course is not None else 'n/a'} | "
                    f"lon={lon if lon is not None else 'n/a'} | lat={lat if lat is not None else 'n/a'}"
                ),
                url=url,
                location=location,
                latitude=_as_float(lat),
                longitude=_as_float(lon),
                event_time=_parse_datetime(timestamp),
            )
        )
    return items
