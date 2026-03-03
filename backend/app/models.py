from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Source(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    source_type: str = Field(index=True)
    endpoint: str
    parser_hint: Optional[str] = None
    enabled: bool = Field(default=True, index=True)
    poll_interval_seconds: int = Field(default=120)
    created_at: datetime = Field(default_factory=utcnow)
    last_polled_at: Optional[datetime] = None


class Event(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: Optional[int] = Field(default=None, foreign_key="source.id", index=True)
    source_type: str = Field(index=True)
    source_name: str = Field(index=True)
    external_id: Optional[str] = Field(default=None, index=True)
    title: str
    summary: Optional[str] = None
    details: Optional[str] = None
    url: Optional[str] = None
    location: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    event_time: datetime = Field(default_factory=utcnow, index=True)
    relevance_score: float = Field(default=0.0)
    severity: int = Field(default=1, ge=1, le=5, index=True)
    tags: str = ""
    ai_assessment: Optional[str] = None
    created_at: datetime = Field(default_factory=utcnow, index=True)


class Alert(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    event_id: int = Field(foreign_key="event.id", index=True)
    level: str = Field(default="medium", index=True)
    title: str
    details: str
    acknowledged: bool = Field(default=False, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIChatMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    role: str = Field(index=True)
    content: str
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIInsight(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    prompt: str
    content: str
    related_event_ids: str = ""
    created_at: datetime = Field(default_factory=utcnow, index=True)


class AIPredictionTicket(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str = Field(index=True)
    focus_query: str = Field(index=True)
    request_text: str
    prediction_text: str
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    horizon_hours: int = Field(default=24, ge=1, le=720)
    status: str = Field(default="open", index=True)
    outcome: str = Field(default="unknown", index=True)
    scope: str = Field(default="general")
    related_event_ids: str = ""
    created_at: datetime = Field(default_factory=utcnow, index=True)
    updated_at: datetime = Field(default_factory=utcnow, index=True)


class AIPredictionUpdate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    ticket_id: int = Field(foreign_key="aipredictionticket.id", index=True)
    kind: str = Field(default="update", index=True)
    content: str
    outcome: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=utcnow, index=True)
