from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from typing import Any

import httpx
from openai import OpenAI

from app.config import settings
from app.services.fetchers.base import RawEvent


_THREAT_HINT_RE = re.compile(
    r"(?:missile|ballistic|cruise|drone|uav|intercept|air defense|"
    r"صاروخ|بالست|باليست|كروز|مسيرة|مسي(?:ّ)?رات|اعتراض|دفاع جوي)",
    re.IGNORECASE,
)
_OFFICIAL_SOURCE_HINT_RE = re.compile(
    r"(?:ministry of defence|وزارة الدفاع|mod|wam|uae mod|x gulf live feed|شبكة أبوظبي|أبوظبي الإخبارية)",
    re.IGNORECASE,
)
_IMAGE_URL_RE = re.compile(r"(?:^|\|)\s*(?:image_url|image|thumbnail|preview_image_url)\s*=\s*([^|]+)")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)


@dataclass
class OCRResult:
    text: str
    numbers: dict[str, int | None]
    status: str
    image_url: str


def _clean_text(value: str | None) -> str:
    text = str(value or "").strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _safe_int(value: Any) -> int | None:
    if value is None:
        return None
    text = _clean_text(str(value))
    if not text:
        return None
    text = (
        text.replace(",", "")
        .replace("،", "")
        .replace(" ", "")
    )
    digit_map = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
    text = text.translate(digit_map)
    if not re.fullmatch(r"\d{1,7}", text):
        return None
    try:
        return int(text)
    except Exception:
        return None


def _parse_json_loose(text: str) -> dict[str, Any] | None:
    cleaned = _clean_text(text)
    if not cleaned:
        return None
    try:
        payload = json.loads(cleaned)
        return payload if isinstance(payload, dict) else None
    except Exception:
        pass

    start = cleaned.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escaped = False
    for idx in range(start, len(cleaned)):
        ch = cleaned[idx]
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
                chunk = cleaned[start : idx + 1]
                try:
                    payload = json.loads(chunk)
                    return payload if isinstance(payload, dict) else None
                except Exception:
                    return None
    return None


def _extract_image_urls(raw: RawEvent) -> list[str]:
    urls: list[str] = []
    details = str(raw.details or "")
    for match in _IMAGE_URL_RE.finditer(details):
        value = _clean_text(match.group(1))
        if value and value not in urls:
            urls.append(value)

    for value in (raw.summary, raw.details, raw.url):
        if not value:
            continue
        for match in _URL_RE.findall(str(value)):
            url = match.rstrip(").,]")
            if re.search(r"\.(?:jpg|jpeg|png|webp|gif)(?:\?|$)", url, re.IGNORECASE):
                if url not in urls:
                    urls.append(url)
    return urls


def _likely_needs_threat_ocr(raw: RawEvent, source_name: str) -> bool:
    haystack = " ".join(
        filter(
            None,
            [
                raw.title,
                raw.summary,
                raw.details,
                source_name,
            ],
        )
    )
    return bool(_THREAT_HINT_RE.search(haystack) or _OFFICIAL_SOURCE_HINT_RE.search(haystack))


def _truncate_detail_value(value: str, limit: int = 700) -> str:
    text = _clean_text(value).replace("|", " ").replace("\n", " ")
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _merge_details_with_ocr(existing: str | None, extra_parts: list[str]) -> str | None:
    if not extra_parts:
        return existing
    base_parts = [part.strip() for part in str(existing or "").split("|") if part.strip()]
    # Keep only one OCR block by replacing old OCR tokens.
    base_parts = [part for part in base_parts if not part.lower().startswith("ocr_")]
    merged = base_parts + extra_parts
    text = " | ".join(merged)
    return text[:3000] if text else None


class EventImageOCRService:
    def __init__(self) -> None:
        self._enabled = bool(settings.ocr_enabled)
        self._client = (
            OpenAI(api_key=settings.openai_api_key)
            if self._enabled and settings.openai_api_key and not settings.ai_privacy_mode
            else None
        )
        self._cache: dict[str, OCRResult] = {}

    def available(self) -> bool:
        return bool(self._client is not None and self._enabled)

    def enrich_raw_event(self, raw: RawEvent, source_name: str, source_type: str, *, force: bool = False) -> RawEvent:
        if not self.available():
            return raw
        if source_type not in {"news", "social", "custom", "incident"}:
            return raw

        details_lower = str(raw.details or "").lower()
        if not force and ("ocr_status=ok" in details_lower or "ocr_status=failed" in details_lower):
            return raw

        image_urls = _extract_image_urls(raw)
        if not image_urls:
            return raw

        if settings.ocr_only_threat_signals and not _likely_needs_threat_ocr(raw, source_name):
            return raw

        max_images = max(1, int(settings.ocr_max_images_per_event))
        selected_urls = image_urls[:max_images]
        result: OCRResult | None = None
        for image_url in selected_urls:
            result = self._ocr_single_image(raw=raw, source_name=source_name, image_url=image_url)
            if result and (result.text or any(v is not None for v in result.numbers.values())):
                break

        if result is None:
            raw.details = _merge_details_with_ocr(raw.details, ["ocr_status=failed", "ocr_reason=no_result"])
            return raw

        if result.status != "ok":
            raw.details = _merge_details_with_ocr(
                raw.details,
                [
                    f"ocr_status={result.status}",
                    f"ocr_image_url={_truncate_detail_value(result.image_url, 220)}",
                ],
            )
            return raw

        extra_parts: list[str] = [
            "ocr_status=ok",
            f"ocr_image_url={_truncate_detail_value(result.image_url, 220)}",
        ]
        if result.text:
            extra_parts.append(f"ocr_text={_truncate_detail_value(result.text, max(300, int(settings.ocr_max_chars)))}")

        numbers = result.numbers
        if any(value is not None for value in numbers.values()):
            def _num(key: str) -> str:
                value = numbers.get(key)
                return str(value) if value is not None else "غير متاح"

            extra_parts.extend(
                [
                    f"ocr_fatalities={_num('fatalities')}",
                    f"ocr_injuries={_num('injuries')}",
                    f"ocr_ballistic_detected={_num('ballistic_detected')}",
                    f"ocr_ballistic_intercepted={_num('ballistic_intercepted')}",
                    f"ocr_cruise_detected={_num('cruise_detected')}",
                    f"ocr_cruise_intercepted={_num('cruise_intercepted')}",
                    f"ocr_drones_detected={_num('drones_detected')}",
                    f"ocr_drones_intercepted={_num('drones_intercepted')}",
                    (
                        "ocr_threat_summary="
                        f"تم رصد {_num('ballistic_detected')} صاروخ باليستي، واعتراض {_num('ballistic_intercepted')}."
                        f" تم رصد {_num('cruise_detected')} صاروخ كروز، واعتراض {_num('cruise_intercepted')}."
                        f" تم رصد {_num('drones_detected')} طائرة مسيرة، واعتراض {_num('drones_intercepted')}."
                    ),
                ]
            )

        raw.details = _merge_details_with_ocr(raw.details, extra_parts)
        return raw

    def _ocr_single_image(self, *, raw: RawEvent, source_name: str, image_url: str) -> OCRResult | None:
        if image_url in self._cache:
            return self._cache[image_url]
        if not self._client:
            return None

        prompt = (
            "Extract exact visible text and any threat numbers from this image.\n"
            "Return JSON only with keys:\n"
            "{"
            '"ocr_text":"string",'
            '"fatalities":int|null,'
            '"injuries":int|null,'
            '"ballistic_detected":int|null,'
            '"ballistic_intercepted":int|null,'
            '"cruise_detected":int|null,'
            '"cruise_intercepted":int|null,'
            '"drones_detected":int|null,'
            '"drones_intercepted":int|null'
            "}\n"
            "Rules: no inference, no hallucination, keep null when not visible."
        )

        models = [
            _clean_text(settings.ocr_vision_model),
            _clean_text(settings.openai_model),
            "gpt-4.1-mini",
            "gpt-4o-mini",
        ]
        seen_models: set[str] = set()
        for model in models:
            if not model or model in seen_models:
                continue
            seen_models.add(model)
            try:
                payload = self._run_ocr_request(
                    model=model,
                    prompt=prompt,
                    source_name=source_name,
                    title_hint=raw.title,
                    summary_hint=raw.summary or "",
                    image_ref=image_url,
                )
                if not isinstance(payload, dict):
                    data_url = self._download_image_data_url(image_url)
                    if data_url:
                        payload = self._run_ocr_request(
                            model=model,
                            prompt=prompt,
                            source_name=source_name,
                            title_hint=raw.title,
                            summary_hint=raw.summary or "",
                            image_ref=data_url,
                        )
                if not isinstance(payload, dict):
                    continue
                result = OCRResult(
                    text=_clean_text(str(payload.get("ocr_text") or "")),
                    numbers={
                        "fatalities": _safe_int(payload.get("fatalities")),
                        "injuries": _safe_int(payload.get("injuries")),
                        "ballistic_detected": _safe_int(payload.get("ballistic_detected")),
                        "ballistic_intercepted": _safe_int(payload.get("ballistic_intercepted")),
                        "cruise_detected": _safe_int(payload.get("cruise_detected")),
                        "cruise_intercepted": _safe_int(payload.get("cruise_intercepted")),
                        "drones_detected": _safe_int(payload.get("drones_detected")),
                        "drones_intercepted": _safe_int(payload.get("drones_intercepted")),
                    },
                    status="ok",
                    image_url=image_url,
                )
                self._cache[image_url] = result
                return result
            except Exception:
                continue

        failed = OCRResult(
            text="",
            numbers={
                "fatalities": None,
                "injuries": None,
                "ballistic_detected": None,
                "ballistic_intercepted": None,
                "cruise_detected": None,
                "cruise_intercepted": None,
                "drones_detected": None,
                "drones_intercepted": None,
            },
            status="failed",
            image_url=image_url,
        )
        self._cache[image_url] = failed
        return failed

    def _run_ocr_request(
        self,
        *,
        model: str,
        prompt: str,
        source_name: str,
        title_hint: str,
        summary_hint: str,
        image_ref: str,
    ) -> dict[str, Any] | None:
        if not self._client:
            return None
        user_text = (
            f"{prompt}\n"
            f"Source name: {source_name}\n"
            f"Title hint: {title_hint}\n"
            f"Summary hint: {summary_hint}"
        )

        if hasattr(self._client, "responses"):
            response = self._client.responses.create(
                model=model,
                max_output_tokens=600,
                input=[
                    {
                        "role": "system",
                        "content": "You are an OCR extraction engine. Output JSON only.",
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": user_text,
                            },
                            {
                                "type": "input_image",
                                "image_url": image_ref,
                            },
                        ],
                    },
                ],
            )
            return _parse_json_loose(getattr(response, "output_text", "") or "")

        if hasattr(self._client, "chat") and hasattr(self._client.chat, "completions"):
            response = self._client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are an OCR extraction engine. Output JSON only."},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_text},
                            {"type": "image_url", "image_url": {"url": image_ref}},
                        ],
                    },
                ],
                temperature=0.0,
                max_tokens=600,
            )
            choice = response.choices[0] if response.choices else None
            text = ""
            if choice and choice.message:
                content = choice.message.content
                if isinstance(content, str):
                    text = content
                elif isinstance(content, list):
                    text = " ".join(str(item.get("text") or "") for item in content if isinstance(item, dict))
            return _parse_json_loose(text)

        return None

    def _download_image_data_url(self, image_url: str) -> str | None:
        try:
            with httpx.Client(timeout=20, follow_redirects=True, headers={"User-Agent": "gulf-monitor/1.0"}) as client:
                response = client.get(image_url)
            response.raise_for_status()
            content_type = _clean_text(response.headers.get("content-type", "")).lower()
            if not content_type.startswith("image/"):
                return None
            data = response.content or b""
            if not data:
                return None
            if len(data) > 7 * 1024 * 1024:
                return None
            encoded = base64.b64encode(data).decode("ascii")
            return f"data:{content_type};base64,{encoded}"
        except Exception:
            return None
