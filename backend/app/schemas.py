from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


SourceType = Literal["news", "flight", "marine", "incident", "cyber", "social", "custom"]


class SourceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    source_type: SourceType
    endpoint: str = Field(min_length=5, max_length=500)
    parser_hint: Optional[str] = None
    poll_interval_seconds: int = Field(default=120, ge=15, le=3600)


class SourceRead(BaseModel):
    id: int
    name: str
    source_type: SourceType
    endpoint: str
    parser_hint: Optional[str]
    enabled: bool
    poll_interval_seconds: int
    created_at: datetime
    last_polled_at: Optional[datetime]


class SourceToggle(BaseModel):
    enabled: bool


class EventRead(BaseModel):
    id: int
    source_type: str
    source_name: str
    title: str
    summary: Optional[str]
    details: Optional[str]
    url: Optional[str]
    location: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    event_time: datetime
    relevance_score: float
    severity: int
    tags: str
    ai_assessment: Optional[str]
    created_at: datetime


class AlertRead(BaseModel):
    id: int
    event_id: int
    level: str
    title: str
    details: str
    acknowledged: bool
    created_at: datetime


class IngestRunResponse(BaseModel):
    mode: Literal["sync", "queued"]
    job_id: Optional[str] = None
    sources_polled: int = 0
    events_collected: int = 0
    events_stored: int = 0
    alerts_created: int = 0


class JobStatusRead(BaseModel):
    job_id: str
    status: str
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None


class AIChatRequest(BaseModel):
    message: str = Field(min_length=2, max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIChatMessageRead(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime


class AIInsightCreate(BaseModel):
    title: str = Field(min_length=2, max_length=180)
    prompt: str = Field(min_length=2, max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIInsightRead(BaseModel):
    id: int
    title: str
    prompt: str
    content: str
    related_event_ids: str
    created_at: datetime


class AIChatResponse(BaseModel):
    message: AIChatMessageRead
    created_insight: Optional[AIInsightRead] = None
    privacy_mode: bool


class AIChatDeleteResponse(BaseModel):
    deleted_count: int
    scope: Literal["all", "single"]


class AIInsightDeleteResponse(BaseModel):
    deleted_count: int


class AIPrivacyRead(BaseModel):
    privacy_mode: bool
    openai_enabled: bool


class AIStatusRead(BaseModel):
    configured: bool
    connected: bool
    model: str
    message: str


class AIReportPublishRequest(BaseModel):
    title: Optional[str] = None
    prompt: Optional[str] = None
    insight_id: Optional[int] = None
    event_ids: list[int] = Field(default_factory=list)


class AIReportRead(BaseModel):
    report_id: str
    title: str
    filename: str
    pdf_filename: Optional[str] = None
    created_at: str
    content: str


class AITranslateBulkRequest(BaseModel):
    texts: list[str] = Field(default_factory=list, max_length=120)


class AITranslateBulkResponse(BaseModel):
    translations: list[str] = Field(default_factory=list)


class AIPredictionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=220)
    focus_query: str = Field(min_length=2, max_length=220)
    request_text: str = Field(min_length=2, max_length=4000)
    horizon_hours: int = Field(default=24, ge=1, le=720)
    scope: str = Field(default="general", max_length=120)
    event_ids: list[int] = Field(default_factory=list)


class AIPredictionUpdateCreate(BaseModel):
    note: str = Field(default="", max_length=4000)
    event_ids: list[int] = Field(default_factory=list)


class AIPredictionOutcomeSet(BaseModel):
    outcome: Literal["correct", "partial", "wrong", "unknown"]
    note: str = Field(default="", max_length=2000)
    status: Literal["open", "watching", "resolved"] = "resolved"


class AIPredictionTicketRead(BaseModel):
    id: int
    title: str
    focus_query: str
    request_text: str
    prediction_text: str
    confidence: float
    horizon_hours: int
    status: str
    outcome: str
    scope: str
    related_event_ids: str
    created_at: datetime
    updated_at: datetime


class AIPredictionUpdateRead(BaseModel):
    id: int
    ticket_id: int
    kind: str
    content: str
    outcome: Optional[str]
    created_at: datetime


class AIPredictionLeaderboardRow(BaseModel):
    model: str
    window_hours: int
    window_label: str
    evaluated_tickets: int
    accuracy: float
    correct_count: int
    partial_count: int
    wrong_count: int
    trend_delta: float


class AIPredictionDeleteResponse(BaseModel):
    deleted_count: int = 0
