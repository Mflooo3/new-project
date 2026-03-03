from typing import Any

import httpx

from app.services.fetchers.base import RawEvent


def fetch_custom_json(endpoint: str, limit: int = 100) -> list[RawEvent]:
    with httpx.Client(timeout=20) as client:
        response = client.get(endpoint)
        response.raise_for_status()
        payload: Any = response.json()

    if isinstance(payload, dict):
        rows = payload.get("data") or payload.get("items") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        rows = []

    items: list[RawEvent] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        items.append(
            RawEvent(
                external_id=str(row.get("id") or row.get("external_id") or ""),
                title=str(row.get("title") or row.get("name") or "Custom source event"),
                summary=str(row.get("summary") or row.get("description") or ""),
                details=str(row.get("details") or row.get("content") or ""),
                url=row.get("url"),
                location=row.get("location"),
                latitude=row.get("latitude"),
                longitude=row.get("longitude"),
            )
        )
    return items
