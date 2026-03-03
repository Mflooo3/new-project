from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class RawEvent:
    external_id: str | None
    title: str
    summary: str | None = None
    details: str | None = None
    url: str | None = None
    location: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    event_time: datetime | None = None

    def normalized_time(self) -> datetime:
        if self.event_time is None:
            return datetime.now(timezone.utc)
        if self.event_time.tzinfo is None:
            return self.event_time.replace(tzinfo=timezone.utc)
        return self.event_time.astimezone(timezone.utc)
