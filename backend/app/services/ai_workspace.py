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
from sqlmodel import Session, desc, select

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


def _events_context(events: list[Event], limit: int = 30) -> str:
    rows: list[dict[str, Any]] = []
    for event in events[:limit]:
        rows.append(
            {
                "id": event.id,
                "source_type": event.source_type,
                "severity": event.severity,
                "title": event.title,
                "summary": event.summary,
                "details": event.details,
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

    def get_prediction_leaderboard(self) -> list[dict[str, Any]]:
        windows: list[tuple[int, str]] = [
            (24, "آخر 24 ساعة"),
            (72, "آخر 72 ساعة"),
            (168, "آخر 7 أيام"),
            (720, "آخر 30 يوم"),
            (0, "كل الوقت"),
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
            f"أنشئ توقعاً تشغيلياً واضحاً مع سيناريو رئيسي خلال {horizon_hours} ساعة. "
            f"التركيز: {focus_query}. الطلب: {request_text}."
        )
        prediction_text = self._generate_answer(question=prompt, events=events)
        confidence = self._estimate_confidence_from_text(prediction_text)
        related_event_ids = ",".join(str(event.id) for event in events[:120] if event.id is not None)
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
            f"حدّث توقع التذكرة بشكل موجز وقابل للمتابعة. "
            f"العنوان: {ticket.title}. التركيز: {ticket.focus_query}. ملاحظة: {note or 'بدون'}."
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
            ids_text = ",".join(str(event.id) for event in events[:120] if event.id is not None)
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
        update = AIPredictionUpdate(
            ticket_id=ticket.id or 0,
            kind="outcome",
            content=f"Outcome: {outcome}. {note or ''}".strip(),
            outcome=outcome,
        )
        self.session.add(update)
        self.session.commit()
        self.session.refresh(ticket)
        self.session.refresh(update)
        return ticket, update

    def auto_update_predictions_for_event(self, event: Event) -> list[AIPredictionUpdate]:
        text = " ".join(filter(None, [event.title, event.summary, event.details, event.tags])).lower()
        if not text:
            return []
        tickets = self.session.exec(
            select(AIPredictionTicket).where(AIPredictionTicket.status.in_(["open", "watching"])).limit(80)
        ).all()
        now = datetime.now(timezone.utc)
        created: list[AIPredictionUpdate] = []
        for ticket in tickets:
            tokens = [token for token in re.split(r"\s+", ticket.focus_query.lower()) if len(token) >= 4]
            if not tokens:
                continue
            if not any(token in text for token in tokens[:10]):
                continue
            if ticket.updated_at and now - ticket.updated_at < timedelta(minutes=20):
                continue
            update = AIPredictionUpdate(
                ticket_id=ticket.id or 0,
                kind="auto",
                content=f"تحديث تلقائي مرتبط بالتركيز ({ticket.focus_query}): {event.title}",
                outcome=None,
            )
            ticket.updated_at = now
            self.session.add(ticket)
            self.session.add(update)
            self.session.commit()
            self.session.refresh(update)
            created.append(update)
        return created

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
                title="تحليل تلقائي من المحادثة",
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
                title=title or "تقرير تحليلي",
                prompt=report_prompt,
                event_ids=event_ids or [],
            )

        report_title = (title or insight.title or "تقرير تحليلي").strip()
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
            first_line = next((line for line in content.splitlines() if line.startswith("# ")), "# تقرير")
            title = first_line[2:].strip() if len(first_line) > 2 else "تقرير"
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
        if self._keyword_match(text, {"خبر", "اخبار", "أخبار", "news", "latest", "اخر", "آخر"}):
            return ["news", "incident", "cyber", "social", "flight", "marine", "custom"]
        if self._keyword_match(text, {"flight", "طيران", "air", "plane"}):
            return ["flight", "incident", "news", "marine", "cyber", "social", "custom"]
        if self._keyword_match(text, {"marine", "ship", "vessel", "ملاحة", "بحر"}):
            return ["marine", "incident", "news", "flight", "cyber", "social", "custom"]
        if self._keyword_match(text, {"cyber", "سيبر", "malware", "ransomware"}):
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

        if self._keyword_match(question, {"خبر", "اخبار", "أخبار", "news", "latest", "اخر", "آخر"}):
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
                    "Answer in Arabic with concise actionable points and one follow-up question."
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
                "تعذر الحصول على رد من OpenAI حالياً. "
                "تحقق من صلاحية المفتاح، اسم النموذج، واتصال الإنترنت في الخادم."
            )

        return self._local_answer(question=question, events=events)

    def _generate_report(self, prompt: str, events: list[Event]) -> str:
        if self._client:
            text = self._openai_text(
                system_prompt=(
                    "Create an Arabic operational report for decision makers with sections: "
                    "executive summary, key developments, risks, recommendations, and next questions."
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
                "تعذر إنشاء التحليل عبر OpenAI حالياً. "
                "تحقق من المفتاح والنموذج والاتصال ثم أعد المحاولة."
            )

        return self._local_report(prompt=prompt, events=events)

    def _local_answer(self, question: str, events: list[Event]) -> str:
        if not events:
            return "لا توجد أحداث كافية حالياً. نفذ تحديثاً فورياً ثم أعد السؤال."

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
            "ملخص مساعد الذكاء (وضع محلي):",
            f"- أحدث حدث: {latest.title}",
            f"- التوزيع حسب المصدر: {dict(source_counts)}",
            f"- الأحداث عالية الشدة: {len(severe)}",
            f"- مزاج السوشال: {social_label} ({social_score})",
            f"- سؤالك: {question}",
        ]
        if news:
            lines.append("- آخر عناوين الأخبار:")
            for item in news:
                lines.append(f"  - {item.title}")
        lines.append("ما الذي تريد التعمق فيه أكثر: الحرب، الملاحة، الطيران، أو الأمن السيبراني؟")
        return "\n".join(lines)[:3500]

    def _local_report(self, prompt: str, events: list[Event]) -> str:
        if not events:
            return "لا تتوفر بيانات كافية لبناء تقرير حالياً."

        source_counts = Counter(event.source_type for event in events)
        severe = [event for event in events if event.severity >= 4]
        top_events = events[:8]
        lines = [
            f"الموضوع: {prompt}",
            "الملخص:",
            f"- تم تحليل {len(events)} حدثاً.",
            f"- التوزيع حسب المصدر: {dict(source_counts)}.",
            f"- عدد الأحداث عالية الشدة: {len(severe)}.",
            "",
            "أهم المؤشرات:",
        ]
        for event in top_events:
            lines.append(f"- [{event.source_type}] {event.title} (S{event.severity})")
        lines.extend(
            [
                "",
                "التوصيات:",
                "- المتابعة اللحظية للمصادر الموثوقة.",
                "- مراجعة التطورات كل 30 دقيقة في حالات التصعيد.",
                "- نشر تقرير دوري لفرق العمليات.",
                "",
                "أسئلة متابعة:",
                "- هل تريد تركيز التقرير على سيناريو الحرب فقط؟",
                "- هل تريد مقارنة الأخبار الرسمية مع إشارات السوشال؟",
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
        executive_text = " ".join(line for line in executive if line)[:900] or "لا يوجد ملخص متاح."

        lines: list[str] = [
            f"# {report_title}",
            "",
            "## بيانات التقرير",
            f"- رقم التقرير: {report_id}",
            f"- وقت الإنشاء (UTC): {created_at.isoformat()}",
            f"- موضوع الطلب: {prompt or 'غير متاح'}",
            "",
            "## الملخص التنفيذي",
            executive_text,
            "",
            "## الصورة التشغيلية",
            f"- عدد الأحداث المحللة: {len(events)}",
            f"- الأحداث عالية الشدة (S4-S5): {severe_count}",
            f"- توزيع المصادر: {dict(source_counts)}",
            "",
            "## أبرز التطورات",
        ]
        if not top_events:
            lines.append("- لا توجد أحداث مرفقة بهذا التقرير.")
        else:
            for event in top_events:
                timestamp = event.event_time.isoformat()
                details = f"[{event.source_type}] S{event.severity} | {timestamp} | {event.title}"
                lines.append(f"- {details}")
                if event.url:
                    lines.append(f"  - رابط المصدر: {event.url}")

        lines.extend(
            [
                "",
                "## تحليل الذكاء الاصطناعي",
                insight_content.strip() or "لا يوجد نص تحليل متاح.",
                "",
                "## توصيات القرار",
                "- الاستمرار في مراقبة المصادر الموثوقة بوتيرة ثابتة مع عتبات تصعيد واضحة.",
                "- التحقق من الأخبار المتعارضة عبر مصدرين موثوقين على الأقل قبل التعميم.",
                "- إعادة التحليل المركز للأحداث المحددة قبل أي إحاطة تنفيذية.",
                "",
                "## أسئلة المتابعة",
                "- ما السيناريو الذي يجب إعطاؤه أولوية خلال الـ 6 إلى 12 ساعة القادمة؟",
                "- هل تحتاج موجزاً قطاعياً محدداً (طيران، ملاحة، سيبراني)؟",
                "- هل نُنشر نسخة مختصرة للقيادة من هذا التقرير؟",
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
        draw_line(f"تم الإنشاء (UTC): {created_at.isoformat()}", font_size=9, gap=8)
        y -= 4

        for raw in _clean_lines(markdown):
            if not raw:
                y -= 6
                continue
            if raw.startswith("بيانات التقرير") or raw.startswith("الملخص التنفيذي"):
                draw_line(raw, bold=True, font_size=13, gap=6)
                continue
            if raw.startswith("الصورة التشغيلية") or raw.startswith("أبرز التطورات"):
                draw_line(raw, bold=True, font_size=12, gap=6)
                continue
            if raw.startswith("تحليل الذكاء الاصطناعي") or raw.startswith("توصيات القرار") or raw.startswith("أسئلة المتابعة"):
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
        if "مرجح" in lower or "راجح" in lower or "high probability" in lower:
            value += 0.15
        if "غير مؤكد" in lower or "uncertain" in lower or "منخفض الاحتمال" in lower:
            value -= 0.12
        return max(0.05, min(0.95, round(value, 2)))

    @staticmethod
    def _should_create_insight(message: str) -> bool:
        text = message.lower()
        markers = {"تحليل", "تقرير", "analysis", "report", "dashboard", "war", "حرب"}
        return any(marker in text for marker in markers)
