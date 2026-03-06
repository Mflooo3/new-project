import json
import re
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
            "task": (
                "Perform military-operations grade event analysis for GCC monitoring. "
                "Use only provided event text. Do not repeat title verbatim. Avoid generic output."
            ),
            "language": "Arabic",
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
                "summary_ar": "one concise sentence",
                "operational_impact_ar": "one concise sentence",
                "actions_ar": ["3 concrete actions with time windows"],
                "triggers_ar": ["2 escalation triggers"],
                "evidence_ar": ["up to 3 non-duplicate evidence bullets from input"],
            },
        }

        try:
            response = self._client.responses.create(
                model=settings.openai_model,
                input=[
                    {
                        "role": "system",
                        "content": (
                            "You are a senior Gulf war and operations analyst. Return JSON only with keys: "
                            "severity, tags, summary_ar, operational_impact_ar, actions_ar, triggers_ar, evidence_ar. "
                            "No markdown. No URLs. No source labels. Arabic output."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
            )
            parsed = self._parse_json_response((response.output_text or "").strip())
            if not parsed:
                return heuristic

            severity = max(1, min(5, int(parsed.get("severity", heuristic.severity))))
            tags = self._normalize_tags(parsed.get("tags"), fallback=heuristic.tags)
            assessment = self._format_structured_assessment(parsed, fallback=heuristic.assessment)
            return AnalysisResult(severity=severity, tags=tags, assessment=assessment[:1200])
        except Exception:
            return heuristic

    def _parse_json_response(self, text: str) -> dict | None:
        if not text:
            return None
        try:
            loaded = json.loads(text)
            return loaded if isinstance(loaded, dict) else None
        except Exception:
            pass

        # Fallback parser for model outputs that wrap JSON with extra text.
        start = text.find("{")
        if start < 0:
            return None
        depth = 0
        in_str = False
        escaped = False
        for idx in range(start, len(text)):
            ch = text[idx]
            if in_str:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    chunk = text[start : idx + 1]
                    try:
                        loaded = json.loads(chunk)
                        return loaded if isinstance(loaded, dict) else None
                    except Exception:
                        return None
        return None

    def _normalize_tags(self, tags: object, fallback: list[str]) -> list[str]:
        if not isinstance(tags, list):
            return fallback
        out: list[str] = []
        for item in tags:
            label = str(item or "").strip().lower()
            if not label:
                continue
            if label not in out:
                out.append(label)
        return out[:10] if out else fallback

    def _clean_line(self, value: object) -> str:
        text = str(value or "")
        text = re.sub(r"https?://\S+", "", text)
        text = re.sub(r"\b(?:source|المصدر)\s*[:：].*$", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s{2,}", " ", text).strip(" -•\t\r\n")
        return text

    def _listify(self, value: object, limit: int) -> list[str]:
        if isinstance(value, list):
            rows = [self._clean_line(item) for item in value]
        else:
            rows = [self._clean_line(value)]
        out: list[str] = []
        for row in rows:
            if not row or row in out:
                continue
            out.append(row)
            if len(out) >= limit:
                break
        return out

    def _format_structured_assessment(self, parsed: dict, fallback: str) -> str:
        summary = self._clean_line(parsed.get("summary_ar")) or self._clean_line(fallback)
        impact = self._clean_line(parsed.get("operational_impact_ar"))
        actions = self._listify(parsed.get("actions_ar"), limit=3)
        triggers = self._listify(parsed.get("triggers_ar"), limit=3)
        evidence = self._listify(parsed.get("evidence_ar"), limit=3)

        if not summary:
            return self._clean_line(fallback)

        lines: list[str] = [f"خلاصة: {summary}"]
        if impact:
            lines.append(f"أثر تشغيلي: {impact}")
        for action in actions:
            lines.append(f"اقتراح: {action}")
        for trigger in triggers:
            lines.append(f"مؤشر تصعيد: {trigger}")
        for item in evidence:
            lines.append(f"دليل: {item}")
        return "\n".join(lines)

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
            "صاروخ",
            "استهداف",
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
            "توتر",
            "اعتراض",
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

        source_actions = {
            "flight": "تأكيد استقرار الرحلات القادمة والمغادرة المرتبطة بالنطاق خلال نافذة 2-12 ساعة.",
            "marine": "تحديث مسارات السفن والموانئ الحساسة وربطها بإنذارات تشغيلية مبكرة.",
            "cyber": "تعزيز مراقبة الأنظمة الحرجة والتحقق من مؤشرات التحول إلى تأثير تشغيلي.",
            "news": "مقارنة الخبر مع مصادر رسمية إضافية قبل رفع مستوى الاستجابة.",
            "social": "فصل الإشارة الإعلامية عن التأكيد الرسمي وتجنب التصعيد المبكر.",
        }

        base_summary = (raw.summary or raw.title or "حدث قيد المتابعة.").strip()
        if len(base_summary) > 180:
            base_summary = f"{base_summary[:177]}..."

        if severity >= 4:
            impact = "تطور عالي الأولوية وقد يؤثر على الاستقرار التشغيلي في النطاق القريب."
        elif severity == 3:
            impact = "تطور متوسط يتطلب تحققًا متكررًا من نفس المسار خلال الساعات القادمة."
        else:
            impact = "إشارة خلفية معلوماتية بدون أثر تشغيلي مباشر حتى الآن."

        action = source_actions.get(source_type, "المتابعة التشغيلية الدورية مع التحديث عند ظهور تأكيد جديد.")
        assessment = "\n".join(
            [
                f"خلاصة: {base_summary}",
                f"أثر تشغيلي: {impact}",
                f"اقتراح: {action}",
                "مؤشر تصعيد: ظهور تأكيد رسمي جديد يغير اتجاه الحدث.",
            ]
        )
        return AnalysisResult(severity=severity, tags=sorted(set(tags)), assessment=assessment)
