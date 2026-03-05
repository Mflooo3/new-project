import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from openai import OpenAI
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from sqlmodel import Session, asc, delete, desc, select

from app.config import settings
from app.models import AIPredictionTicket, AIPredictionUpdate, AIChatMessage, AIInsight, Event
from app.services.sentiment import sentiment

try:  # pragma: no cover - optional runtime dependency
    import arabic_reshaper
except Exception:  # pragma: no cover - fallback when dependency missing
    arabic_reshaper = None

try:  # pragma: no cover - optional runtime dependency
    from bidi.algorithm import get_display
except Exception:  # pragma: no cover - fallback when dependency missing
    get_display = None


STATUS_CACHE_TTL_SECONDS = 120
DEFAULT_PREDICTION_REVIEW_INTERVAL_MINUTES = 10


def _events_context(events: list[Event], limit: int = 30) -> str:
    def _source_bucket(event: Event) -> str:
        if event.source_type in {"incident", "flight", "marine", "cyber"}:
            return "sensor_or_structured"
        if event.source_type == "social":
            return "social"
        return "media_or_feed"

    rows: list[dict[str, Any]] = []
    for event in events[:limit]:
        rows.append(
            {
                "id": event.id,
                "source_type": event.source_type,
                "source_bucket": _source_bucket(event),
                "source_name": event.source_name,
                "severity": event.severity,
                "title": event.title,
                "summary": event.summary,
                "details": event.details,
                "tags": event.tags,
                "location": event.location,
                "event_time": event.event_time.isoformat(),
                "ai_assessment": event.ai_assessment,
                "url": event.url,
            }
        )
    return json.dumps(rows, ensure_ascii=False)


def _slug(value: str) -> str:
    text = re.sub(r"[^\w\s-]", "", value.strip().lower())
    text = re.sub(r"[\s_-]+", "-", text)
    text = text.strip("-")
    return text[:60] or "report"


def _clean_lines(content: str) -> list[str]:
    lines: list[str] = []
    for raw in content.splitlines():
        line = raw.strip()
        if not line:
            lines.append("")
            continue
        if line.startswith("### "):
            line = line[4:]
        elif line.startswith("## "):
            line = line[3:]
        elif line.startswith("# "):
            line = line[2:]
        if line.startswith("- "):
            line = f"* {line[2:]}"
        lines.append(line)
    return lines


def _contains_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text or ""))


def _rtl_text(text: str) -> str:
    value = str(text or "")
    if not _contains_arabic(value):
        return value
    if arabic_reshaper is None or get_display is None:
        return value
    try:
        return get_display(arabic_reshaper.reshape(value))
    except Exception:
        return value


def _register_pdf_fonts() -> tuple[str, str]:
    regular_name = "GulfArabicRegular"
    bold_name = "GulfArabicBold"
    registered = set(pdfmetrics.getRegisteredFontNames())
    regular_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    bold_candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]

    if regular_name not in registered:
        for candidate in regular_candidates:
            path = Path(candidate)
            if not path.exists():
                continue
            try:
                pdfmetrics.registerFont(TTFont(regular_name, str(path)))
                break
            except Exception:
                continue

    registered = set(pdfmetrics.getRegisteredFontNames())
    if bold_name not in registered:
        for candidate in bold_candidates:
            path = Path(candidate)
            if not path.exists():
                continue
            try:
                pdfmetrics.registerFont(TTFont(bold_name, str(path)))
                break
            except Exception:
                continue

    registered = set(pdfmetrics.getRegisteredFontNames())
    final_regular = regular_name if regular_name in registered else "Helvetica"
    if bold_name in registered:
        final_bold = bold_name
    elif final_regular != "Helvetica":
        final_bold = final_regular
    else:
        final_bold = "Helvetica-Bold"
    return final_regular, final_bold


class AIWorkspaceService:
    _status_cache_at: datetime | None = None
    _status_cache_value: dict[str, Any] | None = None

    def __init__(self, session: Session) -> None:
        self.session = session
        self._client = None
        if settings.openai_api_key and not settings.ai_privacy_mode:
            self._client = OpenAI(api_key=settings.openai_api_key)

    def openai_status(self, force: bool = False) -> dict[str, Any]:
        configured = bool(settings.openai_api_key and not settings.ai_privacy_mode)
        model = (settings.openai_model or "gpt-4.1-mini").strip() or "gpt-4.1-mini"
        if not configured:
            return {
                "configured": False,
                "connected": False,
                "model": model,
                "message": "OpenAI key missing or privacy mode enabled.",
            }

        now = datetime.now(timezone.utc)
        if (
            not force
            and self.__class__._status_cache_at is not None
            and self.__class__._status_cache_value is not None
            and now - self.__class__._status_cache_at < timedelta(seconds=STATUS_CACHE_TTL_SECONDS)
        ):
            return dict(self.__class__._status_cache_value)

        connected = False
        message = "Connection check failed."
        if self._client is None:
            message = "OpenAI client is not initialized."
        else:
            try:
                if hasattr(self._client, "models"):
                    self._client.models.list()
                    connected = True
                    message = "Connected."
                else:
                    connected = True
                    message = "Client is available."
            except Exception as exc:  # pragma: no cover - network/runtime dependent
                message = f"Connection failed: {exc.__class__.__name__}"

        payload = {
            "configured": True,
            "connected": connected,
            "model": model,
            "message": message,
        }
        self.__class__._status_cache_at = now
        self.__class__._status_cache_value = dict(payload)
        return payload

    def get_messages(self, limit: int = 100) -> list[AIChatMessage]:
        rows = self.session.exec(
            select(AIChatMessage).order_by(desc(AIChatMessage.created_at)).limit(limit)
        ).all()
        return list(reversed(rows))

    def delete_all_messages(self) -> int:
        rows = self.session.exec(select(AIChatMessage)).all()
        count = len(rows)
        for row in rows:
            self.session.delete(row)
        if count:
            self.session.commit()
        return count

    def delete_message(self, message_id: int) -> bool:
        row = self.session.get(AIChatMessage, message_id)
        if row is None:
            return False
        self.session.delete(row)
        self.session.commit()
        return True

    def get_insights(self, limit: int = 60) -> list[AIInsight]:
        return self.session.exec(select(AIInsight).order_by(desc(AIInsight.created_at)).limit(limit)).all()

    def delete_all_insights(self) -> int:
        rows = self.session.exec(select(AIInsight)).all()
        count = len(rows)
        for row in rows:
            self.session.delete(row)
        if count:
            self.session.commit()
        return count

    def get_prediction_tickets(self, limit: int = 120) -> list[AIPredictionTicket]:
        return self.session.exec(select(AIPredictionTicket).order_by(desc(AIPredictionTicket.updated_at)).limit(limit)).all()

    def get_prediction_updates(self, ticket_id: int, limit: int = 120) -> list[AIPredictionUpdate]:
        return self.session.exec(
            select(AIPredictionUpdate)
            .where(AIPredictionUpdate.ticket_id == ticket_id)
            .order_by(desc(AIPredictionUpdate.created_at))
            .limit(limit)
        ).all()

    def delete_prediction_ticket(self, ticket_id: int) -> bool:
        ticket = self.session.get(AIPredictionTicket, ticket_id)
        if ticket is None:
            return False
        self.session.exec(delete(AIPredictionUpdate).where(AIPredictionUpdate.ticket_id == ticket_id))
        self.session.exec(delete(AIPredictionTicket).where(AIPredictionTicket.id == ticket_id))
        self.session.commit()
        return True

    def get_prediction_leaderboard(self) -> list[dict[str, Any]]:
        windows: list[tuple[int, str]] = [
            (24, "Ø¢Ø®Ø± 24 Ø³Ø§Ø¹Ø©"),
            (72, "Ø¢Ø®Ø± 72 Ø³Ø§Ø¹Ø©"),
            (168, "Ø¢Ø®Ø± 7 Ø£ÙŠØ§Ù…"),
            (720, "Ø¢Ø®Ø± 30 ÙŠÙˆÙ…"),
            (0, "ÙƒÙ„ Ø§Ù„ÙˆÙ‚Øª"),
        ]
        now = datetime.now(timezone.utc)
        model_name = (settings.openai_model or "").strip() or "gpt-4.1-mini"
        score_map = {"correct": 1.0, "partial": 0.5, "wrong": 0.0}
        rows: list[dict[str, Any]] = []

        def _eval_window(start: datetime | None, end: datetime | None = None) -> tuple[float, int, int, int, int]:
            query = select(AIPredictionTicket).where(AIPredictionTicket.outcome.in_(["correct", "partial", "wrong"]))
            if start is not None:
                query = query.where(AIPredictionTicket.updated_at >= start)
            if end is not None:
                query = query.where(AIPredictionTicket.updated_at < end)
            tickets = self.session.exec(query).all()
            total = len(tickets)
            if total == 0:
                return 0.0, 0, 0, 0, 0
            correct = sum(1 for ticket in tickets if ticket.outcome == "correct")
            partial = sum(1 for ticket in tickets if ticket.outcome == "partial")
            wrong = sum(1 for ticket in tickets if ticket.outcome == "wrong")
            score = sum(score_map.get(ticket.outcome, 0.0) for ticket in tickets)
            accuracy = round(score / total, 4)
            return accuracy, total, correct, partial, wrong

        for hours, label in windows:
            if hours == 0:
                accuracy, total, correct, partial, wrong = _eval_window(start=None)
                prev_accuracy = accuracy
            else:
                start = now - timedelta(hours=hours)
                prev_start = start - timedelta(hours=hours)
                accuracy, total, correct, partial, wrong = _eval_window(start=start)
                prev_accuracy, _, _, _, _ = _eval_window(start=prev_start, end=start)
            rows.append(
                {
                    "model": model_name,
                    "window_hours": hours,
                    "window_label": label,
                    "evaluated_tickets": total,
                    "accuracy": accuracy,
                    "correct_count": correct,
                    "partial_count": partial,
                    "wrong_count": wrong,
                    "trend_delta": round(accuracy - prev_accuracy, 4),
                }
            )
        return rows

    def create_prediction_ticket(
        self,
        *,
        title: str,
        focus_query: str,
        request_text: str,
        horizon_hours: int,
        scope: str,
        event_ids: list[int],
    ) -> tuple[AIPredictionTicket, AIPredictionUpdate]:
        events = self._load_context_events(event_ids=event_ids or [], question=focus_query, limit=80)
        prompt = (
            f"Ø£Ù†Ø´Ø¦ ØªÙˆÙ‚Ø¹Ø§Ù‹ ØªØ´ØºÙŠÙ„ÙŠØ§Ù‹ ÙˆØ§Ø¶Ø­Ø§Ù‹ Ù…Ø¹ Ø³ÙŠÙ†Ø§Ø±ÙŠÙˆ Ø±Ø¦ÙŠØ³ÙŠ Ø®Ù„Ø§Ù„ {horizon_hours} Ø³Ø§Ø¹Ø©. "
            f"Ø§Ù„ØªØ±ÙƒÙŠØ²: {focus_query}. Ø§Ù„Ø·Ù„Ø¨: {request_text}."
        )
        prediction_text = self._generate_answer(question=prompt, events=events)
        confidence = self._estimate_confidence_from_text(prediction_text)
        related_event_ids = self._normalize_related_event_ids_text(
            ",".join(str(event.id) for event in events[:120] if event.id is not None)
        )
        now = datetime.now(timezone.utc)

        ticket = AIPredictionTicket(
            title=title.strip(),
            focus_query=focus_query.strip(),
            request_text=request_text.strip(),
            prediction_text=prediction_text,
            confidence=confidence,
            horizon_hours=horizon_hours,
            scope=scope.strip() or "general",
            related_event_ids=related_event_ids,
            status="open",
            outcome="unknown",
            created_at=now,
            updated_at=now,
        )
        self.session.add(ticket)
        self.session.commit()
        self.session.refresh(ticket)

        update = AIPredictionUpdate(
            ticket_id=ticket.id or 0,
            kind="initial",
            content=prediction_text,
            outcome=None,
        )
        self.session.add(update)
        self.session.commit()
        self.session.refresh(update)
        return ticket, update

    def append_prediction_update(
        self,
        *,
        ticket_id: int,
        note: str,
        event_ids: list[int],
        kind: str = "update",
    ) -> tuple[AIPredictionTicket, AIPredictionUpdate]:
        ticket = self.session.get(AIPredictionTicket, ticket_id)
        if ticket is None:
            raise ValueError("Prediction ticket not found")
        events = self._load_context_events(event_ids=event_ids or [], question=ticket.focus_query, limit=70)
        prompt = (
            f"Ø­Ø¯Ù‘Ø« ØªÙˆÙ‚Ø¹ Ø§Ù„ØªØ°ÙƒØ±Ø© Ø¨Ø´ÙƒÙ„ Ù…ÙˆØ¬Ø² ÙˆÙ‚Ø§Ø¨Ù„ Ù„Ù„Ù…ØªØ§Ø¨Ø¹Ø©. "
            f"Ø§Ù„Ø¹Ù†ÙˆØ§Ù†: {ticket.title}. Ø§Ù„ØªØ±ÙƒÙŠØ²: {ticket.focus_query}. Ù…Ù„Ø§Ø­Ø¸Ø©: {note or 'Ø¨Ø¯ÙˆÙ†'}."
        )
        update_text = self._generate_answer(question=prompt, events=events)
        update = AIPredictionUpdate(
            ticket_id=ticket.id or 0,
            kind=kind,
            content=update_text,
            outcome=None,
        )
        self.session.add(update)
        ticket.updated_at = datetime.now(timezone.utc)
        if events:
            ids_text = self._normalize_related_event_ids_text(
                ",".join(str(event.id) for event in events[:120] if event.id is not None)
            )
            if ids_text:
                ticket.related_event_ids = ids_text
        self.session.add(ticket)
        self.session.commit()
        self.session.refresh(ticket)
        self.session.refresh(update)
        return ticket, update

    def set_prediction_outcome(
        self,
        *,
        ticket_id: int,
        outcome: str,
        note: str,
        status: str,
    ) -> tuple[AIPredictionTicket, AIPredictionUpdate]:
        ticket = self.session.get(AIPredictionTicket, ticket_id)
        if ticket is None:
            raise ValueError("Prediction ticket not found")
        ticket.outcome = outcome
        ticket.status = status
        ticket.updated_at = datetime.now(timezone.utc)
        self.session.add(ticket)
        outcome_ar = self._outcome_label_ar(outcome)
        update = AIPredictionUpdate(
            ticket_id=ticket.id or 0,
            kind="outcome",
            content=f"ØªÙ‚ÙŠÙŠÙ… Ø§Ù„Ù†ØªÙŠØ¬Ø©: {outcome_ar}. {note or ''}".strip(),
            outcome=outcome,
        )
        self.session.add(update)
        self.session.commit()
        self.session.refresh(ticket)
        self.session.refresh(update)
        return ticket, update

    def auto_review_prediction_tickets(
        self,
        *,
        min_interval_minutes: int = DEFAULT_PREDICTION_REVIEW_INTERVAL_MINUTES,
        limit: int = 120,
    ) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        tickets = self.session.exec(
            select(AIPredictionTicket)
            .where(AIPredictionTicket.status.in_(["open", "watching"]))
            .order_by(asc(AIPredictionTicket.updated_at))
            .limit(limit)
        ).all()

        reviewed: list[dict[str, Any]] = []
        for ticket in tickets:
            last_touch = self._as_utc(ticket.updated_at or ticket.created_at or now)
            if last_touch and now - last_touch < timedelta(minutes=max(1, min_interval_minutes)):
                continue

            due_at = self._prediction_due_at(ticket)
            scope = self._extract_ticket_scope(ticket=ticket, now=now, due_at=due_at)
            recent_events = self._load_prediction_review_events(ticket=ticket, now=now, limit=220)
            score, evidence = self._score_prediction_against_events(
                ticket=ticket,
                events=recent_events,
                now=now,
            )
            prev_status = str(ticket.status or "open").lower()
            prev_outcome = str(ticket.outcome or "unknown").lower()
            is_due = due_at <= now
            next_status = "resolved" if is_due else "watching"
            if is_due:
                if score >= 0.67:
                    next_outcome = "correct"
                elif score >= 0.40:
                    next_outcome = "partial"
                else:
                    next_outcome = "wrong"
            else:
                next_outcome = "unknown"

            next_confidence = max(0.05, min(0.99, round(score, 2)))
            next_related_event_ids = self._normalize_related_event_ids_text(ticket.related_event_ids or "")
            if evidence:
                related_ids = self._normalize_related_event_ids_text(
                    ",".join(str(event.id) for event, _ in evidence[:120] if event.id is not None)
                )
                if related_ids:
                    next_related_event_ids = related_ids

            status_text = self._status_label_ar(next_status)
            outcome_text = self._outcome_label_ar(next_outcome)
            next_note = self._build_auto_review_note(
                ticket=ticket,
                scope=scope,
                events_scanned=len(recent_events),
                score=score,
                due_at=due_at,
                now=now,
                evidence=evidence,
                status_text=status_text,
                outcome_text=outcome_text,
            )
            next_update_outcome = next_outcome if next_status == "resolved" else None

            prev_confidence = float(ticket.confidence or 0.0)
            prev_related_event_ids = self._normalize_related_event_ids_text(ticket.related_event_ids or "")
            confidence_changed = abs(prev_confidence - next_confidence) >= 0.03
            related_changed = not self._related_ids_set_equal(prev_related_event_ids, next_related_event_ids)
            state_changed = (
                prev_status != next_status
                or prev_outcome != next_outcome
                or confidence_changed
                or related_changed
            )
            last_update = self.session.exec(
                select(AIPredictionUpdate)
                .where(AIPredictionUpdate.ticket_id == (ticket.id or 0))
                .order_by(desc(AIPredictionUpdate.created_at))
                .limit(1)
            ).first()
            same_as_last_auto_review = bool(
                last_update
                and str(last_update.kind or "").lower() == "auto_review"
                and self._normalize_text_for_compare(last_update.content) == self._normalize_text_for_compare(next_note)
                and (last_update.outcome or None) == next_update_outcome
            )
            if same_as_last_auto_review and not state_changed:
                continue

            ticket.status = next_status
            ticket.outcome = next_outcome
            ticket.confidence = next_confidence
            ticket.updated_at = now
            ticket.related_event_ids = next_related_event_ids

            update = AIPredictionUpdate(
                ticket_id=ticket.id or 0,
                kind="auto_review",
                content=next_note,
                outcome=next_update_outcome,
            )
            self.session.add(ticket)
            self.session.add(update)
            self.session.commit()
            self.session.refresh(ticket)
            self.session.refresh(update)
            reviewed.append(
                {
                    "ticket_id": ticket.id,
                    "update_id": update.id,
                    "title": ticket.title,
                    "score": ticket.confidence,
                    "status": ticket.status,
                    "outcome": ticket.outcome,
                    "created_at": update.created_at,
                    "outcome_changed": prev_outcome != next_outcome or prev_status != next_status,
                }
            )
        return reviewed

    @staticmethod
    def _prediction_due_at(ticket: AIPredictionTicket) -> datetime:
        created = AIWorkspaceService._as_utc(ticket.created_at or datetime.now(timezone.utc))
        hours = max(1, int(ticket.horizon_hours or 24))
        return created + timedelta(hours=hours)

    @staticmethod
    def _status_label_ar(status: str) -> str:
        key = str(status or "").strip().lower()
        if key == "resolved":
            return "مغلق"
        if key == "watching":
            return "مراقبة"
        if key == "open":
            return "مفتوح"
        return "غير معروف"

    @staticmethod
    def _outcome_label_ar(outcome: str) -> str:
        key = str(outcome or "").strip().lower()
        if key == "correct":
            return "صحيح"
        if key == "partial":
            return "جزئي"
        if key == "wrong":
            return "خاطئ"
        if key == "unknown":
            return "غير محسوم"
        return "غير محسوم"

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _normalize_text_for_compare(value: str) -> str:
        return " ".join(str(value or "").split())

    @staticmethod
    def _normalize_digits(value: str) -> str:
        digit_map = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
        return str(value or "").translate(digit_map)

    @staticmethod
    def _normalize_related_event_ids_text(value: str) -> str:
        ids: set[int] = set()
        for token in re.split(r"[,\s]+", str(value or "")):
            token = token.strip()
            if token.isdigit():
                ids.add(int(token))
        return ",".join(str(item) for item in sorted(ids))

    @staticmethod
    def _related_ids_set_equal(a: str, b: str) -> bool:
        return AIWorkspaceService._normalize_related_event_ids_text(a) == AIWorkspaceService._normalize_related_event_ids_text(b)

    @staticmethod
    def _tokenize_prediction_text(text: str, *, min_len: int = 3, max_tokens: int = 40) -> list[str]:
        tokens = re.findall(r"[a-zA-Z0-9\u0600-\u06FF_]+", (text or "").lower())
        seen: set[str] = set()
        out: list[str] = []
        for token in tokens:
            if len(token) < min_len:
                continue
            if token in seen:
                continue
            seen.add(token)
            out.append(token)
            if len(out) >= max_tokens:
                break
        return out

    @staticmethod
    def _extract_scope_field(text: str, keys: list[str]) -> str:
        body = str(text or "")
        for key in keys:
            match = re.search(rf"(?im)^\s*{re.escape(key)}\s*[:=]\s*(.+?)\s*$", body)
            if match:
                return match.group(1).strip()
        return ""

    @staticmethod
    def _parse_scope_date(value: str) -> datetime | None:
        text = AIWorkspaceService._normalize_digits(value)
        if not text:
            return None

        iso_match = re.search(r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})", text)
        if iso_match:
            year, month, day = (int(iso_match.group(i)) for i in (1, 2, 3))
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                return None

        dmy_match = re.search(r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})", text)
        if dmy_match:
            day, month, year = (int(dmy_match.group(i)) for i in (1, 2, 3))
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                return None

        return None

    @staticmethod
    def _country_markers(country_text: str) -> list[str]:
        raw = str(country_text or "").strip().lower()
        if not raw:
            return []

        aliases = {
            "uae": ["uae", "united arab emirates", "dubai", "abu dhabi", "الإمارات", "الامارات", "أبوظبي", "دبي"],
            "الإمارات": ["uae", "united arab emirates", "dubai", "abu dhabi", "الإمارات", "الامارات", "أبوظبي", "دبي"],
            "saudi arabia": ["saudi", "saudi arabia", "ksa", "السعودية", "الرياض", "جدة"],
            "السعودية": ["saudi", "saudi arabia", "ksa", "السعودية", "الرياض", "جدة"],
            "qatar": ["qatar", "doha", "قطر", "الدوحة"],
            "قطر": ["qatar", "doha", "قطر", "الدوحة"],
            "kuwait": ["kuwait", "الكويت"],
            "الكويت": ["kuwait", "الكويت"],
            "bahrain": ["bahrain", "البحرين", "المنامة"],
            "البحرين": ["bahrain", "البحرين", "المنامة"],
            "oman": ["oman", "عمان", "مسقط"],
            "عمان": ["oman", "عمان", "مسقط"],
            "jordan": ["jordan", "الأردن", "amman"],
            "الأردن": ["jordan", "الأردن", "amman"],
        }

        markers: set[str] = {raw}
        for key, values in aliases.items():
            if raw == key or raw in values:
                markers.add(key)
                markers.update(values)
        return sorted({item.lower() for item in markers if item}, key=len, reverse=True)

    def _ticket_scope_start(self, *, ticket: AIPredictionTicket, now: datetime, from_text: str) -> datetime:
        parsed_from = self._parse_scope_date(from_text)
        if parsed_from is not None:
            start = parsed_from
        else:
            start = self._as_utc(ticket.created_at or now)
            related_ids_text = self._normalize_related_event_ids_text(ticket.related_event_ids or "")
            if related_ids_text:
                related_ids = [int(token) for token in related_ids_text.split(",") if token.isdigit()]
                if related_ids:
                    rows = self.session.exec(select(Event).where(Event.id.in_(related_ids))).all()
                    if rows:
                        min_related = min(self._as_utc(row.event_time) for row in rows)
                        if min_related < start:
                            start = min_related

        min_allowed = now - timedelta(days=45)
        if start < min_allowed:
            start = min_allowed
        return start

    def _extract_ticket_scope(self, *, ticket: AIPredictionTicket, now: datetime, due_at: datetime) -> dict[str, Any]:
        request_text = str(ticket.request_text or "")
        country = self._extract_scope_field(request_text, ["scope_country", "الدولة المستهدفة"]) or ""
        topic = self._extract_scope_field(request_text, ["scope_topic", "الموضوع"]) or ""
        from_text = self._extract_scope_field(request_text, ["scope_from", "analysis_date_from", "analysis_from"]) or ""

        start = self._ticket_scope_start(ticket=ticket, now=now, from_text=from_text)
        end = now if due_at > now else due_at
        if end <= start:
            end = now

        return {
            "country": country,
            "topic": topic,
            "from_text": from_text,
            "start": start,
            "end": end,
            "country_tokens": self._country_markers(country),
            "topic_tokens": self._tokenize_prediction_text(topic, min_len=3, max_tokens=12),
            "focus_tokens": self._tokenize_prediction_text(ticket.focus_query or "", min_len=3, max_tokens=18),
            "request_tokens": self._tokenize_prediction_text(request_text, min_len=4, max_tokens=24),
        }

    @staticmethod
    def _event_review_text(event: Event) -> str:
        return " ".join(
            [
                str(event.title or ""),
                str(event.summary or ""),
                str(event.details or ""),
                str(event.tags or ""),
                str(event.ai_assessment or ""),
                str(event.source_name or ""),
            ]
        ).lower()

    def _load_prediction_review_events(
        self,
        *,
        ticket: AIPredictionTicket,
        now: datetime,
        limit: int,
    ) -> list[Event]:
        due_at = self._prediction_due_at(ticket)
        scope = self._extract_ticket_scope(ticket=ticket, now=now, due_at=due_at)
        start = self._as_utc(scope["start"])
        end = self._as_utc(scope["end"])

        rows = self.session.exec(
            select(Event)
            .where(Event.event_time >= start)
            .where(Event.event_time <= end)
            .order_by(desc(Event.event_time))
            .limit(2400)
        ).all()
        if not rows:
            return []

        related_ids = {
            int(token)
            for token in self._normalize_related_event_ids_text(ticket.related_event_ids or "").split(",")
            if token.isdigit()
        }

        focus_tokens = scope["focus_tokens"]
        request_tokens = scope["request_tokens"]
        topic_tokens = scope["topic_tokens"]
        country_tokens = scope["country_tokens"]
        signal_tokens = [*focus_tokens, *topic_tokens, *request_tokens]

        ranked: list[tuple[float, Event]] = []
        for row in rows:
            text = self._event_review_text(row)
            score = 0.0
            if row.id in related_ids:
                score += 4.0
            if country_tokens and any(token in text for token in country_tokens):
                score += 3.0
            if topic_tokens and any(token in text for token in topic_tokens):
                score += 2.0
            if signal_tokens:
                score += min(4.0, sum(1 for token in signal_tokens if token in text) * 0.6)

            if score <= 0:
                continue
            score += float(row.severity or 1) * 0.4
            ranked.append((score, row))

        if not ranked:
            return rows[:limit]

        ranked.sort(key=lambda item: (item[0], self._as_utc(item[1].event_time).timestamp()), reverse=True)
        return [row for _, row in ranked[:limit]]

    def _score_prediction_against_events(
        self,
        *,
        ticket: AIPredictionTicket,
        events: list[Event],
        now: datetime,
    ) -> tuple[float, list[tuple[Event, list[str]]]]:
        if not events:
            return 0.15, []

        focus_tokens = self._tokenize_prediction_text(ticket.focus_query or "", min_len=3, max_tokens=18)
        prediction_tokens = self._tokenize_prediction_text(ticket.prediction_text or "", min_len=4, max_tokens=18)
        request_tokens = self._tokenize_prediction_text(ticket.request_text or "", min_len=4, max_tokens=18)

        signal_tokens: list[str] = []
        seen: set[str] = set()
        for token in [*focus_tokens, *prediction_tokens, *request_tokens]:
            if token in seen:
                continue
            seen.add(token)
            signal_tokens.append(token)
            if len(signal_tokens) >= 28:
                break

        if not signal_tokens:
            signal_tokens = ["gulf", "الخليج", "war", "حرب"]

        related_ids = {
            int(token)
            for token in self._normalize_related_event_ids_text(ticket.related_event_ids or "").split(",")
            if token.isdigit()
        }

        evidence: list[tuple[Event, list[str]]] = []
        total_hit_units = 0.0
        for event in events:
            text = self._event_review_text(event)
            hits = [token for token in signal_tokens if token in text]
            if not hits and event.id in related_ids:
                hits = ["مرتبط_سابقاً"]
            if not hits:
                continue
            evidence.append((event, hits[:8]))
            total_hit_units += min(5, len(hits))

        if not evidence:
            return 0.18, []

        top = evidence[:16]
        token_budget = max(8, len(signal_tokens) * 1.7)
        hit_strength = min(1.0, total_hit_units / token_budget)
        matched_ratio = min(1.0, len(top) / max(6, min(20, len(events))))
        severity = min(1.0, sum((event.severity or 1) for event, _ in top) / (5.0 * len(top)))

        newest_event_time = max(self._as_utc(event.event_time) for event, _ in top)
        horizon_hours = max(6, int(ticket.horizon_hours or 24))
        recency = 1.0 - min(1.0, max(0.0, (now - newest_event_time).total_seconds() / 3600.0) / horizon_hours)

        score = (0.40 * hit_strength) + (0.25 * matched_ratio) + (0.25 * severity) + (0.10 * recency)
        return round(max(0.05, min(0.99, score)), 2), top

    def _build_auto_review_note(
        self,
        *,
        ticket: AIPredictionTicket,
        scope: dict[str, Any],
        events_scanned: int,
        score: float,
        due_at: datetime,
        now: datetime,
        evidence: list[tuple[Event, list[str]]],
        status_text: str,
        outcome_text: str,
    ) -> str:
        score_text = f"{round(score * 100)}%"
        due_text = due_at.astimezone(timezone.utc).isoformat()
        start_text = self._as_utc(scope.get("start", now)).date().isoformat()
        end_text = self._as_utc(scope.get("end", now)).date().isoformat()
        country = str(scope.get("country") or "غير محدد")
        topic = str(scope.get("topic") or "غير محدد")

        if score >= 0.67:
            trend = "اتجاه مؤيد للتوقع الأصلي مع اتساق جيد في الأدلة."
        elif score >= 0.40:
            trend = "اتجاه مختلط: جزء من الأدلة يؤيد التوقع وجزء يحتاج تحقق إضافي."
        else:
            trend = "اتجاه ضعيف للتوقع الحالي؛ الأدلة المتاحة لا تدعمه بشكل كافٍ."

        lines = [
            "مراجعة آلية للتذكرة.",
            f"عنوان التذكرة: {ticket.title}",
            f"التركيز: {ticket.focus_query}",
            f"النطاق: {country} | {topic} | من {start_text} إلى {end_text}",
            f"الحالة: {status_text} | النتيجة: {outcome_text} | الدرجة: {score_text}",
            f"الأحداث المطابقة: {len(evidence)} من أصل {events_scanned} حدث ضمن نطاق التذكرة.",
            f"موعد الاستحقاق (UTC): {due_text}",
            f"قراءة تحليلية: {trend}",
        ]

        if evidence:
            lines.append("أدلة القرار (مرتبطة بموضوع التذكرة فقط):")
            for event, hits in evidence[:3]:
                source_name = str(event.source_name or "مصدر غير محدد")[:60]
                title = str(event.title or "")[:120]
                hit_text = ", ".join(hits[:4])
                lines.append(f"- [S{event.severity}] {source_name}: {title} | إشارات: {hit_text}")
        else:
            lines.append("لا توجد أدلة كافية ضمن نطاق التذكرة حتى الآن؛ يستمر الرصد دون تغيير قرار التذكرة.")

        lines.append("توقع قصير المدى: استمر في نفس مسار التذكرة مع تحديث التقييم عند ظهور أدلة أقوى داخل نفس النطاق.")
        return "\n".join(lines)[:3500]

    def auto_update_predictions_for_event(self, event: Event) -> list[AIPredictionUpdate]:
        # Keep scheduled ticket reviews as the single source of truth.
        # Event-driven mini updates were producing feed-like noise.
        return []

    def chat(self, message: str, event_ids: list[int] | None = None) -> tuple[AIChatMessage, AIInsight | None]:
        clean_message = message.strip()
        user_message = AIChatMessage(role="user", content=clean_message)
        self.session.add(user_message)
        self.session.commit()
        self.session.refresh(user_message)

        events = self._load_context_events(event_ids=event_ids or [], question=clean_message)
        answer = self._generate_answer(question=clean_message, events=events)

        assistant_message = AIChatMessage(role="assistant", content=answer)
        self.session.add(assistant_message)
        self.session.commit()
        self.session.refresh(assistant_message)

        created_insight: AIInsight | None = None
        if self._should_create_insight(clean_message):
            created_insight = self.create_insight(
                title="ØªØ­Ù„ÙŠÙ„ ØªÙ„Ù‚Ø§Ø¦ÙŠ Ù…Ù† Ø§Ù„Ù…Ø­Ø§Ø¯Ø«Ø©",
                prompt=clean_message,
                event_ids=event_ids or [],
            )
        return assistant_message, created_insight

    def create_insight(self, title: str, prompt: str, event_ids: list[int] | None = None) -> AIInsight:
        events = self._load_context_events(event_ids=event_ids or [], question=prompt)
        content = self._generate_report(prompt=prompt, events=events)
        related_event_ids = ",".join(str(event.id) for event in events[:80] if event.id is not None)
        insight = AIInsight(
            title=title.strip(),
            prompt=prompt.strip(),
            content=content,
            related_event_ids=related_event_ids,
        )
        self.session.add(insight)
        self.session.commit()
        self.session.refresh(insight)
        return insight

    def publish_report(
        self,
        title: str | None,
        prompt: str | None,
        insight_id: int | None,
        event_ids: list[int] | None = None,
    ) -> dict[str, str]:
        insight: AIInsight | None = None
        if insight_id is not None:
            insight = self.session.get(AIInsight, insight_id)
            if insight is None:
                raise ValueError("Insight not found")

        if insight is None:
            report_prompt = (prompt or "").strip()
            if not report_prompt:
                raise ValueError("prompt is required when insight_id is not provided")
            insight = self.create_insight(
                title=title or "ØªÙ‚Ø±ÙŠØ± ØªØ­Ù„ÙŠÙ„ÙŠ",
                prompt=report_prompt,
                event_ids=event_ids or [],
            )

        report_title = (title or insight.title or "ØªÙ‚Ø±ÙŠØ± ØªØ­Ù„ÙŠÙ„ÙŠ").strip()
        created_at = datetime.now(timezone.utc)
        report_id = f"{created_at.strftime('%Y%m%d%H%M%S')}-{_slug(report_title)}"
        reports_dir = Path(settings.reports_dir)
        reports_dir.mkdir(parents=True, exist_ok=True)

        related_events = self._events_from_related_ids(insight.related_event_ids)
        if not related_events:
            related_events = self._load_context_events(event_ids=event_ids or [], question=insight.prompt, limit=24)

        markdown = self._build_structured_markdown(
            report_id=report_id,
            report_title=report_title,
            created_at=created_at,
            prompt=insight.prompt,
            insight_content=insight.content,
            events=related_events,
        )

        filename = f"{report_id}.md"
        markdown_path = reports_dir / filename
        markdown_path.write_text(markdown, encoding="utf-8")

        pdf_filename = f"{report_id}.pdf"
        pdf_path = reports_dir / pdf_filename
        self._write_pdf(path=pdf_path, title=report_title, created_at=created_at, markdown=markdown)

        return {
            "report_id": report_id,
            "title": report_title,
            "filename": filename,
            "pdf_filename": pdf_filename,
            "created_at": created_at.isoformat(),
            "content": markdown,
        }

    def list_reports(self, limit: int = 40) -> list[dict[str, Any]]:
        reports_dir = Path(settings.reports_dir)
        if not reports_dir.exists():
            return []
        items: list[dict[str, str]] = []
        for path in sorted(reports_dir.glob("*.md"), reverse=True):
            created_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
            content = path.read_text(encoding="utf-8")
            first_line = next((line for line in content.splitlines() if line.startswith("# ")), "# ØªÙ‚Ø±ÙŠØ±")
            title = first_line[2:].strip() if len(first_line) > 2 else "ØªÙ‚Ø±ÙŠØ±"
            pdf_path = path.with_suffix(".pdf")
            items.append(
                {
                    "report_id": path.stem,
                    "title": title,
                    "filename": path.name,
                    "pdf_filename": pdf_path.name if pdf_path.exists() else None,
                    "created_at": created_at,
                    "content": content[:12000],
                }
            )
        return items[:limit]

    def get_report_file(self, report_id: str, prefer_pdf: bool = True) -> Path | None:
        reports_dir = Path(settings.reports_dir)
        if not reports_dir.exists():
            return None
        pdf_path = reports_dir / f"{report_id}.pdf"
        md_path = reports_dir / f"{report_id}.md"
        if prefer_pdf and pdf_path.exists():
            return pdf_path
        if md_path.exists():
            return md_path
        if pdf_path.exists():
            return pdf_path
        return None

    def translate_bulk_to_arabic(self, texts: list[str]) -> list[str]:
        cleaned = [str(text or "").strip()[:2000] for text in texts]
        cleaned = [text for text in cleaned if text]
        if not cleaned:
            return []
        if not self._client:
            return cleaned

        payload = {
            "task": "Translate each text to Modern Standard Arabic.",
            "rules": [
                "Keep meaning and named entities accurate.",
                "Do not add explanations.",
                "Return strict JSON only.",
                "JSON schema: {\"translations\": [\"...\"]} with same order and same length.",
            ],
            "texts": cleaned,
        }
        response_text = self._openai_text(
            system_prompt=(
                "You are a professional Arabic translator for operational intelligence content. "
                "Return strict JSON with key 'translations'."
            ),
            user_payload=payload,
            max_chars=14000,
        )
        if not response_text:
            return cleaned
        try:
            parsed = json.loads(response_text)
            values = parsed.get("translations")
            if not isinstance(values, list):
                return cleaned
            normalized = [str(item or "").strip() for item in values]
            if len(normalized) != len(cleaned):
                return cleaned
            return [normalized[i] or cleaned[i] for i in range(len(cleaned))]
        except Exception:
            return cleaned

    @staticmethod
    def _keyword_match(question: str, keywords: set[str]) -> bool:
        text = question.lower()
        return any(keyword in text for keyword in keywords)

    def _prioritized_types(self, question: str) -> list[str]:
        text = question.lower()
        if self._keyword_match(text, {"Ø®Ø¨Ø±", "Ø§Ø®Ø¨Ø§Ø±", "Ø£Ø®Ø¨Ø§Ø±", "news", "latest", "Ø§Ø®Ø±", "Ø¢Ø®Ø±"}):
            return ["news", "incident", "cyber", "social", "flight", "marine", "custom"]
        if self._keyword_match(text, {"flight", "Ø·ÙŠØ±Ø§Ù†", "air", "plane"}):
            return ["flight", "incident", "news", "marine", "cyber", "social", "custom"]
        if self._keyword_match(text, {"marine", "ship", "vessel", "Ù…Ù„Ø§Ø­Ø©", "Ø¨Ø­Ø±"}):
            return ["marine", "incident", "news", "flight", "cyber", "social", "custom"]
        if self._keyword_match(text, {"cyber", "Ø³ÙŠØ¨Ø±", "malware", "ransomware"}):
            return ["cyber", "incident", "news", "social", "flight", "marine", "custom"]
        return ["incident", "news", "cyber", "marine", "flight", "social", "custom"]

    @staticmethod
    def _diversify(rows: list[Event], limit: int) -> list[Event]:
        grouped: dict[str, list[Event]] = defaultdict(list)
        for row in rows:
            grouped[row.source_type].append(row)

        order = sorted(
            grouped.keys(),
            key=lambda source_type: grouped[source_type][0].event_time if grouped[source_type] else datetime.min,
            reverse=True,
        )
        selected: list[Event] = []
        while len(selected) < limit and any(grouped.values()):
            for source_type in order:
                if grouped[source_type]:
                    selected.append(grouped[source_type].pop(0))
                    if len(selected) >= limit:
                        break
        return selected

    def _load_context_events(self, event_ids: list[int], question: str = "", limit: int = 90) -> list[Event]:
        if event_ids:
            rows = self.session.exec(select(Event).where(Event.id.in_(event_ids))).all()
            return sorted(rows, key=lambda event: event.event_time, reverse=True)

        rows = self.session.exec(select(Event).order_by(desc(Event.event_time)).limit(600)).all()
        if not rows:
            return []

        priorities = self._prioritized_types(question)
        rank = {source_type: index for index, source_type in enumerate(priorities)}
        rows = sorted(
            rows,
            key=lambda row: (
                rank.get(row.source_type, 999),
                -row.severity,
                -row.event_time.timestamp(),
            ),
        )

        if self._keyword_match(question, {"Ø®Ø¨Ø±", "Ø§Ø®Ø¨Ø§Ø±", "Ø£Ø®Ø¨Ø§Ø±", "news", "latest", "Ø§Ø®Ø±", "Ø¢Ø®Ø±"}):
            news_rows = [row for row in rows if row.source_type == "news"][:40]
            news_ids = {row.id for row in news_rows}
            remaining = [row for row in rows if row.id not in news_ids]
            diversified = self._diversify(remaining, max(0, limit - len(news_rows)))
            return (news_rows + diversified)[:limit]

        return self._diversify(rows, limit)

    def _events_from_related_ids(self, related_event_ids: str) -> list[Event]:
        if not related_event_ids:
            return []
        ids: list[int] = []
        for token in related_event_ids.split(","):
            token = token.strip()
            if token.isdigit():
                ids.append(int(token))
        if not ids:
            return []
        rows = self.session.exec(select(Event).where(Event.id.in_(ids))).all()
        return sorted(rows, key=lambda event: event.event_time, reverse=True)

    def _candidate_models(self) -> list[str]:
        models = [settings.openai_model.strip() if settings.openai_model else "", "gpt-4.1-mini"]
        seen: set[str] = set()
        ordered: list[str] = []
        for model in models:
            if model and model not in seen:
                ordered.append(model)
                seen.add(model)
        return ordered

    def _openai_text(
        self,
        *,
        system_prompt: str,
        user_payload: dict[str, Any],
        max_chars: int,
    ) -> str | None:
        if not self._client:
            return None

        user_text = json.dumps(user_payload, ensure_ascii=False)
        for model in self._candidate_models():
            try:
                if hasattr(self._client, "responses"):
                    result = self._client.responses.create(
                        model=model,
                        input=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_text},
                        ],
                    )
                    text = (getattr(result, "output_text", "") or "").strip()
                    if text:
                        return text[:max_chars]
                    continue

                if hasattr(self._client, "chat") and hasattr(self._client.chat, "completions"):
                    result = self._client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_text},
                        ],
                        temperature=0.2,
                    )
                    choice = result.choices[0] if result.choices else None
                    text = (choice.message.content if choice and choice.message else "") or ""
                    text = text.strip()
                    if text:
                        return text[:max_chars]
            except Exception:
                continue
        return None

    def _generate_answer(self, question: str, events: list[Event]) -> str:
        if self._client:
            text = self._openai_text(
                system_prompt=(
                    "You are an operations analyst for Gulf regional monitoring. "
                    "Answer only in Arabic with concise actionable bullet points and one follow-up question. "
                    "You MUST use all provided events (official/media/social) and not ignore non-official sources. "
                    "For sensitive claims (fatalities, injuries, airport/critical infrastructure strikes), label confidence explicitly "
                    "as one of: confirmed / probable / unconfirmed, and include source reference using event id and source_name. "
                    "For mitigation planning, provide two tracks: current actions and predictive actions (next 6-24 hours). "
                    "Avoid generic repeated mitigation text; tie each action to specific evidence, country context, and operational domain. "
                    "If numbers conflict, prefer the latest official figure as confirmed and list alternatives as unconfirmed. "
                    "Never invent numbers; if unavailable, state that clearly."
                ),
                user_payload={
                    "question": question,
                    "events": json.loads(_events_context(events, limit=35)),
                    "language": "arabic",
                },
                max_chars=3500,
            )
            if text:
                return text
            return (
                "ØªØ¹Ø°Ø± Ø§Ù„Ø­ØµÙˆÙ„ Ø¹Ù„Ù‰ Ø±Ø¯ Ù…Ù† OpenAI Ø­Ø§Ù„ÙŠØ§Ù‹. "
                "ØªØ­Ù‚Ù‚ Ù…Ù† ØµÙ„Ø§Ø­ÙŠØ© Ø§Ù„Ù…ÙØªØ§Ø­ØŒ Ø§Ø³Ù… Ø§Ù„Ù†Ù…ÙˆØ°Ø¬ØŒ ÙˆØ§ØªØµØ§Ù„ Ø§Ù„Ø¥Ù†ØªØ±Ù†Øª ÙÙŠ Ø§Ù„Ø®Ø§Ø¯Ù…."
            )

        return self._local_answer(question=question, events=events)

    def _generate_report(self, prompt: str, events: list[Event]) -> str:
        if self._client:
            text = self._openai_text(
                system_prompt=(
                    "Create an Arabic operational report for decision makers with sections: "
                    "executive summary, key developments, risks, recommendations, and next questions. "
                    "Use all provided events and mark sensitive claims with confidence levels (confirmed/probable/unconfirmed). "
                    "Mitigation recommendations must be domain-specific and split into current and predictive actions (next 6-24 hours). "
                    "Do not repeat static boilerplate mitigation language across different reports. "
                    "When casualty numbers conflict, keep latest official as confirmed and show alternatives as unconfirmed."
                ),
                user_payload={
                    "task": "Generate operational report in Arabic",
                    "prompt": prompt,
                    "events": json.loads(_events_context(events, limit=60)),
                },
                max_chars=7000,
            )
            if text:
                return text
            return (
                "ØªØ¹Ø°Ø± Ø¥Ù†Ø´Ø§Ø¡ Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ø¹Ø¨Ø± OpenAI Ø­Ø§Ù„ÙŠØ§Ù‹. "
                "ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ù…ÙØªØ§Ø­ ÙˆØ§Ù„Ù†Ù…ÙˆØ°Ø¬ ÙˆØ§Ù„Ø§ØªØµØ§Ù„ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©."
            )

        return self._local_report(prompt=prompt, events=events)

    def _local_answer(self, question: str, events: list[Event]) -> str:
        if not events:
            return "Ù„Ø§ ØªÙˆØ¬Ø¯ Ø£Ø­Ø¯Ø§Ø« ÙƒØ§ÙÙŠØ© Ø­Ø§Ù„ÙŠØ§Ù‹. Ù†ÙØ° ØªØ­Ø¯ÙŠØ«Ø§Ù‹ ÙÙˆØ±ÙŠØ§Ù‹ Ø«Ù… Ø£Ø¹Ø¯ Ø§Ù„Ø³Ø¤Ø§Ù„."

        source_counts = Counter(event.source_type for event in events)
        severe = [event for event in events if event.severity >= 4]
        news = [event for event in events if event.source_type == "news"][:5]
        social_text = " ".join(
            f"{event.title} {event.summary or ''} {event.details or ''}"
            for event in events
            if event.source_type == "social"
        )
        social_label, social_score = sentiment(social_text) if social_text else ("neutral", 0.0)
        latest = events[0]

        lines = [
            "Ù…Ù„Ø®Øµ Ù…Ø³Ø§Ø¹Ø¯ Ø§Ù„Ø°ÙƒØ§Ø¡ (ÙˆØ¶Ø¹ Ù…Ø­Ù„ÙŠ):",
            f"- Ø£Ø­Ø¯Ø« Ø­Ø¯Ø«: {latest.title}",
            f"- Ø§Ù„ØªÙˆØ²ÙŠØ¹ Ø­Ø³Ø¨ Ø§Ù„Ù…ØµØ¯Ø±: {dict(source_counts)}",
            f"- Ø§Ù„Ø£Ø­Ø¯Ø§Ø« Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø´Ø¯Ø©: {len(severe)}",
            f"- Ù…Ø²Ø§Ø¬ Ø§Ù„Ø³ÙˆØ´Ø§Ù„: {social_label} ({social_score})",
            f"- Ø³Ø¤Ø§Ù„Ùƒ: {question}",
        ]
        if news:
            lines.append("- Ø¢Ø®Ø± Ø¹Ù†Ø§ÙˆÙŠÙ† Ø§Ù„Ø£Ø®Ø¨Ø§Ø±:")
            for item in news:
                lines.append(f"  - {item.title}")
        lines.append("Ù…Ø§ Ø§Ù„Ø°ÙŠ ØªØ±ÙŠØ¯ Ø§Ù„ØªØ¹Ù…Ù‚ ÙÙŠÙ‡ Ø£ÙƒØ«Ø±: Ø§Ù„Ø­Ø±Ø¨ØŒ Ø§Ù„Ù…Ù„Ø§Ø­Ø©ØŒ Ø§Ù„Ø·ÙŠØ±Ø§Ù†ØŒ Ø£Ùˆ Ø§Ù„Ø£Ù…Ù† Ø§Ù„Ø³ÙŠØ¨Ø±Ø§Ù†ÙŠØŸ")
        return "\n".join(lines)[:3500]

    def _local_report(self, prompt: str, events: list[Event]) -> str:
        if not events:
            return "Ù„Ø§ ØªØªÙˆÙØ± Ø¨ÙŠØ§Ù†Ø§Øª ÙƒØ§ÙÙŠØ© Ù„Ø¨Ù†Ø§Ø¡ ØªÙ‚Ø±ÙŠØ± Ø­Ø§Ù„ÙŠØ§Ù‹."

        source_counts = Counter(event.source_type for event in events)
        severe = [event for event in events if event.severity >= 4]
        top_events = events[:8]
        lines = [
            f"Ø§Ù„Ù…ÙˆØ¶ÙˆØ¹: {prompt}",
            "Ø§Ù„Ù…Ù„Ø®Øµ:",
            f"- ØªÙ… ØªØ­Ù„ÙŠÙ„ {len(events)} Ø­Ø¯Ø«Ø§Ù‹.",
            f"- Ø§Ù„ØªÙˆØ²ÙŠØ¹ Ø­Ø³Ø¨ Ø§Ù„Ù…ØµØ¯Ø±: {dict(source_counts)}.",
            f"- Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø­Ø¯Ø§Ø« Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø´Ø¯Ø©: {len(severe)}.",
            "",
            "Ø£Ù‡Ù… Ø§Ù„Ù…Ø¤Ø´Ø±Ø§Øª:",
        ]
        for event in top_events:
            lines.append(f"- [{event.source_type}] {event.title} (S{event.severity})")
        lines.extend(
            [
                "",
                "Ø§Ù„ØªÙˆØµÙŠØ§Øª:",
                "- Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø© Ø§Ù„Ù„Ø­Ø¸ÙŠØ© Ù„Ù„Ù…ØµØ§Ø¯Ø± Ø§Ù„Ù…ÙˆØ«ÙˆÙ‚Ø©.",
                "- Ù…Ø±Ø§Ø¬Ø¹Ø© Ø§Ù„ØªØ·ÙˆØ±Ø§Øª ÙƒÙ„ 30 Ø¯Ù‚ÙŠÙ‚Ø© ÙÙŠ Ø­Ø§Ù„Ø§Øª Ø§Ù„ØªØµØ¹ÙŠØ¯.",
                "- Ù†Ø´Ø± ØªÙ‚Ø±ÙŠØ± Ø¯ÙˆØ±ÙŠ Ù„ÙØ±Ù‚ Ø§Ù„Ø¹Ù…Ù„ÙŠØ§Øª.",
                "",
                "Ø£Ø³Ø¦Ù„Ø© Ù…ØªØ§Ø¨Ø¹Ø©:",
                "- Ù‡Ù„ ØªØ±ÙŠØ¯ ØªØ±ÙƒÙŠØ² Ø§Ù„ØªÙ‚Ø±ÙŠØ± Ø¹Ù„Ù‰ Ø³ÙŠÙ†Ø§Ø±ÙŠÙˆ Ø§Ù„Ø­Ø±Ø¨ ÙÙ‚Ø·ØŸ",
                "- Ù‡Ù„ ØªØ±ÙŠØ¯ Ù…Ù‚Ø§Ø±Ù†Ø© Ø§Ù„Ø£Ø®Ø¨Ø§Ø± Ø§Ù„Ø±Ø³Ù…ÙŠØ© Ù…Ø¹ Ø¥Ø´Ø§Ø±Ø§Øª Ø§Ù„Ø³ÙˆØ´Ø§Ù„ØŸ",
            ]
        )
        return "\n".join(lines)[:6000]

    def _build_structured_markdown(
        self,
        *,
        report_id: str,
        report_title: str,
        created_at: datetime,
        prompt: str,
        insight_content: str,
        events: list[Event],
    ) -> str:
        source_counts = Counter(event.source_type for event in events)
        severe_count = sum(1 for event in events if event.severity >= 4)
        top_events = events[:12]
        executive = _clean_lines(insight_content)
        executive_text = " ".join(line for line in executive if line)[:900] or "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù…Ù„Ø®Øµ Ù…ØªØ§Ø­."

        lines: list[str] = [
            f"# {report_title}",
            "",
            "## Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªÙ‚Ø±ÙŠØ±",
            f"- Ø±Ù‚Ù… Ø§Ù„ØªÙ‚Ø±ÙŠØ±: {report_id}",
            f"- ÙˆÙ‚Øª Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (UTC): {created_at.isoformat()}",
            f"- Ù…ÙˆØ¶ÙˆØ¹ Ø§Ù„Ø·Ù„Ø¨: {prompt or 'ØºÙŠØ± Ù…ØªØ§Ø­'}",
            "",
            "## Ø§Ù„Ù…Ù„Ø®Øµ Ø§Ù„ØªÙ†ÙÙŠØ°ÙŠ",
            executive_text,
            "",
            "## Ø§Ù„ØµÙˆØ±Ø© Ø§Ù„ØªØ´ØºÙŠÙ„ÙŠØ©",
            f"- Ø¹Ø¯Ø¯ Ø§Ù„Ø£Ø­Ø¯Ø§Ø« Ø§Ù„Ù…Ø­Ù„Ù„Ø©: {len(events)}",
            f"- Ø§Ù„Ø£Ø­Ø¯Ø§Ø« Ø¹Ø§Ù„ÙŠØ© Ø§Ù„Ø´Ø¯Ø© (S4-S5): {severe_count}",
            f"- ØªÙˆØ²ÙŠØ¹ Ø§Ù„Ù…ØµØ§Ø¯Ø±: {dict(source_counts)}",
            "",
            "## Ø£Ø¨Ø±Ø² Ø§Ù„ØªØ·ÙˆØ±Ø§Øª",
        ]
        if not top_events:
            lines.append("- Ù„Ø§ ØªÙˆØ¬Ø¯ Ø£Ø­Ø¯Ø§Ø« Ù…Ø±ÙÙ‚Ø© Ø¨Ù‡Ø°Ø§ Ø§Ù„ØªÙ‚Ø±ÙŠØ±.")
        else:
            for event in top_events:
                timestamp = event.event_time.isoformat()
                details = f"[{event.source_type}] S{event.severity} | {timestamp} | {event.title}"
                lines.append(f"- {details}")
                if event.url:
                    lines.append(f"  - Ø±Ø§Ø¨Ø· Ø§Ù„Ù…ØµØ¯Ø±: {event.url}")

        lines.extend(
            [
                "",
                "## ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø°ÙƒØ§Ø¡ Ø§Ù„Ø§ØµØ·Ù†Ø§Ø¹ÙŠ",
                insight_content.strip() or "Ù„Ø§ ÙŠÙˆØ¬Ø¯ Ù†Øµ ØªØ­Ù„ÙŠÙ„ Ù…ØªØ§Ø­.",
                "",
                "## ØªÙˆØµÙŠØ§Øª Ø§Ù„Ù‚Ø±Ø§Ø±",
                "- Ø§Ù„Ø§Ø³ØªÙ…Ø±Ø§Ø± ÙÙŠ Ù…Ø±Ø§Ù‚Ø¨Ø© Ø§Ù„Ù…ØµØ§Ø¯Ø± Ø§Ù„Ù…ÙˆØ«ÙˆÙ‚Ø© Ø¨ÙˆØªÙŠØ±Ø© Ø«Ø§Ø¨ØªØ© Ù…Ø¹ Ø¹ØªØ¨Ø§Øª ØªØµØ¹ÙŠØ¯ ÙˆØ§Ø¶Ø­Ø©.",
                "- Ø§Ù„ØªØ­Ù‚Ù‚ Ù…Ù† Ø§Ù„Ø£Ø®Ø¨Ø§Ø± Ø§Ù„Ù…ØªØ¹Ø§Ø±Ø¶Ø© Ø¹Ø¨Ø± Ù…ØµØ¯Ø±ÙŠÙ† Ù…ÙˆØ«ÙˆÙ‚ÙŠÙ† Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„ Ù‚Ø¨Ù„ Ø§Ù„ØªØ¹Ù…ÙŠÙ….",
                "- Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ù…Ø±ÙƒØ² Ù„Ù„Ø£Ø­Ø¯Ø§Ø« Ø§Ù„Ù…Ø­Ø¯Ø¯Ø© Ù‚Ø¨Ù„ Ø£ÙŠ Ø¥Ø­Ø§Ø·Ø© ØªÙ†ÙÙŠØ°ÙŠØ©.",
                "",
                "## Ø£Ø³Ø¦Ù„Ø© Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©",
                "- Ù…Ø§ Ø§Ù„Ø³ÙŠÙ†Ø§Ø±ÙŠÙˆ Ø§Ù„Ø°ÙŠ ÙŠØ¬Ø¨ Ø¥Ø¹Ø·Ø§Ø¤Ù‡ Ø£ÙˆÙ„ÙˆÙŠØ© Ø®Ù„Ø§Ù„ Ø§Ù„Ù€ 6 Ø¥Ù„Ù‰ 12 Ø³Ø§Ø¹Ø© Ø§Ù„Ù‚Ø§Ø¯Ù…Ø©ØŸ",
                "- Ù‡Ù„ ØªØ­ØªØ§Ø¬ Ù…ÙˆØ¬Ø²Ø§Ù‹ Ù‚Ø·Ø§Ø¹ÙŠØ§Ù‹ Ù…Ø­Ø¯Ø¯Ø§Ù‹ (Ø·ÙŠØ±Ø§Ù†ØŒ Ù…Ù„Ø§Ø­Ø©ØŒ Ø³ÙŠØ¨Ø±Ø§Ù†ÙŠ)ØŸ",
                "- Ù‡Ù„ Ù†ÙÙ†Ø´Ø± Ù†Ø³Ø®Ø© Ù…Ø®ØªØµØ±Ø© Ù„Ù„Ù‚ÙŠØ§Ø¯Ø© Ù…Ù† Ù‡Ø°Ø§ Ø§Ù„ØªÙ‚Ø±ÙŠØ±ØŸ",
            ]
        )
        return "\n".join(lines).strip()

    def _write_pdf(self, *, path: Path, title: str, created_at: datetime, markdown: str) -> None:
        pdf = canvas.Canvas(str(path), pagesize=A4)
        width, height = A4
        margin = 42
        content_width = width - margin * 2
        y = height - margin
        regular_font, bold_font = _register_pdf_fonts()

        def draw_line(text: str, *, bold: bool = False, font_size: int = 11, gap: int = 5) -> None:
            nonlocal y
            value = str(text or "")
            is_rtl = _contains_arabic(value)
            rendered = _rtl_text(value) if is_rtl else value
            font_name = bold_font if bold else regular_font
            wrapped = simpleSplit(rendered, font_name, font_size, content_width) or [""]
            for row in wrapped:
                if y < margin + 20:
                    pdf.showPage()
                    y = height - margin
                pdf.setFont(font_name, font_size)
                if is_rtl:
                    pdf.drawRightString(width - margin, y, row)
                else:
                    pdf.drawString(margin, y, row)
                y -= font_size + gap

        draw_line(title, bold=True, font_size=16, gap=7)
        draw_line(f"ØªÙ… Ø§Ù„Ø¥Ù†Ø´Ø§Ø¡ (UTC): {created_at.isoformat()}", font_size=9, gap=8)
        y -= 4

        for raw in _clean_lines(markdown):
            if not raw:
                y -= 6
                continue
            if raw.startswith("Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„ØªÙ‚Ø±ÙŠØ±") or raw.startswith("Ø§Ù„Ù…Ù„Ø®Øµ Ø§Ù„ØªÙ†ÙÙŠØ°ÙŠ"):
                draw_line(raw, bold=True, font_size=13, gap=6)
                continue
            if raw.startswith("Ø§Ù„ØµÙˆØ±Ø© Ø§Ù„ØªØ´ØºÙŠÙ„ÙŠØ©") or raw.startswith("Ø£Ø¨Ø±Ø² Ø§Ù„ØªØ·ÙˆØ±Ø§Øª"):
                draw_line(raw, bold=True, font_size=12, gap=6)
                continue
            if raw.startswith("ØªØ­Ù„ÙŠÙ„ Ø§Ù„Ø°ÙƒØ§Ø¡ Ø§Ù„Ø§ØµØ·Ù†Ø§Ø¹ÙŠ") or raw.startswith("ØªÙˆØµÙŠØ§Øª Ø§Ù„Ù‚Ø±Ø§Ø±") or raw.startswith("Ø£Ø³Ø¦Ù„Ø© Ø§Ù„Ù…ØªØ§Ø¨Ø¹Ø©"):
                draw_line(raw, bold=True, font_size=12, gap=6)
                continue
            if raw.startswith("Report Metadata") or raw.startswith("Executive Summary"):
                draw_line(raw, bold=True, font_size=13, gap=6)
                continue
            if raw.startswith("Operating Picture") or raw.startswith("Key Developments"):
                draw_line(raw, bold=True, font_size=12, gap=6)
                continue
            if raw.startswith("AI Analysis") or raw.startswith("Decision Recommendations") or raw.startswith("Follow-up Questions"):
                draw_line(raw, bold=True, font_size=12, gap=6)
                continue
            draw_line(raw, font_size=10, gap=5)

        pdf.save()

    @staticmethod
    def _estimate_confidence_from_text(text: str) -> float:
        value = 0.55
        lower = (text or "").lower()
        if "Ù…Ø±Ø¬Ø­" in lower or "Ø±Ø§Ø¬Ø­" in lower or "high probability" in lower:
            value += 0.15
        if "ØºÙŠØ± Ù…Ø¤ÙƒØ¯" in lower or "uncertain" in lower or "Ù…Ù†Ø®ÙØ¶ Ø§Ù„Ø§Ø­ØªÙ…Ø§Ù„" in lower:
            value -= 0.12
        return max(0.05, min(0.95, round(value, 2)))

    @staticmethod
    def _should_create_insight(message: str) -> bool:
        text = message.lower()
        markers = {"ØªØ­Ù„ÙŠÙ„", "ØªÙ‚Ø±ÙŠØ±", "analysis", "report", "dashboard", "war", "Ø­Ø±Ø¨"}
        return any(marker in text for marker in markers)


