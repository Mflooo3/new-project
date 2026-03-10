from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from openai import OpenAI
from sqlmodel import Session

from app.config import settings
from app.services.api_usage_tracker import track_openai_api_usage


SYSTEM_PROMPT_AR = """
You are a senior geopolitical OSINT intelligence analyst.
Your role is to analyze structured social media intelligence data and produce analyst-grade intelligence briefs.
All outputs must be written in Modern Standard Arabic.
Rules:
- Base conclusions ONLY on provided evidence.
- Clearly separate observation from inference.
- Identify narratives and influence patterns.
- Avoid speculation.
- Indicate uncertainty when evidence is limited.
- Preserve usernames and hashtags exactly.
- Compare official posts, media posts, public-user posts, and review/suspicious posts explicitly.
Output sections (exact headings in Arabic):
الملخص التنفيذي
أبرز الوسوم المتداولة
تحليل المشاعر العامة
تحليل السرديات
تطور السرديات
اختلاف النقاش بين العربية والإنجليزية
تحليل الحسابات المؤثرة
مؤشرات التنسيق
إشارات المخاطر
التوصيات التحليلية
مستوى الثقة وحدود البيانات
""".strip()


class AIBriefService:
    def __init__(
        self,
        *,
        session: Session | None = None,
        user_id: int | None = None,
        tenant_id: int | None = None,
    ) -> None:
        self.session = session
        self.user_id = user_id
        self.tenant_id = tenant_id
        self._client = (
            OpenAI(api_key=settings.openai_api_key)
            if settings.openai_api_key and not settings.ai_privacy_mode
            else None
        )

    def generateIntelBrief(self, snapshot: dict[str, Any], filters: dict[str, Any]) -> dict[str, Any]:
        generated_at = datetime.now(timezone.utc).isoformat()
        model = (settings.openai_model or "gpt-4.1-mini").strip() or "gpt-4.1-mini"
        if self._client is None:
            return {
                "content": self._fallback_brief(snapshot, filters),
                "generated_at": generated_at,
                "model": model,
                "used_openai": False,
            }

        prompt_payload = {
            "filters": filters,
            "overview": snapshot.get("overview", {}),
            "diagnostics": snapshot.get("diagnostics", {}),
            "source_classes": snapshot.get("source_classes", {}),
            "hashtags_top": snapshot.get("hashtags", {}).get("ranking", [])[:12],
            "sentiment": {
                "overall_score": snapshot.get("sentiment", {}).get("overall_score", 0),
                "distribution": snapshot.get("sentiment", {}).get("distribution", {}),
                "language_breakdown": snapshot.get("sentiment", {}).get("language_breakdown", {}),
            },
            "narratives": snapshot.get("narratives", {}).get("items", [])[:8],
            "post_views": {
                "top_official_posts": snapshot.get("posts", {}).get("top_official_posts", [])[:12],
                "top_media_posts": snapshot.get("posts", {}).get("top_media_posts", [])[:12],
                "top_public_posts": snapshot.get("posts", {}).get("top_public_posts", [])[:20],
                "latest_public_posts": snapshot.get("posts", {}).get("latest_public_posts", [])[:20],
                "emerging_public_posts": snapshot.get("posts", {}).get("emerging_public_posts", [])[:20],
                "suspicious_posts": snapshot.get("posts", {}).get("suspicious_posts", [])[:12],
            },
            "watchlist_top": snapshot.get("watchlist", {}).get("accounts", [])[:12],
            "influence_top": snapshot.get("influence", {}).get("leaders", [])[:12],
            "coordination": {
                "top_pairs": snapshot.get("network", {}).get("coordination_pairs", [])[:12],
                "clusters": snapshot.get("network", {}).get("clusters", [])[:8],
                "phrases": snapshot.get("network", {}).get("phrase_similarity_groups", [])[:8],
            },
            "early_warning": snapshot.get("early_warning", {}),
        }

        try:
            response = self._client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": SYSTEM_PROMPT_AR},
                    {
                        "role": "user",
                        "content": (
                            "حلّل بيانات X التالية وأنتج إحاطة استخبارية عربية بالمحاور المطلوبة فقط.\n"
                            "قارن بشكل صريح بين السردية الرسمية والإعلامية والعامة ومنشورات المراجعة.\n"
                            "أجب بوضوح: هل يظهر نقاش عام حقيقي خارج الدائرة الرسمية؟ ما أبرز المنشورات العامة ذات الصلة؟"
                            " هل توجد فجوة بين السردية الرسمية والنقاش العام؟\n"
                            + json.dumps(prompt_payload, ensure_ascii=False)
                        ),
                    },
                ],
            )
            if self.session is not None:
                track_openai_api_usage(
                    self.session,
                    user_id=self.user_id,
                    tenant_id=self.tenant_id,
                    endpoint="/x-intel/brief",
                    response=response,
                )
            content = (response.output_text or "").strip()
            if not content:
                content = self._fallback_brief(snapshot, filters)
            return {
                "content": content,
                "generated_at": generated_at,
                "model": model,
                "used_openai": True,
            }
        except Exception:
            return {
                "content": self._fallback_brief(snapshot, filters),
                "generated_at": generated_at,
                "model": model,
                "used_openai": False,
            }

    def _fallback_brief(self, snapshot: dict[str, Any], filters: dict[str, Any]) -> str:
        overview = snapshot.get("overview", {})
        hashtags = snapshot.get("hashtags", {}).get("ranking", [])
        top_tag = hashtags[0]["hashtag"] if hashtags else "غير متاح"
        fastest = snapshot.get("hashtags", {}).get("fastest_rising", {}).get("hashtag") or "غير متاح"
        sentiment = snapshot.get("sentiment", {})
        distribution = sentiment.get("distribution", {})
        narratives = snapshot.get("narratives", {}).get("items", [])
        watchlist = snapshot.get("watchlist", {}).get("accounts", [])
        coordination_pairs = snapshot.get("network", {}).get("coordination_pairs", [])
        diagnostics = snapshot.get("diagnostics", {})
        post_views = snapshot.get("posts", {})
        official_rows = post_views.get("top_official_posts", []) or []
        media_rows = post_views.get("top_media_posts", []) or []
        public_rows = post_views.get("top_public_posts", []) or []
        suspicious_rows = post_views.get("suspicious_posts", []) or []
        early = snapshot.get("early_warning", {})
        risk_level = early.get("risk_level", "Low")
        risk_score = early.get("risk_score", 0)

        return "\n".join(
            [
                "الملخص التنفيذي",
                f"- رصد {overview.get('total_posts', 0)} منشورًا ضمن النافذة {filters.get('time_window', '24h')} للدولة المستهدفة.",
                f"- منشورات عامة معروضة: {diagnostics.get('displayed_public_posts_count', 0)}.",
                "",
                "أبرز الوسوم المتداولة",
                f"- الوسم الأبرز: {top_tag}",
                f"- الأسرع نموًا: {fastest}",
                "",
                "تحليل المشاعر العامة",
                f"- المؤشر العام: {sentiment.get('overall_score', 0)}",
                f"- إيجابي: {distribution.get('positive', 0)} | محايد: {distribution.get('neutral', 0)} | سلبي: {distribution.get('negative', 0)}",
                "",
                "تحليل السرديات",
                f"- عدد السرديات المرصودة: {len(narratives)}",
                f"- مقارنة الطبقات: رسمي {len(official_rows)} | إعلام {len(media_rows)} | عام {len(public_rows)} | مراجعة {len(suspicious_rows)}.",
                "",
                "تطور السرديات",
                "- تظهر السرديات وفق نافذة زمنية متحركة مع مراقبة قمم النقاش الناشئة.",
                "",
                "اختلاف النقاش بين العربية والإنجليزية",
                "- تم احتساب العربية والإنجليزية بشكل منفصل ثم دمج الصورة الكلية.",
                "",
                "تحليل الحسابات المؤثرة",
                f"- الحسابات الأعلى تأثيرًا المرصودة: {len(snapshot.get('influence', {}).get('leaders', []))}",
                "",
                "مؤشرات التنسيق",
                f"- أزواج تنسيق محتملة: {len(coordination_pairs)}",
                f"- حسابات المراقبة: {len(watchlist)}",
                "",
                "إشارات المخاطر",
                f"- Narrative Risk Score: {risk_score}/100 ({risk_level})",
                "",
                "التوصيات التحليلية",
                "- متابعة الوسوم الأسرع نموًا كل 30-60 دقيقة مع تركيز خاص على النقاش العام خارج الدائرة الرسمية.",
                "- إجراء تحقق بشري للحسابات المصنفة للمراجعة قبل أي إجراء تشغيلي.",
                "",
                "مستوى الثقة وحدود البيانات",
                "- المخرجات مبنية على بيانات X المتاحة ضمن النافذة الزمنية المحددة.",
                "- مؤشرات التنسيق والسلوك الآلي تقديرية وتتطلب تحقق محلل بشري.",
            ]
        )
