import json
from dataclasses import dataclass

from openai import OpenAI

from app.config import settings
from app.services.fetchers.base import RawEvent


@dataclass
class AnalysisResult:
    severity: int
    tags: list[str]
    assessment: str


class AIAnalyzer:
    def __init__(self) -> None:
        self._client = (
            OpenAI(api_key=settings.openai_api_key)
            if settings.openai_api_key and not settings.ai_privacy_mode
            else None
        )

    def analyze(self, raw: RawEvent, source_type: str, relevance_score: float) -> AnalysisResult:
        heuristic = self._heuristic(raw=raw, source_type=source_type, relevance_score=relevance_score)
        if not self._client:
            return heuristic

        prompt = {
            "task": "Assess operational relevance and risk for Gulf monitoring.",
            "fields": {
                "title": raw.title,
                "summary": raw.summary,
                "details": raw.details,
                "source_type": source_type,
                "relevance_score": relevance_score,
            },
            "output_schema": {
                "severity": "int 1-5",
                "tags": ["string"],
                "assessment": "short string <= 35 words",
            },
        }

        try:
            response = self._client.responses.create(
                model=settings.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "You are a Gulf-region operations analyst. Return strict JSON only with keys: "
                            "severity, tags, assessment. Severity range: 1-5."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt)},
                ],
            )
            text = (response.output_text or "").strip()
            parsed = json.loads(text)
            severity = int(parsed.get("severity", heuristic.severity))
            tags = parsed.get("tags", heuristic.tags)
            assessment = parsed.get("assessment", heuristic.assessment)
            return AnalysisResult(
                severity=max(1, min(5, severity)),
                tags=[str(tag).lower() for tag in tags][:8] if isinstance(tags, list) else heuristic.tags,
                assessment=str(assessment)[:300],
            )
        except Exception:
            return heuristic

    def _heuristic(self, raw: RawEvent, source_type: str, relevance_score: float) -> AnalysisResult:
        text = " ".join(filter(None, [raw.title, raw.summary, raw.details])).lower()

        high_risk = {
            "attack",
            "missile",
            "strike",
            "explosion",
            "collision",
            "fire",
            "hijack",
            "hostage",
            "blockade",
            "closure",
            "drone",
            "hacked",
            "breach",
            "ransomware",
            "اختراق",
            "هجوم",
            "انفجار",
        }
        medium_risk = {
            "warning",
            "alert",
            "protest",
            "military",
            "detained",
            "delay",
            "disruption",
            "outage",
            "investigation",
            "phishing",
            "malware",
            "تهديد",
            "إنذار",
        }

        score = 1
        tags: list[str] = [source_type]
        if any(token in text for token in high_risk):
            score += 3
            tags.append("security")
        elif any(token in text for token in medium_risk):
            score += 2
            tags.append("operational")

        if source_type in {"flight", "marine"}:
            score += 1
            tags.append("mobility")
        if source_type == "cyber":
            score += 2
            tags.append("cyber")
        if source_type == "social":
            tags.append("social")
            if "social_sentiment=negative" in text:
                score += 1
                tags.append("negative-sentiment")

        if relevance_score > 0.6:
            score += 1
            tags.append("gulf-relevant")

        severity = max(1, min(5, score))
        assessment = "Monitor as background activity."
        if severity >= 4:
            assessment = "High-priority development with potential regional operational impact."
        elif severity == 3:
            assessment = "Moderate development; verify source and watch for escalation."

        return AnalysisResult(severity=severity, tags=sorted(set(tags)), assessment=assessment)
