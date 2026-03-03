from datetime import datetime, timezone
from typing import Any

import httpx

from app.services.fetchers.base import RawEvent


def _fmt(value: Any) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value)


def fetch_flight_feed(endpoint: str, limit: int = 250) -> list[RawEvent]:
    with httpx.Client(timeout=20) as client:
        response = client.get(endpoint)
        response.raise_for_status()
        payload: dict[str, Any] = response.json()

    states = payload.get("states", [])[:limit]
    ts = payload.get("time")
    feed_time = datetime.fromtimestamp(ts, tz=timezone.utc) if isinstance(ts, (int, float)) else None

    items: list[RawEvent] = []
    for row in states:
        if not isinstance(row, list) or len(row) < 10:
            continue

        icao24 = row[0]
        callsign = (row[1] or "").strip()
        country = row[2]
        time_position = row[3]
        last_contact = row[4]
        lon = row[5]
        lat = row[6]
        baro_altitude = row[7]
        on_ground = row[8]
        velocity = row[9]
        true_track = row[10] if len(row) > 10 else None
        vertical_rate = row[11] if len(row) > 11 else None
        geo_altitude = row[13] if len(row) > 13 else None
        squawk = row[14] if len(row) > 14 else None
        position_source = row[16] if len(row) > 16 else None

        event_time = (
            datetime.fromtimestamp(last_contact, tz=timezone.utc)
            if isinstance(last_contact, (int, float))
            else feed_time
        )
        summary = (
            f"country={_fmt(country)} | on_ground={_fmt(on_ground)} | "
            f"velocity_mps={_fmt(velocity)} | baro_alt_m={_fmt(baro_altitude)}"
        )
        details = " | ".join(
            [
                f"icao24={_fmt(icao24)}",
                f"callsign={_fmt(callsign or icao24)}",
                f"country={_fmt(country)}",
                f"lon={_fmt(lon)}",
                f"lat={_fmt(lat)}",
                f"velocity_mps={_fmt(velocity)}",
                f"baro_alt_m={_fmt(baro_altitude)}",
                f"geo_alt_m={_fmt(geo_altitude)}",
                f"track_deg={_fmt(true_track)}",
                f"vertical_rate={_fmt(vertical_rate)}",
                f"on_ground={_fmt(on_ground)}",
                f"squawk={_fmt(squawk)}",
                f"position_source={_fmt(position_source)}",
                f"time_position={_fmt(time_position)}",
                f"last_contact={_fmt(last_contact)}",
            ]
        )
        title = f"Flight {callsign or icao24} state update"

        items.append(
            RawEvent(
                external_id=f"{icao24}:{last_contact}",
                title=title,
                summary=summary,
                details=details,
                location=None,
                latitude=lat if isinstance(lat, (int, float)) else None,
                longitude=lon if isinstance(lon, (int, float)) else None,
                event_time=event_time,
            )
        )
    return items
