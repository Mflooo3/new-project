import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiDownload, apiGet, apiPatch, apiPost, streamEvents } from "./api";

const sourceTypeOptions = [
  { value: "all", label: "كل الأنواع" },
  { value: "news", label: "أخبار" },
  { value: "incident", label: "حوادث" },
  { value: "flight", label: "طيران" },
  { value: "marine", label: "ملاحة" },
  { value: "cyber", label: "سيبراني" },
  { value: "social", label: "سوشال" },
  { value: "custom", label: "مخصص" }
];

const severityOptions = [
  { value: "all", label: "كل الشدات" },
  { value: "5", label: "S5 - حرج جدا" },
  { value: "4", label: "S4 - عالي (عاجل)" },
  { value: "3", label: "S3 - متوسط" },
  { value: "2", label: "S2 - منخفض" },
  { value: "1", label: "S1 - معلومة عامة" }
];

const initialSourceForm = {
  name: "",
  source_type: "news",
  endpoint: "",
  parser_hint: "",
  poll_interval_seconds: 120
};

const presetSources = [
  {
    name: "CNN Gulf Publisher Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:cnn.com%20(gulf%20OR%20middle%20east%20war)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Al Arabiya Gulf Publisher Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:alarabiya.net%20(gulf%20OR%20middle%20east%20war)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Gulf News Publisher Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:gulfnews.com%20(gulf%20OR%20middle%20east%20war)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Sky News Gulf Publisher Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=(site:news.sky.com%20OR%20site:skynewsarabia.com)%20(gulf%20OR%20middle%20east%20war)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Sky News Arabia RSS",
    source_type: "news",
    endpoint: "https://www.skynewsarabia.com/web/rss",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "BBC Arabic RSS",
    source_type: "news",
    endpoint: "https://www.bbc.com/arabic/index.xml",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "France 24 Arabic RSS",
    source_type: "news",
    endpoint: "https://www.france24.com/ar/rss",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "RT Arabic RSS",
    source_type: "news",
    endpoint: "https://arabic.rt.com/rss/",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Independent Arabia RSS",
    source_type: "news",
    endpoint: "https://www.independentarabia.com/rss.xml",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "NewsData.io Sky News Arabia",
    source_type: "news",
    endpoint: "https://newsdata.io/api/1/latest?domain=skynewsarabia.com&language=ar",
    parser_hint: "newsdata_io",
    poll_interval_seconds: 180
  },
  {
    name: "GNews Sky News Arabia",
    source_type: "news",
    endpoint: "https://gnews.io/api/v4/search?q=site:skynewsarabia.com&lang=ar&country=ae&max=25",
    parser_hint: "gnews_io",
    poll_interval_seconds: 180
  },
  {
    name: "NewsAPI Sky News Arabia",
    source_type: "news",
    endpoint: "https://newsapi.org/v2/everything?q=skynewsarabia&language=ar&pageSize=25&sortBy=publishedAt",
    parser_hint: "newsapi_org",
    poll_interval_seconds: 180
  },
  {
    name: "Apify Arab News Dataset",
    source_type: "news",
    endpoint: "https://api.apify.com/v2/datasets/<DATASET_ID>/items?clean=true&format=json",
    parser_hint: "apify_arab_news",
    poll_interval_seconds: 240
  },
  {
    name: "WAM UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:wam.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "24.ae UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:24.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Sharjah24 UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:sharjah24.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Emarat Al Youm UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:emaratalyoum.com%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Al Bayan UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:albayan.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Al Khaleej UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:alkhaleej.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Al Ittihad UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:alittihad.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Al Roeya UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:alroeya.com%20(uae%20OR%20dubai%20OR%20abu%20dhabi)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Marine Gulf Security Feed",
    source_type: "marine",
    endpoint:
      "https://news.google.com/rss/search?q=(shipping%20OR%20tanker%20OR%20vessel%20OR%20maritime%20OR%20%E2%80%9C%D9%85%D9%84%D8%A7%D8%AD%D8%A9%E2%80%9D)%20(gulf%20OR%20hormuz%20OR%20uae%20OR%20%D8%A7%D9%84%D8%AE%D9%84%D9%8A%D8%AC%20OR%20%D9%87%D8%B1%D9%85%D8%B2)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 120
  },
  {
    name: "Cyber Gulf Alerts Feed",
    source_type: "cyber",
    endpoint:
      "https://news.google.com/rss/search?q=(cyber%20attack%20OR%20ransomware%20OR%20malware%20OR%20%E2%80%9C%D9%87%D8%AC%D9%88%D9%85%20%D8%B3%D9%8A%D8%A8%D8%B1%D8%A7%D9%86%D9%8A%E2%80%9D%20OR%20%D8%A7%D8%AE%D8%AA%D8%B1%D8%A7%D9%82)%20(gulf%20OR%20uae%20OR%20%D8%A7%D9%84%D8%AE%D9%84%D9%8A%D8%AC%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA)&hl=ar&gl=AE&ceid=AE:ar",
    parser_hint: "rss",
    poll_interval_seconds: 120
  },
  {
    name: "Cyber Advisories (CISA)",
    source_type: "cyber",
    endpoint: "https://www.cisa.gov/news-events/cybersecurity-advisories.xml",
    parser_hint: "cyber_rss",
    poll_interval_seconds: 300
  },
  {
    name: "Reddit WorldNews (Social)",
    source_type: "social",
    endpoint: "https://www.reddit.com/r/worldnews/new.json?limit=80",
    parser_hint: "social_reddit_json",
    poll_interval_seconds: 240
  }
];

const trustedDomains = [
  "cnn.com",
  "edition.cnn.com",
  "news.google.com",
  "google.com",
  "alarabiya.net",
  "gulfnews.com",
  "wam.ae",
  "24.ae",
  "sharjah24.ae",
  "alroeya.com",
  "emaratalyoum.com",
  "albayan.ae",
  "alkhaleej.ae",
  "alittihad.ae",
  "news.sky.com",
  "skynews.com",
  "skynewsarabia.com",
  "bbc.com",
  "france24.com",
  "arabic.rt.com",
  "rt.com",
  "independentarabia.com",
  "reliefweb.int",
  "gdacs.org",
  "cisa.gov",
  "opensky-network.org",
  "marinetraffic.com",
  "flightradar24.com",
  "reddit.com"
];

const trustedNameMarkers = [
  "cnn",
  "alarabiya",
  "gulf news",
  "wam",
  "24.ae",
  "sharjah24",
  "al roeya",
  "emarat al youm",
  "albayan",
  "al khaleej",
  "al ittihad",
  "sky news",
  "skynews",
  "bbc arabic",
  "france 24",
  "rt arabic",
  "independent arabia",
  "reliefweb",
  "gdacs",
  "cisa",
  "opensky",
  "marinetraffic",
  "flightradar"
];

const arabicBreakingSources = new Set([
  "RT Arabic Feed",
  "BBC Arabic Feed",
  "France 24 Arabic Feed",
  "Independent Arabia Feed",
  "Sky News Arabia RSS",
  "Sky News Gulf Publisher Feed",
  "Emarat Al Youm UAE Feed",
  "Al Bayan UAE Feed",
  "Al Khaleej UAE Feed",
  "Al Ittihad UAE Feed"
]);

const englishAllowedBreakingSources = new Set([
  "Sky News Arabia RSS",
  "Sky News Gulf Publisher Feed"
]);

const arabicPreferredNewsNameMarkers = [
  "arabic",
  "sky news arabia",
  "al arabiya",
  "alarabiya",
  "independent arabia",
  "france 24 arabic",
  "bbc arabic",
  "rt arabic",
  "emarat al youm",
  "al bayan",
  "al khaleej",
  "al ittihad",
  "wam uae",
];

const arabicPreferredNewsDomains = [
  "skynewsarabia.com",
  "alarabiya.net",
  "bbc.com",
  "france24.com",
  "arabic.rt.com",
  "independentarabia.com",
  "emaratalyoum.com",
  "albayan.ae",
  "alkhaleej.ae",
  "alittihad.ae",
  "wam.ae",
];

const LIST_PAGE_SIZE = 3;

const skyVideoSources = [
  {
    id: "france24-ar",
    label: "France 24 Arabic",
    embedUrl:
      import.meta.env.VITE_FRANCE24_AR_EMBED_URL ||
      "https://www.youtube.com/embed/live_stream?channel=UCdTyuXgmJkG_O8_75eqej-w&autoplay=1",
    watchUrl: "https://www.youtube.com/channel/UCdTyuXgmJkG_O8_75eqej-w/live"
  },
  {
    id: "al-arabiya-live",
    label: "Al Arabiya",
    embedUrl:
      import.meta.env.VITE_ALARABIYA_EMBED_URL ||
      "https://www.youtube.com/embed/live_stream?channel=UCahpxixMCwoANAftn6IxkTg&autoplay=1",
    watchUrl: "https://www.youtube.com/channel/UCahpxixMCwoANAftn6IxkTg/live"
  },
  {
    id: "al-hadath-live",
    label: "Al Hadath",
    embedUrl:
      import.meta.env.VITE_ALHADATH_EMBED_URL ||
      "https://www.youtube.com/embed/live_stream?channel=UCrj5BGAhtWxDfqbza9T9hqA&autoplay=1",
    watchUrl: "https://www.youtube.com/channel/UCrj5BGAhtWxDfqbza9T9hqA/live"
  },
  {
    id: "al-jazeera-ar",
    label: "Al Jazeera Arabic",
    embedUrl:
      import.meta.env.VITE_ALJAZEERA_AR_EMBED_URL ||
      "https://www.youtube.com/embed/live_stream?channel=UCfiwzLy-8yKzIbsmZTzxDgw&autoplay=1",
    watchUrl: "https://www.youtube.com/channel/UCfiwzLy-8yKzIbsmZTzxDgw/live"
  },
  {
    id: "sky-arabia-live",
    label: "Sky News Arabia",
    embedUrl:
      import.meta.env.VITE_SKY_ARABIA_EMBED_URL ||
      "https://www.youtube.com/embed/U--OjmpjF5o?autoplay=1",
    watchUrl: "https://www.youtube.com/live/U--OjmpjF5o"
  }
];

function forceUnmutedEmbedUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtube.com")) {
      if (url.searchParams.get("mute") === "1" || !url.searchParams.has("mute")) {
        url.searchParams.set("mute", "0");
      }
    }
    return url.toString();
  } catch {
    return String(value).replace("mute=1", "mute=0");
  }
}

function formatTime(value) {
  if (!value) return "غير متاح";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير متاح" : date.toLocaleString("ar-EG", { hour12: false });
}

function eventDisplayTime(row) {
  return row?.created_at || row?.event_time || null;
}

function severityMeaning(level) {
  const value = Number(level);
  if (value >= 5) return "حرج جدا";
  if (value === 4) return "عالي (عاجل)";
  if (value === 3) return "متوسط";
  if (value === 2) return "منخفض";
  return "معلومة عامة";
}

function formatRelativeTime(value) {
  if (!value) return "الآن";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير معروف";
  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60000);
  if (minutes <= 1) return "الآن";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
}

function minutesSince(value) {
  if (!value) return 0;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function freshnessLabel(value) {
  const mins = minutesSince(value);
  if (mins <= 3) return "Live";
  if (mins <= 10) return "10m";
  if (mins <= 60) return "1h";
  if (mins <= 180) return "3h";
  return "3h+";
}

function predictionDueAt(ticket) {
  if (!ticket?.created_at) return null;
  const createdMs = new Date(ticket.created_at).getTime();
  if (!Number.isFinite(createdMs)) return null;
  const hours = Number(ticket.horizon_hours || 0);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return new Date(createdMs + hours * 60 * 60 * 1000);
}

function hoursUntilPredictionDue(ticket) {
  const dueAt = predictionDueAt(ticket);
  if (!dueAt) return null;
  const diffMs = dueAt.getTime() - Date.now();
  return diffMs / (60 * 60 * 1000);
}

function buildOperationalAnalysisTemplate({ focus, country, topic, userRequest }) {
  const safeFocus = String(focus || "").trim() || "تصعيد إقليمي";
  const safeCountry = String(country || "").trim() || "الدولة المحددة";
  const safeTopic = String(topic || "").trim() || safeFocus;
  const safeRequest = String(userRequest || "").trim() || "تحليل تشغيلي متكامل";
  return [
    `التركيز: ${safeFocus}`,
    `الدولة المستهدفة: ${safeCountry}`,
    `الموضوع: ${safeTopic}`,
    `طلب المستخدم: ${safeRequest}`,
    "أنت محلل عمليات. قدّم تحليلًا تنفيذيًا منظمًا بالعربية يشمل النقاط التالية حصراً.",
    "استخدم العناوين التالية حرفياً وبالترتيب حتى يمكن عرضها في صناديق تشغيلية:",
    "[CURRENT_BASELINE]",
    "[LOGISTICS]",
    "[DAMAGES_LOSSES]",
    "[ECONOMIC_COST]",
    "[MITIGATION]",
    "[SHORT_TERM_PREDICTION]",
    "وتحت كل عنوان اكتب نقاطاً موجزة عملية.",
    "مهم: اكتب المخرجات بالعربية فقط بدون كلمات أو عناوين إنجليزية.",
    "المحتوى المطلوب تحت العناوين:",
    "1) ملخص الوضع الحالي مقابل الوضع المرجعي عند بداية الموضوع.",
    "2) معلومات لوجستية فعلية للدولة المستهدفة (المطارات/الموانئ/الطرق/سلاسل الإمداد/الطاقة) وتأثير الحدث عليها.",
    "3) الأضرار والخسائر: بشرية/مادية/تشغيلية مع تمييز المؤكد من غير المؤكد.",
    "4) تقدير التكلفة الاقتصادية المباشرة وغير المباشرة إن توفرت المؤشرات.",
    "5) إجراءات التخفيف والاستجابة التي تم اتخاذها فعلياً منذ بداية الحدث.",
    "6) فجوات الاستجابة الحالية وما الذي يجب متابعته خلال 6/24/72 ساعة.",
    "7) توقع تشغيلي قصير المدى مع سيناريو رئيسي وبديل ونسبة ثقة.",
    "اعرض الناتج في عناوين واضحة ونقاط عملية قابلة للتنفيذ."
  ].join("\n");
}

function parseOperationalSections(text) {
  const raw = String(text || "");
  const keys = [
    "CURRENT_BASELINE",
    "LOGISTICS",
    "DAMAGES_LOSSES",
    "ECONOMIC_COST",
    "MITIGATION",
    "SHORT_TERM_PREDICTION",
  ];
  const out = {
    CURRENT_BASELINE: "",
    LOGISTICS: "",
    DAMAGES_LOSSES: "",
    ECONOMIC_COST: "",
    MITIGATION: "",
    SHORT_TERM_PREDICTION: "",
  };
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const next = keys[i + 1];
    const startTag = new RegExp(`\\[${key}\\]`, "i");
    const startMatch = raw.match(startTag);
    if (!startMatch || startMatch.index == null) continue;
    const start = startMatch.index + startMatch[0].length;
    let end = raw.length;
    if (next) {
      const nextTag = new RegExp(`\\[${next}\\]`, "i");
      const nextMatch = raw.slice(start).match(nextTag);
      if (nextMatch && nextMatch.index != null) end = start + nextMatch.index;
    }
    out[key] = raw.slice(start, end).trim();
  }
  return out;
}

const operationalSectionDefs = [
  { key: "CURRENT_BASELINE", title: "الوضع الحالي مقابل المرجعي" },
  { key: "LOGISTICS", title: "اللوجستيات الفعلية" },
  { key: "DAMAGES_LOSSES", title: "الأضرار والخسائر" },
  { key: "ECONOMIC_COST", title: "التكلفة الاقتصادية" },
  { key: "MITIGATION", title: "إجراءات التخفيف" },
  { key: "SHORT_TERM_PREDICTION", title: "توقع قصير المدى" },
];

function toBulletLines(value) {
  return String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, "").trim());
}

function cleanOperationalTaggedText(value) {
  let text = String(value || "");
  for (const section of operationalSectionDefs) {
    const tag = new RegExp(`\\[${section.key}\\]`, "gi");
    text = text.replace(tag, `\n${section.title}\n`);
  }
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function toReadableBullets(value) {
  const text = String(value || "").replace(/\r/g, "\n").trim();
  if (!text) return [];
  const normalized = text.replace(/(^|[\s:؛،.])([0-9]+[.)])/g, "$1\n$2");
  const chunks = normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = chunks
    .map((line) =>
      line
        .replace(/^[\u2022•\-–—]\s*/, "")
        .replace(/^[0-9]+[.)]\s*/, "")
        .trim()
    )
    .filter(Boolean);
  if (items.length > 1) return items;
  return text
    .split(/[.!؟]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function makePredictionWorkspace(id, index) {
  return {
    id,
    label: `مساحة ${index}`,
    country: "الإمارات",
    topic: "التصعيد في الخليج",
    predictionTitle: "توقع تشغيلي",
    predictionFocus: "الحرب في الخليج مع تركيز الإمارات",
    predictionRequest: "حلل الوضع وقدّم توقعاً تشغيلياً للـ24 ساعة القادمة.",
    predictionHorizon: 24,
    predictionOpenOnly: true,
    predictionDueWithinHours: 0,
    selectedPredictionId: null,
  };
}

function sourceTypeLabel(type) {
  return sourceTypeOptions.find((x) => x.value === type)?.label || type;
}

function eventDomain(url) {
  if (!url) return "";
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

function isTrustedEvent(row) {
  const domain = eventDomain(row.url);
  if (trustedDomains.some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`))) return true;
  if (["flight", "marine", "cyber", "incident"].includes(row.source_type)) return true;
  const name = String(row.source_name || "").toLowerCase();
  return trustedNameMarkers.some((marker) => name.includes(marker));
}

function topicsMatch(text, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q === "war_focus" || q === "حرب" || q === "تركيز الحرب") {
    return ["war", "conflict", "missile", "strike", "attack", "حرب", "هجوم", "صاروخ"].some((k) => text.includes(k));
  }
  if (q === "cyber" || q === "سيبراني" || q === "تركيز سيبراني") {
    return ["cyber", "ransomware", "malware", "breach", "hacked", "اختراق", "سيبراني", "هجوم سيبراني"].some((k) => text.includes(k));
  }
  if (q === "marine" || q === "ملاحي" || q === "تركيز ملاحي") {
    return ["marine", "maritime", "shipping", "tanker", "vessel", "port", "ملاحة", "ناقلة", "سفينة", "ميناء"].some((k) =>
      text.includes(k)
    );
  }
  if (q === "flight" || q === "طيران" || q === "تركيز طيران") {
    return ["flight", "aircraft", "airport", "aviation", "طيران", "مطار", "رحلة"].some((k) => text.includes(k));
  }
  return text.includes(q);
}

function eventText(row) {
  return [row.title, row.summary, row.details, row.ai_assessment, row.tags, row.source_name].filter(Boolean).join(" ").toLowerCase();
}

function eventLane(row) {
  const text = eventText(row);
  if (
    ["cyber", "ransomware", "malware", "breach", "اختراق", "سيبراني", "هجوم سيبراني"].some((keyword) => text.includes(keyword))
  ) {
    return "cyber";
  }
  if (
    ["marine", "maritime", "shipping", "tanker", "vessel", "port", "ملاحة", "ناقلة", "سفينة", "ميناء"].some((keyword) =>
      text.includes(keyword)
    )
  ) {
    return "marine";
  }
  if (["flight", "aircraft", "airport", "aviation", "طيران", "مطار", "رحلة"].some((keyword) => text.includes(keyword))) {
    return "air";
  }
  return "geo";
}

function normalizeStoryTitle(value) {
  const text = cleanText(value || "").toLowerCase();
  if (!text) return "";
  const trimmedSuffix = text.replace(/\s[-|–]\s[^-|–]{1,40}$/u, "");
  return trimmedSuffix.replace(/\s+/g, " ").trim();
}

function noticeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapEmbedUrl(lat, lon) {
  const d = 1.5;
  const minLon = Math.max(-179.9, lon - d);
  const minLat = Math.max(-85, lat - d);
  const maxLon = Math.min(179.9, lon + d);
  const maxLat = Math.min(85, lat + d);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLon}%2C${minLat}%2C${maxLon}%2C${maxLat}&layer=mapnik&marker=${lat}%2C${lon}`;
}

function parseDetailsTokens(details) {
  return String(details || "")
    .split(/\||;|\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((token) => token.includes("="))
    .map((token) => {
      const [k, ...rest] = token.split("=");
      return [k.trim().toLowerCase(), rest.join("=").trim()];
    });
}

function parsePossiblyDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function isStalePublishedForRow(row, publishedRaw) {
  const publishedDate = parsePossiblyDate(publishedRaw);
  const fetchedDate = parsePossiblyDate(row?.created_at);
  if (!publishedDate || !fetchedDate) return false;
  const diffMs = fetchedDate.getTime() - publishedDate.getTime();
  return diffMs > 30 * 24 * 60 * 60 * 1000;
}

function summarizeSourceDetails(row) {
  if (!row) return "";
  const detailsMap = new Map(parseDetailsTokens(row.details));

  if (row.source_type === "flight") {
    const parts = [];
    if (detailsMap.get("callsign")) parts.push(`النداء: ${detailsMap.get("callsign")}`);
    if (detailsMap.get("country")) parts.push(`الدولة: ${detailsMap.get("country")}`);
    if (detailsMap.get("velocity_mps")) parts.push(`السرعة: ${detailsMap.get("velocity_mps")} م/ث`);
    if (detailsMap.get("baro_alt_m")) parts.push(`الارتفاع: ${detailsMap.get("baro_alt_m")} م`);
    if (detailsMap.get("on_ground")) parts.push(`على الأرض: ${detailsMap.get("on_ground")}`);
    return parts.join(" | ") || cleanText(row.summary || "");
  }

  if (row.source_type === "marine") {
    const parts = [];
    if (detailsMap.get("ship_name")) parts.push(`السفينة: ${detailsMap.get("ship_name")}`);
    if (detailsMap.get("mmsi")) parts.push(`MMSI: ${detailsMap.get("mmsi")}`);
    if (detailsMap.get("speed_kn")) parts.push(`السرعة: ${detailsMap.get("speed_kn")} عقدة`);
    return parts.join(" | ") || cleanText(row.summary || "");
  }

  if (row.source_type === "news") {
    const tokens = parseDetailsTokens(row.details).filter(([key, value]) => {
      if (key !== "published") return true;
      return !isStalePublishedForRow(row, value);
    });
    if (tokens.length > 0) {
      return cleanText(tokens.map(([k, v]) => `${k}=${v}`).join(" | "));
    }
    return cleanText(row.summary || "");
  }

  return cleanText(row.details || row.summary || "");
}

function parseFacts(row) {
  if (!row) return [];
  const facts = [
    ["المصدر", row.source_name],
    ["النوع", sourceTypeLabel(row.source_type)],
    ["الشدّة", `S${row.severity}`],
    ["الصلة", row.relevance_score],
    ["الموقع", row.location],
    ["الوسوم", row.tags]
  ];
  if (row.latitude != null && row.longitude != null) facts.push(["الإحداثيات", `${row.latitude}, ${row.longitude}`]);

  const detailsMap = new Map(parseDetailsTokens(row.details));
  const importantByType = {
    flight: ["callsign", "country", "velocity_mps", "baro_alt_m", "on_ground", "track_deg"],
    marine: ["ship_name", "mmsi", "speed_kn", "heading", "status", "destination"],
    cyber: ["cve", "severity", "vendor", "product"],
    incident: ["country", "city", "category"],
    news: ["published", "author", "source"],
    social: ["social_sentiment", "trend_score", "comments"]
  };
  const selectedKeys = importantByType[row.source_type] || [];
  for (const key of selectedKeys) {
    if (!detailsMap.has(key)) continue;
    const value = detailsMap.get(key);
    if (key === "published" && isStalePublishedForRow(row, value)) continue;
    facts.push([key, value]);
  }

  return facts.filter(([, value]) => value).slice(0, 12);
}

function cleanText(value) {
  if (!value) return "";
  const withoutTags = String(value).replace(/<[^>]*>/g, " ");
  if (typeof document === "undefined") return withoutTags.replace(/\s+/g, " ").trim();
  const node = document.createElement("textarea");
  node.innerHTML = withoutTags;
  return node.value.replace(/\s+/g, " ").trim();
}

function normalizeLegacyText(value) {
  return cleanText(value).replace(/war_focus/gi, "تركيز الحرب");
}

function isLegacyHistoryRow(row) {
  const joined = [row?.title, row?.prompt, row?.content].map((x) => String(x || "")).join(" ");
  return /war_focus/i.test(joined);
}

function byCreatedAtDesc(a, b) {
  const aTs = new Date(a?.created_at || 0).getTime();
  const bTs = new Date(b?.created_at || 0).getTime();
  const aSafe = Number.isNaN(aTs) ? 0 : aTs;
  const bSafe = Number.isNaN(bTs) ? 0 : bTs;
  return bSafe - aSafe;
}

function byDateDesc(aDateValue, bDateValue) {
  const aTs = new Date(aDateValue || 0).getTime();
  const bTs = new Date(bDateValue || 0).getTime();
  const aSafe = Number.isNaN(aTs) ? 0 : aTs;
  const bSafe = Number.isNaN(bTs) ? 0 : bTs;
  return bSafe - aSafe;
}

function paginationWindow(currentPage, totalPages, radius = 2) {
  const start = Math.max(1, currentPage - radius);
  const end = Math.min(totalPages, currentPage + radius);
  const pages = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}

function likelyEnglish(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /[A-Za-z]/.test(text) && !/[\u0600-\u06FF]/.test(text);
}

function hasArabicScript(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /[\u0600-\u06FF]/.test(text);
}

function isArabicPreferredNewsRow(row) {
  if (!row || row.source_type !== "news") return false;
  const name = String(row.source_name || "").toLowerCase();
  const domain = eventDomain(row.url);
  if (arabicPreferredNewsNameMarkers.some((marker) => name.includes(marker))) return true;
  if (arabicPreferredNewsDomains.some((trusted) => domain === trusted || domain.endsWith(`.${trusted}`))) return true;
  return hasArabicScript(row.title) || hasArabicScript(row.summary) || hasArabicScript(row.details);
}

function buildTrend(events) {
  const buckets = Array.from({ length: 8 }, () => 0);
  const now = Date.now();
  const start = now - 24 * 60 * 60 * 1000;
  const bucket = 3 * 60 * 60 * 1000;
  for (const row of events) {
    const ts = new Date(row.event_time).getTime();
    if (Number.isNaN(ts) || ts < start || ts > now) continue;
    buckets[Math.min(7, Math.floor((ts - start) / bucket))] += 1;
  }
  const max = Math.max(...buckets, 1);
  const points = buckets
    .map((value, index) => {
      const x = (index / 7) * 100;
      const y = 100 - (value / max) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  return { buckets, points };
}

function downloadBlob(filename, blob) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

export default function App() {
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [sources, setSources] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [insights, setInsights] = useState([]);
  const [reports, setReports] = useState([]);
  const [privacy, setPrivacy] = useState({ privacy_mode: true, openai_enabled: false });
  const [aiStatus, setAiStatus] = useState({
    configured: false,
    connected: false,
    model: "gpt-4.1-mini",
    message: "Checking..."
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [ingestionRunning, setIngestionRunning] = useState(false);

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [selectedSourceNames, setSelectedSourceNames] = useState([]);
  const [trustedOnly, setTrustedOnly] = useState(true);
  const [includePeople, setIncludePeople] = useState(true);

  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourceForm, setSourceForm] = useState(initialSourceForm);

  const [leftTab, setLeftTab] = useState("feed");
  const [feedPage, setFeedPage] = useState(1);
  const [alertsPage, setAlertsPage] = useState(1);
  const [focusedEventId, setFocusedEventId] = useState(null);
  const [focusedAlertId, setFocusedAlertId] = useState(null);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [selectedAlertIds, setSelectedAlertIds] = useState([]);
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState(skyVideoSources[0]?.id || "");
  const [versionTab, setVersionTab] = useState("v1");
  const [aiTab, setAiTab] = useState("chat");
  const [v2Lane, setV2Lane] = useState("all");
  const [v2UnreadOnly, setV2UnreadOnly] = useState(false);
  const [v2TrustedOnly, setV2TrustedOnly] = useState(true);
  const [v2FocusedEventId, setV2FocusedEventId] = useState(null);
  const [v2SelectedEventIds, setV2SelectedEventIds] = useState([]);
  const [predictionTickets, setPredictionTickets] = useState([]);
  const [predictionUpdates, setPredictionUpdates] = useState([]);
  const [predictionWorkspaces, setPredictionWorkspaces] = useState(() => [makePredictionWorkspace("ws-1", 1)]);
  const [activePredictionWorkspaceId, setActivePredictionWorkspaceId] = useState("ws-1");
  const [predictionLeaderboard, setPredictionLeaderboard] = useState([]);
  const [creatingPrediction, setCreatingPrediction] = useState(false);
  const [updatingPrediction, setUpdatingPrediction] = useState(false);
  const [deletingPredictionId, setDeletingPredictionId] = useState(null);
  const [clearingPredictionTickets, setClearingPredictionTickets] = useState(false);
  const [predictionNote, setPredictionNote] = useState("");
  const [liveNotices, setLiveNotices] = useState([]);

  const [chatInput, setChatInput] = useState("");
  const [analysisTitle, setAnalysisTitle] = useState("تحليل تشغيلي");
  const [analysisPrompt, setAnalysisPrompt] = useState("");
  const [submittingChat, setSubmittingChat] = useState(false);
  const [submittingInsight, setSubmittingInsight] = useState(false);
  const [publishingReport, setPublishingReport] = useState(false);
  const [clearingChat, setClearingChat] = useState(false);
  const [clearingInsights, setClearingInsights] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState(null);
  const [popupEventId, setPopupEventId] = useState(null);
  const [contentModal, setContentModal] = useState(null);
  const [arabicMap, setArabicMap] = useState({});
  const [seenEventIds, setSeenEventIds] = useState([]);
  const [v2FocusFlash, setV2FocusFlash] = useState(false);
  const v2FocusPanelRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [eventsResp, alertsResp, sourcesResp, messagesResp, insightsResp, reportsResp, privacyResp, predictionsResp, leaderboardResp] =
        await Promise.all([
        apiGet("/events?limit=500"),
        apiGet("/alerts?limit=200"),
        apiGet("/sources"),
        apiGet("/ai/messages?limit=120"),
        apiGet("/ai/insights?limit=80"),
        apiGet("/ai/reports?limit=40"),
        apiGet("/ai/privacy"),
        apiGet("/ai/predictions?limit=120").catch(() => []),
        apiGet("/ai/predictions/leaderboard").catch(() => [])
      ]);
      let aiStatusResp = {
        configured: false,
        connected: false,
        model: "gpt-4.1-mini",
        message: "Unavailable"
      };
      try {
        aiStatusResp = await apiGet("/ai/status");
      } catch {
        // Keep default status when probe endpoint is not reachable.
      }
      setEvents(eventsResp);
      setAlerts(alertsResp);
      setSources(sourcesResp);
      setChatMessages(messagesResp);
      setInsights(
        [...insightsResp]
          .filter((row) => !isLegacyHistoryRow(row))
          .sort(byCreatedAtDesc)
      );
      setReports(
        [...reportsResp]
          .filter((row) => !isLegacyHistoryRow(row))
          .sort(byCreatedAtDesc)
      );
      setPrivacy(privacyResp);
      setPredictionTickets(Array.isArray(predictionsResp) ? predictionsResp : []);
      setPredictionLeaderboard(Array.isArray(leaderboardResp) ? leaderboardResp : []);
      setAiStatus(aiStatusResp);
      setLastSync(new Date().toISOString());
      setError("");
    } catch (err) {
      setError(err.message || "فشل تحميل البيانات.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 30000);
    return () => clearInterval(id);
  }, [loadAll]);

  useEffect(() => {
    const unsubscribe = streamEvents((payload) => {
      if (payload?.type === "event" || payload?.type === "alert" || payload?.type === "prediction") loadAll();
      if (payload?.type === "prediction") {
        const message =
          payload?.action === "created"
            ? `تذكرة توقع جديدة: ${payload?.title || ""}`
            : payload?.action === "updated"
              ? `تم تحديث تذكرة التوقع: ${payload?.title || ""}`
              : payload?.action === "outcome"
                ? `تم تسجيل نتيجة التوقع: ${payload?.outcome || ""}`
                : "تحديث تلقائي على تذكرة توقع";
        const id = noticeId();
        setLiveNotices((prev) => [{ id, message }, ...prev].slice(0, 6));
        setTimeout(() => {
          setLiveNotices((prev) => prev.filter((row) => row.id !== id));
        }, 6000);
      }
    });
    return unsubscribe;
  }, [loadAll]);

  const sourceScopedEvents = useMemo(() => {
    let rows = [...events];
    if (trustedOnly) rows = rows.filter((r) => isTrustedEvent(r));
    if (selectedSourceNames.length > 0) {
      const selected = new Set(selectedSourceNames);
      rows = rows.filter((r) => selected.has(r.source_name));
    }
    rows = rows.filter((r) => topicsMatch(eventText(r), query));
    return rows;
  }, [events, trustedOnly, selectedSourceNames, query]);

  const filteredEvents = useMemo(() => {
    let rows = [...sourceScopedEvents];
    if (sourceFilter !== "all") rows = rows.filter((r) => r.source_type === sourceFilter);
    if (severityFilter !== "all") rows = rows.filter((r) => r.severity === Number(severityFilter));
    if (!includePeople) rows = rows.filter((r) => r.source_type !== "social");
    return rows;
  }, [sourceScopedEvents, sourceFilter, severityFilter, includePeople]);

  const sortedFilteredEvents = useMemo(
    () => [...filteredEvents].sort((a, b) => byDateDesc(eventDisplayTime(a), eventDisplayTime(b))),
    [filteredEvents]
  );

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => byDateDesc(a.created_at, b.created_at)),
    [alerts]
  );

  const feedTotalPages = useMemo(() => Math.max(1, Math.ceil(sortedFilteredEvents.length / LIST_PAGE_SIZE)), [sortedFilteredEvents.length]);
  const alertsTotalPages = useMemo(() => Math.max(1, Math.ceil(sortedAlerts.length / LIST_PAGE_SIZE)), [sortedAlerts.length]);

  const visibleFeedEvents = useMemo(() => {
    const start = (feedPage - 1) * LIST_PAGE_SIZE;
    return sortedFilteredEvents.slice(start, start + LIST_PAGE_SIZE);
  }, [feedPage, sortedFilteredEvents]);

  const visibleAlerts = useMemo(() => {
    const start = (alertsPage - 1) * LIST_PAGE_SIZE;
    return sortedAlerts.slice(start, start + LIST_PAGE_SIZE);
  }, [alertsPage, sortedAlerts]);

  const feedPageNumbers = useMemo(() => paginationWindow(feedPage, feedTotalPages), [feedPage, feedTotalPages]);
  const alertsPageNumbers = useMemo(() => paginationWindow(alertsPage, alertsTotalPages), [alertsPage, alertsTotalPages]);
  const feedRange = useMemo(() => {
    if (sortedFilteredEvents.length === 0) return { from: 0, to: 0 };
    const from = (feedPage - 1) * LIST_PAGE_SIZE + 1;
    const to = Math.min(feedPage * LIST_PAGE_SIZE, sortedFilteredEvents.length);
    return { from, to };
  }, [feedPage, sortedFilteredEvents.length]);
  const alertsRange = useMemo(() => {
    if (sortedAlerts.length === 0) return { from: 0, to: 0 };
    const from = (alertsPage - 1) * LIST_PAGE_SIZE + 1;
    const to = Math.min(alertsPage * LIST_PAGE_SIZE, sortedAlerts.length);
    return { from, to };
  }, [alertsPage, sortedAlerts.length]);

  const eventsById = useMemo(() => {
    const map = new Map();
    for (const row of events) map.set(row.id, row);
    return map;
  }, [events]);

  const sourceEndpointByName = useMemo(() => {
    const map = new Map();
    for (const source of sources) map.set(source.name, source.endpoint);
    return map;
  }, [sources]);

  const ensureEventLoaded = useCallback(
    async (eventId) => {
      if (!eventId || eventsById.has(eventId)) return;
      try {
        const row = await apiGet(`/events/${eventId}`);
        setEvents((prev) => (prev.some((item) => item.id === row.id) ? prev : [row, ...prev]));
      } catch {
        // Keep current list if event lookup is unavailable.
      }
    },
    [eventsById]
  );

  const availableSourceChoices = useMemo(
    () => sources.filter((source) => source.enabled).map((source) => source.name).sort((a, b) => a.localeCompare(b)),
    [sources]
  );

  useEffect(() => {
    if (!focusedEventId && sortedFilteredEvents[0]) setFocusedEventId(sortedFilteredEvents[0].id);
    if (focusedEventId && !events.some((r) => r.id === focusedEventId)) setFocusedEventId(sortedFilteredEvents[0]?.id ?? null);
    setSelectedEventIds((prev) => prev.filter((id) => events.some((r) => r.id === id)));
  }, [events, sortedFilteredEvents, focusedEventId]);

  useEffect(() => {
    setFeedPage(1);
  }, [query, sourceFilter, severityFilter, selectedSourceNames, trustedOnly, includePeople]);

  useEffect(() => {
    setFeedPage((prev) => Math.min(Math.max(1, prev), feedTotalPages));
  }, [feedTotalPages]);

  useEffect(() => {
    setAlertsPage((prev) => Math.min(Math.max(1, prev), alertsTotalPages));
  }, [alertsTotalPages]);

  useEffect(() => {
    setSelectedAlertIds((prev) => prev.filter((id) => alerts.some((row) => row.id === id)));
  }, [alerts]);

  useEffect(() => {
    const validIds = new Set(events.map((row) => row.id));
    setSeenEventIds((prev) => prev.filter((id) => validIds.has(id)));
  }, [events]);

  const activePredictionWorkspace = useMemo(
    () => predictionWorkspaces.find((row) => row.id === activePredictionWorkspaceId) || predictionWorkspaces[0] || null,
    [predictionWorkspaces, activePredictionWorkspaceId]
  );

  const selectedPredictionId = activePredictionWorkspace?.selectedPredictionId || null;

  function updateActivePredictionWorkspace(patch) {
    if (!activePredictionWorkspaceId) return;
    setPredictionWorkspaces((prev) =>
      prev.map((row) => {
        if (row.id !== activePredictionWorkspaceId) return row;
        const nextPatch = typeof patch === "function" ? patch(row) : patch;
        return { ...row, ...nextPatch };
      })
    );
  }

  function addPredictionWorkspace() {
    const id = `ws-${Date.now()}`;
    setPredictionWorkspaces((prev) => [...prev, makePredictionWorkspace(id, prev.length + 1)]);
    setActivePredictionWorkspaceId(id);
    setPredictionUpdates([]);
    setPredictionNote("");
  }

  function clearActivePredictionWorkspace() {
    updateActivePredictionWorkspace({
      country: "",
      topic: "",
      predictionTitle: "",
      predictionFocus: "",
      predictionRequest: "",
      predictionHorizon: 24,
      predictionOpenOnly: true,
      predictionDueWithinHours: 0,
      selectedPredictionId: null,
    });
    setPredictionNote("");
    setPredictionUpdates([]);
  }

  const scopedPredictionTickets = useMemo(() => {
    if (!activePredictionWorkspace) return [];
    return predictionTickets.filter((row) => {
      const scope = String(row.scope || "").trim();
      if (activePredictionWorkspace.id === "ws-1") {
        return scope === "ws-1" || scope === "V2" || scope === "";
      }
      return scope === activePredictionWorkspace.id;
    });
  }, [predictionTickets, activePredictionWorkspace]);

  const filteredPredictionTickets = useMemo(() => {
    let rows = [...scopedPredictionTickets].sort((a, b) => byDateDesc(a.updated_at, b.updated_at));
    if (activePredictionWorkspace?.predictionOpenOnly) {
      rows = rows.filter((row) => ["open", "watching"].includes(String(row.status || "").toLowerCase()));
    }
    if ((activePredictionWorkspace?.predictionDueWithinHours || 0) > 0) {
      rows = rows.filter((row) => {
        const hoursLeft = hoursUntilPredictionDue(row);
        return hoursLeft != null && hoursLeft <= activePredictionWorkspace.predictionDueWithinHours;
      });
    }
    return rows;
  }, [scopedPredictionTickets, activePredictionWorkspace]);

  useEffect(() => {
    if (!activePredictionWorkspaceId && predictionWorkspaces[0]) {
      setActivePredictionWorkspaceId(predictionWorkspaces[0].id);
    }
  }, [predictionWorkspaces, activePredictionWorkspaceId]);

  useEffect(() => {
    if (!selectedPredictionId) {
      setPredictionUpdates([]);
      return;
    }
    let cancelled = false;
    async function run() {
      try {
        const rows = await apiGet(`/ai/predictions/${selectedPredictionId}/updates?limit=120`);
        if (!cancelled) setPredictionUpdates(Array.isArray(rows) ? rows : []);
      } catch {
        if (!cancelled) setPredictionUpdates([]);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedPredictionId, lastSync]);

  useEffect(() => {
    if (!activePredictionWorkspace) return;
    if (!filteredPredictionTickets.length) {
      if (activePredictionWorkspace.selectedPredictionId !== null) {
        updateActivePredictionWorkspace({ selectedPredictionId: null });
      }
      return;
    }
    if (!activePredictionWorkspace.selectedPredictionId) {
      updateActivePredictionWorkspace({ selectedPredictionId: filteredPredictionTickets[0].id });
      return;
    }
    if (!filteredPredictionTickets.some((row) => row.id === activePredictionWorkspace.selectedPredictionId)) {
      updateActivePredictionWorkspace({ selectedPredictionId: filteredPredictionTickets[0].id });
    }
  }, [filteredPredictionTickets, activePredictionWorkspace]);

  const activeEvent = useMemo(() => {
    const focused = focusedEventId ? eventsById.get(focusedEventId) : null;
    return focused || sortedFilteredEvents[0] || events[0] || null;
  }, [events, eventsById, sortedFilteredEvents, focusedEventId]);

  const activeAlert = useMemo(() => alerts.find((r) => r.id === focusedAlertId) || null, [alerts, focusedAlertId]);

  const selectedAlertEventIds = useMemo(() => {
    const ids = alerts
      .filter((row) => selectedAlertIds.includes(row.id))
      .map((row) => row.event_id)
      .filter((id) => Number.isInteger(id) && id > 0);
    return [...new Set(ids)];
  }, [alerts, selectedAlertIds]);

  const selectedContextEventIds = useMemo(
    () => [...new Set([...selectedEventIds, ...selectedAlertEventIds])],
    [selectedAlertEventIds, selectedEventIds]
  );
  const totalSelectedCount = selectedEventIds.length + selectedAlertIds.length;

  const popupEvent = useMemo(() => {
    if (!popupEventId) return null;
    return eventsById.get(popupEventId) || null;
  }, [eventsById, popupEventId]);

  const popupFacts = useMemo(() => parseFacts(popupEvent), [popupEvent]);

  const popupSourceEndpoint = useMemo(() => {
    if (!popupEvent) return null;
    return sourceEndpointByName.get(popupEvent.source_name) || sources.find((row) => row.source_type === popupEvent.source_type)?.endpoint || null;
  }, [popupEvent, sourceEndpointByName, sources]);

  const seenEventIdSet = useMemo(() => new Set(seenEventIds), [seenEventIds]);

  const isUnseenEvent = useCallback((row) => (row?.id ? !seenEventIdSet.has(row.id) : false), [seenEventIdSet]);

  const workingEventIds = useMemo(() => {
    if (selectedContextEventIds.length > 0) return selectedContextEventIds;
    if (activeEvent?.id) return [activeEvent.id];
    return sortedFilteredEvents.slice(0, 40).map((r) => r.id);
  }, [selectedContextEventIds, activeEvent, sortedFilteredEvents]);

  const chatEventIds = useMemo(() => {
    if (selectedContextEventIds.length > 0) return selectedContextEventIds;
    return [];
  }, [selectedContextEventIds]);

  const analysisEventIds = useMemo(() => {
    if (selectedContextEventIds.length > 0) return selectedContextEventIds;
    return sortedFilteredEvents.slice(0, 80).map((r) => r.id);
  }, [selectedContextEventIds, sortedFilteredEvents]);

  const analysisSelectionCount = selectedContextEventIds.length;

  const facts = useMemo(() => parseFacts(activeEvent), [activeEvent]);

  const mapEvent = useMemo(() => {
    if (activeEvent?.latitude != null && activeEvent?.longitude != null) return activeEvent;
    return filteredEvents.find((r) => r.latitude != null && r.longitude != null) || null;
  }, [activeEvent, filteredEvents]);

  const stats = useMemo(
    () => ({
      totalEvents: filteredEvents.length,
      highSeverity: filteredEvents.filter((x) => x.severity >= 4).length,
      openAlerts: alerts.filter((x) => !x.acknowledged).length,
      enabledSources: sources.filter((x) => x.enabled).length,
      socialCount: filteredEvents.filter((x) => x.source_type === "social").length
    }),
    [filteredEvents, alerts, sources]
  );

  const sourceCounts = useMemo(() => {
    const c = {};
    for (const row of filteredEvents) c[row.source_type] = (c[row.source_type] || 0) + 1;
    return c;
  }, [filteredEvents]);

  const severityCounts = useMemo(() => {
    const c = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of filteredEvents) c[row.severity] += 1;
    return c;
  }, [filteredEvents]);

  const trend = useMemo(() => buildTrend(filteredEvents), [filteredEvents]);

  const v2Events = useMemo(() => {
    let rows = [...sortedFilteredEvents];
    if (v2TrustedOnly) rows = rows.filter((row) => isTrustedEvent(row));
    if (v2Lane !== "all") rows = rows.filter((row) => eventLane(row) === v2Lane);
    if (v2UnreadOnly) rows = rows.filter((row) => !seenEventIdSet.has(row.id));
    return rows;
  }, [sortedFilteredEvents, v2TrustedOnly, v2Lane, v2UnreadOnly, seenEventIdSet]);

  const v2LaneStats = useMemo(() => {
    const lanes = ["geo", "cyber", "marine", "air"];
    const baseRows = v2TrustedOnly ? sortedFilteredEvents.filter((row) => isTrustedEvent(row)) : sortedFilteredEvents;
    const stats = { all: { total: baseRows.length, newCount: 0 } };
    stats.all.newCount = baseRows.filter((row) => !seenEventIdSet.has(row.id) && minutesSince(eventDisplayTime(row)) <= 30).length;
    for (const lane of lanes) {
      const rows = baseRows.filter((row) => eventLane(row) === lane);
      stats[lane] = {
        total: rows.length,
        newCount: rows.filter((row) => !seenEventIdSet.has(row.id) && minutesSince(eventDisplayTime(row)) <= 30).length
      };
    }
    return stats;
  }, [sortedFilteredEvents, v2TrustedOnly, seenEventIdSet]);

  const v2Freshness = useMemo(() => {
    const counts = { live: 0, ten: 0, oneHour: 0, threeHours: 0, stale: 0 };
    for (const row of v2Events) {
      const mins = minutesSince(eventDisplayTime(row));
      if (mins <= 3) counts.live += 1;
      else if (mins <= 10) counts.ten += 1;
      else if (mins <= 60) counts.oneHour += 1;
      else if (mins <= 180) counts.threeHours += 1;
      else counts.stale += 1;
    }
    return counts;
  }, [v2Events]);

  const v2StoryGroups = useMemo(() => {
    const grouped = new Map();
    for (const row of v2Events) {
      const key = normalizeStoryTitle(row.title) || `event-${row.id}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    return [...grouped.values()]
      .map((items) => {
        const sorted = [...items].sort((a, b) => byDateDesc(eventDisplayTime(a), eventDisplayTime(b)));
        const lead = [...sorted].sort((a, b) => b.severity - a.severity || byDateDesc(eventDisplayTime(a), eventDisplayTime(b)))[0];
        const sourcesSet = new Set(sorted.map((item) => item.source_name).filter(Boolean));
        return {
          key: `${lead.id}-${sorted.length}`,
          lead,
          size: sorted.length,
          latestTime: eventDisplayTime(sorted[0]),
          sources: [...sourcesSet].slice(0, 4)
        };
      })
      .sort((a, b) => b.lead.severity - a.lead.severity || byDateDesc(a.latestTime, b.latestTime));
  }, [v2Events]);

  const v2Narrative = useMemo(() => {
    const top = v2Events[0];
    const topHigh = v2Events.find((row) => row.severity >= 4);
    const laneHot = ["geo", "cyber", "marine", "air"]
      .map((lane) => ({ lane, count: v2Events.filter((row) => eventLane(row) === lane).length }))
      .sort((a, b) => b.count - a.count)[0];
    return {
      happened: top ? displayText(top.title) : "لا توجد أحداث حالياً.",
      why: topHigh
        ? `الأولوية الآن: ${severityMeaning(topHigh.severity)} (S${topHigh.severity}) من ${displayText(topHigh.source_name)}.`
        : "لا توجد أحداث عالية الشدة حالياً ضمن هذا الفلتر.",
      next:
        laneHot && laneHot.count > 0
          ? `راقب مسار ${laneHot.lane === "geo" ? "جيوسياسي" : laneHot.lane === "cyber" ? "سيبراني" : laneHot.lane === "marine" ? "ملاحي" : "جوي"} خلال الساعة القادمة.`
          : "تابع التحديثات الجديدة خلال الدقائق القادمة."
    };
  }, [v2Events]);

  useEffect(() => {
    const valid = new Set(v2Events.map((row) => row.id));
    setV2SelectedEventIds((prev) => prev.filter((id) => valid.has(id)));
  }, [v2Events]);

  useEffect(() => {
    if (!v2FocusedEventId && v2Events[0]) {
      setV2FocusedEventId(v2Events[0].id);
      return;
    }
    if (v2FocusedEventId && !v2Events.some((row) => row.id === v2FocusedEventId)) {
      setV2FocusedEventId(v2Events[0]?.id ?? null);
    }
  }, [v2Events, v2FocusedEventId]);

  const v2FocusedEvent = useMemo(() => {
    if (v2FocusedEventId) return eventsById.get(v2FocusedEventId) || null;
    return v2Events[0] || null;
  }, [v2FocusedEventId, eventsById, v2Events]);

  const selectedPredictionTicket = useMemo(
    () => filteredPredictionTickets.find((row) => row.id === selectedPredictionId) || filteredPredictionTickets[0] || null,
    [filteredPredictionTickets, selectedPredictionId]
  );
  const selectedPredictionSections = useMemo(
    () => parseOperationalSections(selectedPredictionTicket?.prediction_text || ""),
    [selectedPredictionTicket]
  );

  const activeVideoSource = useMemo(
    () => skyVideoSources.find((row) => row.id === selectedVideoSourceId) || skyVideoSources[0],
    [selectedVideoSourceId]
  );

  const visibleInsights = useMemo(
    () =>
      [...insights]
        .filter((row) => !isLegacyHistoryRow(row))
        .sort(byCreatedAtDesc),
    [insights]
  );

  const visibleReports = useMemo(
    () =>
      [...reports]
        .filter((row) => !isLegacyHistoryRow(row))
        .sort(byCreatedAtDesc),
    [reports]
  );

  const openAiConnected = aiStatus.configured && aiStatus.connected && privacy.openai_enabled;
  const liveIngestionConnected = useMemo(() => {
    if (ingestionRunning) return true;
    if (!lastSync) return false;
    const timestamp = new Date(lastSync).getTime();
    if (!Number.isFinite(timestamp)) return false;
    return Date.now() - timestamp <= 90 * 1000;
  }, [lastSync, ingestionRunning]);
  const socialEnabledSources = useMemo(
    () => sources.filter((row) => row.enabled && row.source_type === "social").length,
    [sources]
  );

  const translationCandidates = useMemo(() => {
    const inputs = [
      ...filteredEvents.slice(0, 120).flatMap((row) => [row.title, row.summary, row.details]),
      ...alerts.slice(0, 20).flatMap((row) => [row.title, row.details]),
      activeEvent?.title,
      activeEvent?.summary,
      activeEvent?.ai_assessment,
      summarizeSourceDetails(activeEvent),
      popupEvent?.title,
      popupEvent?.summary,
      popupEvent?.ai_assessment,
      summarizeSourceDetails(popupEvent)
    ];
    return [...new Set(inputs.map(cleanText).filter((text) => text && likelyEnglish(text)))].slice(0, 180);
  }, [activeEvent, alerts, filteredEvents, popupEvent]);

  useEffect(() => {
    if (!openAiConnected || translationCandidates.length === 0) return;
    const missing = translationCandidates.filter((text) => !arabicMap[text]).slice(0, 120);
    if (missing.length === 0) return;
    let cancelled = false;

    async function run() {
      for (let index = 0; index < missing.length; index += 20) {
        const chunk = missing.slice(index, index + 20);
        try {
          const response = await apiPost("/ai/translate/bulk", { texts: chunk });
          if (cancelled) return;
          const translated = Array.isArray(response?.translations) ? response.translations : [];
          setArabicMap((prev) => {
            const next = { ...prev };
            for (let i = 0; i < chunk.length; i += 1) {
              next[chunk[i]] = cleanText(translated[i] || chunk[i]);
            }
            return next;
          });
        } catch {
          // Ignore translation failures and continue with original text.
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [arabicMap, openAiConnected, translationCandidates]);

  function displayText(value) {
    const text = cleanText(value);
    if (!text) return "";
    return normalizeLegacyText(arabicMap[text] || text);
  }

  useEffect(() => {
    if (!popupEventId && !contentModal) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (popupEventId) setPopupEventId(null);
      if (contentModal) setContentModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [popupEventId, contentModal]);

  function toggleSelected(eventId) {
    setSelectedEventIds((prev) => (prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]));
  }

  function toggleAlertSelected(alertId) {
    setSelectedAlertIds((prev) => (prev.includes(alertId) ? prev.filter((id) => id !== alertId) : [...prev, alertId]));
  }

  function clearSelections() {
    setSelectedEventIds([]);
    setSelectedAlertIds([]);
  }

  function openEventPopup(eventId, options = {}) {
    if (!eventId) return;
    setSeenEventIds((prev) => (prev.includes(eventId) ? prev : [...prev, eventId]));
    if (options.scope !== "v2") {
      setFocusedEventId(eventId);
      if (typeof options.alertId === "number") {
        setFocusedAlertId(options.alertId);
      } else if (!options.keepAlert) {
        setFocusedAlertId(null);
      }
    }
    setPopupEventId(eventId);
    void ensureEventLoaded(eventId);
  }

  function focusEvent(eventId, options = {}) {
    if (!eventId) return;
    setSeenEventIds((prev) => (prev.includes(eventId) ? prev : [...prev, eventId]));
    setFocusedEventId(eventId);
    if (typeof options.alertId === "number") {
      setFocusedAlertId(options.alertId);
    }
    void ensureEventLoaded(eventId);
  }

  function changeSelectedSources(event) {
    const picked = Array.from(event.target.selectedOptions).map((option) => option.value);
    setSelectedSourceNames(picked);
  }

  function markEventSeen(eventId) {
    if (!eventId) return;
    setSeenEventIds((prev) => (prev.includes(eventId) ? prev : [...prev, eventId]));
  }

  function focusV2Story(eventId) {
    if (!eventId) return;
    setV2FocusedEventId(eventId);
    markEventSeen(eventId);
    setV2SelectedEventIds((prev) => (prev.includes(eventId) ? prev : [eventId, ...prev]));
    setV2FocusFlash(true);
    setTimeout(() => setV2FocusFlash(false), 850);
    setTimeout(() => {
      v2FocusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function toggleV2Selected(eventId) {
    if (!eventId) return;
    setV2SelectedEventIds((prev) => (prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]));
  }

  async function analyzeV2Selected() {
    const ids = v2SelectedEventIds.length > 0 ? v2SelectedEventIds : v2Events.slice(0, 30).map((row) => row.id);
    if (ids.length === 0) {
      setError("لا توجد عناصر في V2 للتحليل.");
      return;
    }
    if (!activePredictionWorkspace) {
      setError("لا توجد مساحة تحليل نشطة.");
      return;
    }
    setSubmittingInsight(true);
    try {
      const structuredPrompt = buildOperationalAnalysisTemplate({
        focus: activePredictionWorkspace.predictionFocus,
        country: activePredictionWorkspace.country,
        topic: activePredictionWorkspace.topic,
        userRequest: activePredictionWorkspace.predictionRequest,
      });
      const insight = await apiPost("/ai/insights", {
        title: `تحليل ${activePredictionWorkspace.label}: ${activePredictionWorkspace.predictionFocus || "تركيز عام"}`,
        prompt: structuredPrompt,
        event_ids: ids
      });
      setContentModal({
        title: insight?.title || "تحليل V2",
        content: insight?.content || "لا توجد بيانات.",
        createdAt: insight?.created_at || null
      });
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تحليل عناصر V2.");
    } finally {
      setSubmittingInsight(false);
    }
  }

  async function createPredictionTicket() {
    const ids = v2SelectedEventIds.length > 0 ? v2SelectedEventIds : v2Events.slice(0, 40).map((row) => row.id);
    if (!activePredictionWorkspace) {
      setError("لا توجد مساحة توقع نشطة.");
      return;
    }
    if (
      !String(activePredictionWorkspace.predictionTitle || "").trim() ||
      !String(activePredictionWorkspace.predictionFocus || "").trim() ||
      !String(activePredictionWorkspace.predictionRequest || "").trim()
    ) {
      setError("أدخل عنوان التوقع والتركيز والطلب.");
      return;
    }
    setCreatingPrediction(true);
    try {
      const structuredRequest = buildOperationalAnalysisTemplate({
        focus: activePredictionWorkspace.predictionFocus,
        country: activePredictionWorkspace.country,
        topic: activePredictionWorkspace.topic,
        userRequest: activePredictionWorkspace.predictionRequest,
      });
      const ticket = await apiPost("/ai/predictions", {
        title: String(activePredictionWorkspace.predictionTitle || "").trim(),
        focus_query: String(activePredictionWorkspace.predictionFocus || "").trim(),
        request_text: structuredRequest,
        horizon_hours: Number(activePredictionWorkspace.predictionHorizon) || 24,
        scope: activePredictionWorkspace.id,
        event_ids: ids
      });
      updateActivePredictionWorkspace({ selectedPredictionId: ticket?.id || null });
      setPredictionNote("");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل إنشاء تذكرة التوقع.");
    } finally {
      setCreatingPrediction(false);
    }
  }

  async function pushPredictionUpdate(ticketId) {
    if (!ticketId || updatingPrediction) return;
    setUpdatingPrediction(true);
    try {
      const prefix = activePredictionWorkspace
        ? `Update (${activePredictionWorkspace.label} | ${activePredictionWorkspace.country || "N/A"} | ${
            activePredictionWorkspace.topic || "N/A"
          }): `
        : "";
      await apiPost(`/ai/predictions/${ticketId}/update`, {
        note: `${prefix}${predictionNote.trim()}`.trim(),
        event_ids: v2SelectedEventIds
      });
      setPredictionNote("");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تحديث التوقع.");
    } finally {
      setUpdatingPrediction(false);
    }
  }

  async function setPredictionOutcome(ticketId, outcome) {
    if (!ticketId || updatingPrediction) return;
    setUpdatingPrediction(true);
    try {
      await apiPost(`/ai/predictions/${ticketId}/outcome`, {
        outcome,
        note: predictionNote.trim(),
        status: "resolved"
      });
      setPredictionNote("");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تحديث نتيجة التوقع.");
    } finally {
      setUpdatingPrediction(false);
    }
  }

  async function deletePredictionTicket(ticketId) {
    if (!ticketId) return;
    setDeletingPredictionId(ticketId);
    try {
      await apiDelete(`/ai/predictions/${ticketId}`);
      if (selectedPredictionTicket?.id === ticketId) {
        updateActivePredictionWorkspace({ selectedPredictionId: null });
        setPredictionUpdates([]);
      }
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل حذف التذكرة.");
    } finally {
      setDeletingPredictionId(null);
    }
  }

  async function clearScopedPredictionTickets() {
    if (filteredPredictionTickets.length === 0 || clearingPredictionTickets) return;
    const ok = window.confirm(`سيتم حذف ${filteredPredictionTickets.length} تذكرة من السجل الحالي. هل تريد المتابعة؟`);
    if (!ok) return;
    setClearingPredictionTickets(true);
    try {
      for (const ticket of filteredPredictionTickets) {
        // eslint-disable-next-line no-await-in-loop
        await apiDelete(`/ai/predictions/${ticket.id}`);
      }
      updateActivePredictionWorkspace({ selectedPredictionId: null });
      setPredictionUpdates([]);
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل مسح سجل التذاكر.");
    } finally {
      setClearingPredictionTickets(false);
    }
  }

  async function triggerIngestion() {
    setIngestionRunning(true);
    try {
      await apiPost("/ingest/run?force=true");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تشغيل السحب.");
    } finally {
      setIngestionRunning(false);
    }
  }

  async function addSource(event) {
    event.preventDefault();
    try {
      await apiPost("/sources", { ...sourceForm, parser_hint: sourceForm.parser_hint || null });
      setSourceForm(initialSourceForm);
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل إضافة المصدر.");
    }
  }

  async function addPresetSource(preset) {
    try {
      await apiPost("/sources", preset);
      await loadAll();
    } catch {
      // ignore duplicates
    }
  }

  async function addPublisherPack() {
    for (const preset of presetSources) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await apiPost("/sources", preset);
      } catch {
        // ignore duplicates
      }
    }
    await loadAll();
  }

  async function toggleSource(sourceId, enabled) {
    try {
      await apiPatch(`/sources/${sourceId}/toggle`, { enabled: !enabled });
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تحديث المصدر.");
    }
  }

  async function acknowledgeAlert(alertId) {
    try {
      await apiPost(`/alerts/${alertId}/ack`);
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تعليم التنبيه كمقروء.");
    }
  }

  async function askAiQuick() {
    if (submittingChat) return;
    if (workingEventIds.length === 0) {
      setError("لا توجد أحداث ضمن الفلتر الحالي للتحليل.");
      return;
    }
    setSubmittingChat(true);
    try {
      const response = await apiPost("/ai/chat", {
        message:
          selectedContextEventIds.length > 0
            ? `حلل العناصر المحددة (${selectedContextEventIds.length}) مع توصيات قرار.`
            : activeEvent
              ? `حلل الحدث التالي بشكل متعمق: ${activeEvent.title}`
              : "حلل الوضع العام.",
        event_ids: workingEventIds
      });
      if (response?.message?.content) {
        setContentModal({
          title: "نتيجة التحليل السريع",
          content: response.message.content,
          createdAt: response.message.created_at
        });
      }
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل التحليل السريع.");
    } finally {
      setSubmittingChat(false);
    }
  }

  async function submitChat(event) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || submittingChat) return;
    setSubmittingChat(true);
    try {
      const response = await apiPost("/ai/chat", { message, event_ids: chatEventIds });
      if (response?.message?.content) {
        setContentModal({
          title: "رد المساعد",
          content: response.message.content,
          createdAt: response.message.created_at
        });
      }
      setChatInput("");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل إرسال الرسالة.");
    } finally {
      setSubmittingChat(false);
    }
  }

  async function clearChatHistory() {
    if (clearingChat) return;
    setClearingChat(true);
    try {
      await apiDelete("/ai/messages");
      setChatMessages([]);
    } catch (err) {
      setError(err.message || "فشل مسح سجل المحادثة.");
    } finally {
      setClearingChat(false);
    }
  }

  async function clearOneChatMessage(messageId) {
    if (!messageId || deletingChatId) return;
    setDeletingChatId(messageId);
    try {
      await apiDelete(`/ai/messages/${messageId}`);
      setChatMessages((prev) => prev.filter((row) => row.id !== messageId));
    } catch (err) {
      setError(err.message || "فشل حذف الرسالة.");
    } finally {
      setDeletingChatId(null);
    }
  }

  async function createInsight(event) {
    event.preventDefault();
    const prompt = analysisPrompt.trim();
    if (!prompt || submittingInsight) return;
    if (analysisEventIds.length === 0) {
      setError("لا توجد أحداث ضمن النطاق الحالي لإنشاء التحليل.");
      return;
    }
    setSubmittingInsight(true);
    try {
      const insight = await apiPost("/ai/insights", {
        title: analysisTitle.trim() || "تحليل تشغيلي",
        prompt,
        event_ids: analysisEventIds
      });
      setContentModal({
        title: insight?.title || "تحليل",
        content: insight?.content || "لا توجد بيانات.",
        createdAt: insight?.created_at || null
      });
      setAnalysisPrompt("");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل إنشاء التحليل.");
    } finally {
      setSubmittingInsight(false);
    }
  }

  async function clearInsights() {
    if (clearingInsights) return;
    setClearingInsights(true);
    try {
      await apiDelete("/ai/insights");
      setInsights([]);
      setAnalysisPrompt("");
    } catch (err) {
      setError(err.message || "فشل مسح التحليلات.");
    } finally {
      setClearingInsights(false);
    }
  }

  async function analyzeCurrentResults() {
    if (submittingInsight) return;
    if (analysisEventIds.length === 0) {
      setError("لا توجد أحداث ضمن الفلتر الحالي لتحليلها.");
      return;
    }
    setSubmittingInsight(true);
    try {
      const insight = await apiPost("/ai/insights", {
        title: query ? `تحليل: ${normalizeLegacyText(query)}` : "تحليل شامل",
        prompt: query
          ? `حلل نتائج ${normalizeLegacyText(query)} مع أهم المخاطر والسيناريوهات.`
          : "حلل آخر أحداث الخليج وخيارات القرار.",
        event_ids: analysisEventIds
      });
      setContentModal({
        title: insight?.title || "تحليل ذكي",
        content: insight?.content || "لا توجد بيانات.",
        createdAt: insight?.created_at || null
      });
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تحليل النتائج.");
    } finally {
      setSubmittingInsight(false);
    }
  }

  async function publishReportFromInsight(insightId, title) {
    if (publishingReport) return;
    setPublishingReport(true);
    try {
      const report = await apiPost("/ai/reports/publish", { insight_id: insightId, title });
      setReports((prev) =>
        [report, ...prev.filter((x) => x.report_id !== report.report_id)]
          .filter((row) => !isLegacyHistoryRow(row))
          .sort(byCreatedAtDesc)
      );
      setContentModal({
        title: report?.title || "تقرير",
        content: report?.content || "لا يوجد محتوى.",
        createdAt: report?.created_at || null
      });
      await downloadReport(report.report_id);
    } catch (err) {
      setError(err.message || "فشل نشر التقرير.");
    } finally {
      setPublishingReport(false);
    }
  }

  async function publishFromCurrentFilter() {
    if (publishingReport) return;
    if (analysisEventIds.length === 0) {
      setError("لا توجد أحداث ضمن الفلتر الحالي لنشر تقرير عنها.");
      return;
    }
    setPublishingReport(true);
    try {
      const report = await apiPost("/ai/reports/publish", {
        title: query ? `تقرير ${normalizeLegacyText(query)}` : "تقرير الحالة العامة",
        prompt: query ? `أنشئ تقريراً تنفيذياً عن ${normalizeLegacyText(query)}.` : "أنشئ تقرير الحالة العامة مع توصيات.",
        event_ids: analysisEventIds
      });
      setReports((prev) =>
        [report, ...prev.filter((x) => x.report_id !== report.report_id)]
          .filter((row) => !isLegacyHistoryRow(row))
          .sort(byCreatedAtDesc)
      );
      setContentModal({
        title: report?.title || "تقرير",
        content: report?.content || "لا يوجد محتوى.",
        createdAt: report?.created_at || null
      });
      await downloadReport(report.report_id);
    } catch (err) {
      setError(err.message || "فشل نشر التقرير.");
    } finally {
      setPublishingReport(false);
    }
  }

  async function downloadReport(reportId) {
    try {
      const { blob, filename } = await apiDownload(`/ai/reports/${reportId}/download`);
      downloadBlob(filename || `${reportId}.pdf`, blob);
    } catch (err) {
      setError(err.message || "فشل تنزيل التقرير.");
    }
  }

  return (
    <div className="page-shell" dir="rtl" lang="ar">
      <header className="hero">
        <div>
          <p className="eyebrow">Regional Monitoring Stack</p>
          <h1>منصة باحث</h1>
        </div>
        <div className="hero-actions">
          <button className="openai-status openai-status-btn" type="button" onClick={triggerIngestion} title="اضغط لتشغيل السحب الفوري">
            <span className={`status-dot ${liveIngestionConnected ? "online" : "offline"}`} />
            <strong>السحب المباشر</strong>
            <small>{liveIngestionConnected ? "Live" : "Stopped"}</small>
          </button>
          <div className="openai-status" title={aiStatus.message}>
            <span className={`status-dot ${openAiConnected ? "online" : "offline"}`} />
            <strong>OpenAI</strong>
            <small>{openAiConnected ? "Connected" : "Disconnected"}</small>
          </div>
          <span className="sync">آخر مزامنة: {formatTime(lastSync)}</span>
        </div>
      </header>

      {liveNotices.length > 0 ? (
        <section className="live-notices">
          {liveNotices.map((item) => (
            <article key={item.id} className="live-notice-item">
              {item.message}
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel version-switch">
        <div className="version-switch-head">
          <h2>وضع المنصة</h2>
        </div>
        <div className="version-tabs">
          <button className={`tab-btn ${versionTab === "v1" ? "active" : ""}`} type="button" onClick={() => setVersionTab("v1")}>
            اخر الاخبار
          </button>
          <button className={`tab-btn ${versionTab === "v2" ? "active" : ""}`} type="button" onClick={() => setVersionTab("v2")}>
            خلية الذكاء الاصطناعي
          </button>
        </div>
      </section>

      {versionTab === "v1" ? (
        <>
      {error ? <div className="error-banner">{error}</div> : null}

        <section className="broadcast-scene">
          <article className="panel live-video-panel">
            <div className="video-wall">
              <div className="video-main">
                <iframe
                  title="sky-news-live"
                  src={forceUnmutedEmbedUrl(activeVideoSource?.embedUrl)}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
                <div className="video-live-badge">مباشر</div>
              </div>
              <div className="video-source-tabs">
                {skyVideoSources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className={`video-source-btn ${selectedVideoSourceId === source.id ? "active" : ""}`}
                    onClick={() => setSelectedVideoSourceId(source.id)}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
          </div>

            <div className="video-open-link">
              <a className="btn btn-small btn-ghost source-link-btn" href={activeVideoSource?.watchUrl} target="_blank" rel="noreferrer">
                فتح البث المباشر من المصدر
              </a>
            </div>
          </article>

      </section>

      <section className="filter-strip panel">
        <div className="filter-grid">
          <label>
            بحث موضوعي
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="اكتب الموضوع وسيبحث في كل المصادر تلقائياً"
            />
          </label>
          <label>
            نوع المعلومة
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
              {sourceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            شدة الحدث
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              {severityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            مصادر محددة (اختياري)
            <select className="multi-source-select" multiple size={4} value={selectedSourceNames} onChange={changeSelectedSources}>
              {availableSourceChoices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={trustedOnly} onChange={(event) => setTrustedOnly(event.target.checked)} />
            مصادر موثوقة فقط
          </label>
          <label className="checkbox-line">
            <input type="checkbox" checked={includePeople} onChange={(event) => setIncludePeople(event.target.checked)} />
            تضمين السوشال
          </label>
        </div>
        <div className="quick-topics">
          <button className="btn btn-ghost" type="button" onClick={() => setSourceDrawerOpen((prev) => !prev)}>
            {sourceDrawerOpen ? "إخفاء المصادر" : "المصادر والربط"}
          </button>
          <button className="btn btn-small" type="button" onClick={() => setQuery("حرب")}>
            تركيز الحرب
          </button>
          <button className="btn btn-small" type="button" onClick={() => setQuery("cyber")}>
            تركيز سيبراني
          </button>
          <button className="btn btn-small" type="button" onClick={() => setQuery("flight")}>
            تركيز طيران
          </button>
          <button className="btn btn-small" type="button" onClick={() => setQuery("marine")}>
            تركيز ملاحي
          </button>
          <button className="btn btn-small" type="button" onClick={() => setQuery("")}>
            مسح
          </button>
          <button className="btn btn-small" type="button" onClick={() => setSelectedSourceNames([])}>
            كل المصادر
          </button>
          <button className="btn btn-accent" type="button" onClick={analyzeCurrentResults} disabled={submittingInsight}>
            {submittingInsight ? "جارٍ التحليل..." : analysisSelectionCount > 0 ? `تحليل ذكي (${analysisSelectionCount})` : "تحليل ذكي (عام)"}
          </button>
          <button className="btn btn-small btn-danger" type="button" onClick={clearInsights} disabled={clearingInsights}>
            {clearingInsights ? "جارٍ المسح..." : "مسح التحليل"}
          </button>
          <button className="btn btn-ghost" type="button" onClick={publishFromCurrentFilter} disabled={publishingReport}>
            نشر تقرير
          </button>
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat-card">
          <h3>الأحداث</h3>
          <p>{stats.totalEvents}</p>
          <small>إجمالي الأحداث المطابقة للفلتر الحالي.</small>
        </article>
        <article className="stat-card">
          <h3>عالية الشدة</h3>
          <p>{stats.highSeverity}</p>
          <small>S4 = عالي (عاجل) | S5 = حرج جدا.</small>
        </article>
        <article className="stat-card">
          <h3>تنبيهات مفتوحة</h3>
          <p>{stats.openAlerts}</p>
          <small>تنبيهات غير مقروءة تحتاج متابعة.</small>
        </article>
        <article className="stat-card">
          <h3>مصادر مفعلة</h3>
          <p>{stats.enabledSources}</p>
          <small>عدد المصادر المفعلة للسحب الآن.</small>
        </article>
        <article className="stat-card">
          <h3>إشارات الناس</h3>
          <p>{stats.socialCount}</p>
          <small>{socialEnabledSources > 0 ? "إشارات السوشال ضمن الفلتر الحالي." : "فعّل مصدر سوشال لظهور هذا المؤشر."}</small>
        </article>
      </section>

      {sourceDrawerOpen ? (
        <section className="panel source-drawer">
          <div className="panel-head">
            <h2>إدارة المصادر</h2>
            <span>{sources.length} مصدر</span>
          </div>
          <div className="quick-topics">
            <button className="btn btn-accent" type="button" onClick={addPublisherPack}>
              إضافة باقة المصادر الموثوقة
            </button>
            {presetSources.map((preset) => (
              <button key={preset.name} className="btn btn-small" type="button" onClick={() => addPresetSource(preset)}>
                {preset.name}
              </button>
            ))}
          </div>
          <div className="source-list drawer-list">
            {sources.map((source) => (
              <article className="source-item" key={source.id}>
                <div>
                  <h3>{source.name}</h3>
                  <p>
                    {sourceTypeLabel(source.source_type)} | {source.endpoint}
                  </p>
                  <small>
                    Polling: {source.poll_interval_seconds}s | parser: {source.parser_hint || "auto"}
                  </small>
                </div>
                <button className="btn btn-small" type="button" onClick={() => toggleSource(source.id, source.enabled)}>
                  {source.enabled ? "تعطيل" : "تفعيل"}
                </button>
              </article>
            ))}
          </div>
          <form className="source-form" onSubmit={addSource}>
            <h3>إضافة مصدر جديد</h3>
            <label>
              الاسم
              <input value={sourceForm.name} onChange={(e) => setSourceForm((p) => ({ ...p, name: e.target.value }))} required />
            </label>
            <label>
              النوع
              <select value={sourceForm.source_type} onChange={(e) => setSourceForm((p) => ({ ...p, source_type: e.target.value }))}>
                {sourceTypeOptions
                  .filter((opt) => opt.value !== "all")
                  .map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              الرابط
              <input
                type="url"
                value={sourceForm.endpoint}
                onChange={(e) => setSourceForm((p) => ({ ...p, endpoint: e.target.value }))}
                required
              />
            </label>
            <label>
              parser_hint
              <input value={sourceForm.parser_hint} onChange={(e) => setSourceForm((p) => ({ ...p, parser_hint: e.target.value }))} />
            </label>
            <button className="btn btn-accent" type="submit">
              حفظ المصدر
            </button>
          </form>
        </section>
      ) : null}

      <main className="workspace-grid">
        <aside className="panel left-rail">
          <div className="list-tabs">
            <button className={`tab-btn ${leftTab === "feed" ? "active" : ""}`} type="button" onClick={() => setLeftTab("feed")}>
              التدفق الحي ({filteredEvents.length})
            </button>
            <button
              className={`tab-btn ${leftTab === "alerts" ? "active" : ""}`}
              type="button"
              onClick={() => setLeftTab("alerts")}
            >
              التنبيهات ({alerts.length})
            </button>
          </div>
          <div className="selection-strip">
            <span>
              المحدد للتحليل: أحداث {selectedEventIds.length} | تنبيهات {selectedAlertIds.length}
            </span>
            <button className="btn btn-small" type="button" onClick={clearSelections} disabled={totalSelectedCount === 0}>
              إلغاء تحديد الكل
            </button>
          </div>

          {leftTab === "feed" ? (
            <>
              <div className="live-feed-severity-strip">
                <span>فلتر التدفق الحي:</span>
                <button className={`btn btn-small ${severityFilter === "all" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("all")}>
                  الكل
                </button>
                <button className={`btn btn-small ${severityFilter === "5" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("5")}>
                  S5
                </button>
                <button className={`btn btn-small ${severityFilter === "4" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("4")}>
                  S4
                </button>
                <button className={`btn btn-small ${severityFilter === "3" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("3")}>
                  S3
                </button>
                <button className={`btn btn-small ${severityFilter === "2" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("2")}>
                  S2
                </button>
                <button className={`btn btn-small ${severityFilter === "1" ? "active" : ""}`} type="button" onClick={() => setSeverityFilter("1")}>
                  S1
                </button>
              </div>
              {feedTotalPages > 1 ? (
                <div className="list-pagination top">
                  <div className="pagination-meta">
                    عرض {feedRange.from}-{feedRange.to} من {sortedFilteredEvents.length}
                  </div>
                  <button className="btn btn-small" type="button" onClick={() => setFeedPage((p) => Math.max(1, p - 1))} disabled={feedPage <= 1}>
                    السابق
                  </button>
                  <div className="page-numbers">
                    {feedPageNumbers.map((page) => (
                      <button
                        key={`feed-page-top-${page}`}
                        className={`btn btn-small page-btn ${feedPage === page ? "active" : ""}`}
                        type="button"
                        onClick={() => setFeedPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <div className="page-picker">
                    <label>
                      صفحة
                      <select value={feedPage} onChange={(event) => setFeedPage(Number(event.target.value))}>
                        {Array.from({ length: feedTotalPages }, (_, index) => index + 1).map((page) => (
                          <option key={`feed-opt-top-${page}`} value={page}>
                            {page}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="btn btn-small"
                    type="button"
                    onClick={() => setFeedPage((p) => Math.min(feedTotalPages, p + 1))}
                    disabled={feedPage >= feedTotalPages}
                  >
                    التالي
                  </button>
                </div>
              ) : null}
              <div className="timeline-list">
                {loading ? <p>جارٍ التحميل...</p> : null}
                {!loading && sortedFilteredEvents.length === 0 ? <p>لا توجد نتائج حسب الفلتر الحالي.</p> : null}
                {visibleFeedEvents.map((eventItem) => (
                  <article
                    className={`event-item ${focusedEventId === eventItem.id ? "focused" : ""} ${
                      selectedEventIds.includes(eventItem.id) ? "selected" : ""
                    } ${isUnseenEvent(eventItem) ? "is-new" : ""}`}
                    key={eventItem.id}
                    onMouseEnter={() => setSeenEventIds((prev) => (prev.includes(eventItem.id) ? prev : [...prev, eventItem.id]))}
                    onClick={() => openEventPopup(eventItem.id)}
                  >
                    <div className="event-top">
                      <span className={`severity severity-${eventItem.severity}`} title={severityMeaning(eventItem.severity)}>
                        S{eventItem.severity}
                      </span>
                      <span className="severity-meaning">{severityMeaning(eventItem.severity)}</span>
                      <span className="source">{sourceTypeLabel(eventItem.source_type)}</span>
                      {isUnseenEvent(eventItem) ? <span className="new-flag">جديد</span> : null}
                      {isTrustedEvent(eventItem) ? <span className="trusted-tag">موثوق</span> : null}
                      <label className="select-line inline" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedEventIds.includes(eventItem.id)} onChange={() => toggleSelected(eventItem.id)} />
                        تحديد
                      </label>
                    </div>
                    <h3>{displayText(eventItem.title)}</h3>
                    <p>{displayText(eventItem.summary || eventItem.ai_assessment || eventItem.details || "بدون ملخص.").slice(0, 150)}</p>
                    <div className="event-meta">
                      <span>{displayText(eventItem.source_name)}</span>
                      <time>{formatTime(eventDisplayTime(eventItem))}</time>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <>
              {alertsTotalPages > 1 ? (
                <div className="list-pagination top">
                  <div className="pagination-meta">
                    عرض {alertsRange.from}-{alertsRange.to} من {sortedAlerts.length}
                  </div>
                  <button className="btn btn-small" type="button" onClick={() => setAlertsPage((p) => Math.max(1, p - 1))} disabled={alertsPage <= 1}>
                    السابق
                  </button>
                  <div className="page-numbers">
                    {alertsPageNumbers.map((page) => (
                      <button
                        key={`alerts-page-top-${page}`}
                        className={`btn btn-small page-btn ${alertsPage === page ? "active" : ""}`}
                        type="button"
                        onClick={() => setAlertsPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <div className="page-picker">
                    <label>
                      صفحة
                      <select value={alertsPage} onChange={(event) => setAlertsPage(Number(event.target.value))}>
                        {Array.from({ length: alertsTotalPages }, (_, index) => index + 1).map((page) => (
                          <option key={`alerts-opt-top-${page}`} value={page}>
                            {page}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    className="btn btn-small"
                    type="button"
                    onClick={() => setAlertsPage((p) => Math.min(alertsTotalPages, p + 1))}
                    disabled={alertsPage >= alertsTotalPages}
                  >
                    التالي
                  </button>
                </div>
              ) : null}
              <div className="alert-list">
                {sortedAlerts.length === 0 ? <p>لا توجد تنبيهات.</p> : null}
                {visibleAlerts.map((alert) => (
                  <article
                    className={`alert-item ${alert.level} ${alert.acknowledged ? "acknowledged" : ""} ${
                      focusedAlertId === alert.id ? "focused" : ""
                    }`}
                    key={alert.id}
                  >
                    <div className="event-top">
                      <label className="select-line inline" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedAlertIds.includes(alert.id)} onChange={() => toggleAlertSelected(alert.id)} />
                        تحديد
                      </label>
                    </div>
                    <button
                      type="button"
                      className="alert-title-btn"
                      onClick={() => {
                        setFocusedAlertId(alert.id);
                        setLeftTab("alerts");
                        focusEvent(alert.event_id, { alertId: alert.id });
                      }}
                    >
                      <strong>{displayText(alert.title)}</strong>
                    </button>
                    <p>{displayText(alert.details).slice(0, 170)}</p>
                    <div className="event-meta">
                      <span>
                        {alert.level.toUpperCase()} | {alert.acknowledged ? "مقروء" : "غير مقروء"}
                      </span>
                      <time>{formatTime(alert.created_at)}</time>
                    </div>
                    <div className="quick-topics">
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={() => {
                          setLeftTab("feed");
                          setFocusedAlertId(alert.id);
                          if (!selectedAlertIds.includes(alert.id)) {
                            setSelectedAlertIds((prev) => [...prev, alert.id]);
                          }
                          openEventPopup(alert.event_id, { alertId: alert.id, keepAlert: true });
                        }}
                      >
                        فتح الحدث
                      </button>
                      <button className="btn btn-small" type="button" onClick={() => acknowledgeAlert(alert.id)} disabled={alert.acknowledged}>
                        {alert.acknowledged ? "مقروء" : "تعليم كمقروء"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </aside>

        <section className="right-workspace">
          <article className="panel detail-panel-large">
            <div className="panel-head">
              <h2>تفاصيل الحدث</h2>
              <span>{activeEvent ? `#${activeEvent.id}` : "لا يوجد"}</span>
            </div>
            {!activeEvent ? (
              <p>اختر حدثًا من القائمة اليسرى لعرض التفاصيل الكاملة هنا.</p>
            ) : (
              <div className="detail-layout">
                <section className="detail-body">
                  <h3>{displayText(activeEvent.title)}</h3>
                  <p className="details-meta">
                    {sourceTypeLabel(activeEvent.source_type)} | {formatTime(eventDisplayTime(activeEvent))} | الشدة S{activeEvent.severity} ({severityMeaning(activeEvent.severity)})
                  </p>
                  {activeAlert ? (
                    <div className="linked-alert">
                      <strong>تنبيه مرتبط:</strong> {displayText(activeAlert.title)}
                    </div>
                  ) : null}
                  <div className="quick-topics detail-actions">
                    <button className="btn btn-small" type="button" onClick={() => toggleSelected(activeEvent.id)}>
                      {selectedEventIds.includes(activeEvent.id) ? "إلغاء تحديد الحدث" : "تحديد الحدث للتحليل"}
                    </button>
                    <button className="btn btn-accent" type="button" onClick={askAiQuick} disabled={submittingChat}>
                      اسأل الذكاء عن هذا السياق
                    </button>
                    {activeEvent.url ? (
                      <a className="btn btn-ghost source-link-btn" href={activeEvent.url} target="_blank" rel="noreferrer">
                        فتح المصدر
                      </a>
                    ) : null}
                  </div>
                  <div className="detail-sections">
                    <article className="detail-block">
                      <h4>الملخص</h4>
                      <p>{displayText(activeEvent.summary) || "لا يوجد ملخص."}</p>
                    </article>
                    <article className="detail-block">
                      <h4>تقييم الذكاء</h4>
                      <p>{displayText(activeEvent.ai_assessment) || "لا يوجد تقييم إضافي."}</p>
                    </article>
                    <article className="detail-block">
                      <h4>تفاصيل المصدر</h4>
                      <p>{displayText(summarizeSourceDetails(activeEvent)) || "لا توجد تفاصيل إضافية."}</p>
                    </article>
                  </div>
                  <div className="facts-grid">
                    {facts.map(([k, v], idx) => (
                      <span className="fact-pill" key={`${k}-${idx}`}>
                        <strong>{k}:</strong> {v}
                      </span>
                    ))}
                  </div>
                </section>
                <section className="map-card">
                  <h4>الخريطة التفاعلية</h4>
                  {mapEvent ? (
                    <>
                      <iframe title="event-map" src={mapEmbedUrl(mapEvent.latitude, mapEvent.longitude)} loading="lazy" />
                      <p>
                        {mapEvent.location || "موقع الحدث"} | {mapEvent.latitude}, {mapEvent.longitude}
                      </p>
                    </>
                  ) : (
                    <p>لا توجد إحداثيات لهذا الحدث.</p>
                  )}
                </section>
              </div>
            )}
          </article>

          <div className="workspace-bottom">
            <article className="panel dashboard-panel">
              <div className="panel-head">
                <h2>لوحة المؤشرات</h2>
                <span>مبنية على الفلتر الحالي</span>
              </div>
              <div className="chart-grid">
                <section className="chart-box">
                  <h4>توزيع حسب النوع</h4>
                  {Object.entries(sourceCounts).map(([key, value]) => {
                    const max = Math.max(...Object.values(sourceCounts), 1);
                    const width = `${(value / max) * 100}%`;
                    return (
                      <div className="bar-row" key={key}>
                        <span>{sourceTypeLabel(key)}</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width }} />
                        </div>
                        <strong>{value}</strong>
                      </div>
                    );
                  })}
                </section>

                <section className="chart-box">
                  <h4>مستوى الخبر</h4>
                  {[1, 2, 3, 4, 5].map((level) => {
                    const max = Math.max(...Object.values(severityCounts), 1);
                    const width = `${(severityCounts[level] / max) * 100}%`;
                    return (
                      <div className="bar-row" key={level}>
                        <span>{severityMeaning(level)} (S{level})</span>
                        <div className="bar-track">
                          <div className="bar-fill" style={{ width }} />
                        </div>
                        <strong>{severityCounts[level]}</strong>
                      </div>
                    );
                  })}
                </section>
              </div>

              <section className="trend-box">
                <h4>اتجاه آخر 24 ساعة</h4>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <polyline points={trend.points} />
                </svg>
                <div className="trend-labels">
                  <span>-24h</span>
                  <span>-18h</span>
                  <span>-12h</span>
                  <span>-6h</span>
                  <span>الآن</span>
                </div>
                <small className="trend-caption">يمثل عدد الأحداث في كل 3 ساعات خلال آخر 24 ساعة.</small>
              </section>
            </article>

            <article className="panel ai-panel">
              <div className="panel-head">
                <h2>منصة الذكاء</h2>
                <div className="chat-head-actions">
                  <span>
                    {selectedContextEventIds.length > 0 ? `${selectedContextEventIds.length} محدد للتحليل` : "وضع عام"}
                  </span>
                </div>
              </div>
              <div className="ai-tabs">
                <button className={`tab-btn ${aiTab === "chat" ? "active" : ""}`} type="button" onClick={() => setAiTab("chat")}>
                  المحادثة
                </button>
                <button className={`tab-btn ${aiTab === "analysis" ? "active" : ""}`} type="button" onClick={() => setAiTab("analysis")}>
                  التحليل والتقارير
                </button>
              </div>

              {aiTab === "chat" ? (
                <div className="ai-tab-scroll">
                  <div className="quick-topics ai-pane-tools">
                    <button className="btn btn-small btn-danger clear-action-btn" type="button" onClick={clearChatHistory} disabled={clearingChat}>
                      {clearingChat ? "جارٍ المسح..." : "مسح كل المحادثة"}
                    </button>
                  </div>

                  <div className="chat-list">
                    {chatMessages.length === 0 ? <p>اسأل عن حدث محدد أو الحالة العامة.</p> : null}
                    {chatMessages.map((msg) => (
                      <article className={`chat-item ${msg.role}`} key={msg.id}>
                        <div className="chat-item-actions">
                          <strong>{msg.role === "user" ? "أنت" : "المساعد"}</strong>
                          <div className="chat-item-btns">
                            <button
                              className="btn btn-small"
                              type="button"
                              onClick={() =>
                                setContentModal({
                                  title: msg.role === "user" ? "سؤالك" : "رد المساعد",
                                  content: msg.content,
                                  createdAt: msg.created_at
                                })
                              }
                            >
                              قراءة
                            </button>
                            <button
                              className="chat-delete-btn"
                              type="button"
                              onClick={() => clearOneChatMessage(msg.id)}
                              disabled={deletingChatId === msg.id}
                            >
                              {deletingChatId === msg.id ? "..." : "حذف"}
                            </button>
                          </div>
                        </div>
                        <p>{msg.content}</p>
                        <small>{formatTime(msg.created_at)}</small>
                      </article>
                    ))}
                  </div>

                  <form className="chat-form" onSubmit={submitChat}>
                    <textarea
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="مثال: ما السيناريو المرجح خلال 48 ساعة؟"
                      rows={3}
                    />
                    <button className="btn btn-accent" type="submit" disabled={submittingChat}>
                      {submittingChat ? "جارٍ الإرسال..." : "إرسال سؤال"}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="ai-tab-scroll">
                  <div className="quick-topics ai-pane-tools">
                    <button className="btn btn-small btn-danger clear-action-btn" type="button" onClick={clearInsights} disabled={clearingInsights}>
                      {clearingInsights ? "جارٍ المسح..." : "مسح سجل التحليل"}
                    </button>
                  </div>

                  <form className="source-form" onSubmit={createInsight}>
                    <label>
                      عنوان التحليل
                      <input value={analysisTitle} onChange={(event) => setAnalysisTitle(event.target.value)} />
                    </label>
                    <label>
                      طلب التحليل
                      <textarea
                        value={analysisPrompt}
                        onChange={(event) => setAnalysisPrompt(event.target.value)}
                        placeholder="مثال: حلل أثر التصعيد على الملاحة والطيران."
                        rows={3}
                      />
                    </label>
                    <button className="btn btn-accent" type="submit" disabled={submittingInsight}>
                      {submittingInsight ? "جارٍ الإنشاء..." : "إنشاء تحليل"}
                    </button>
                  </form>

                  <div className="insight-list">
                    {visibleInsights.map((insight) => (
                      <article className="insight-item" key={insight.id}>
                        <h3>{displayText(insight.title)}</h3>
                        <p>{displayText(insight.content).slice(0, 700)}</p>
                        <div className="quick-topics">
                          <button
                            className="btn btn-small"
                            type="button"
                            onClick={() =>
                              setContentModal({
                                title: displayText(insight.title),
                                content: displayText(insight.content),
                                createdAt: insight.created_at
                              })
                            }
                          >
                            قراءة كاملة
                          </button>
                          <button
                            className="btn btn-small"
                            type="button"
                            onClick={() => publishReportFromInsight(insight.id, insight.title)}
                            disabled={publishingReport}
                          >
                            نشر تقرير
                          </button>
                        </div>
                        <small>{formatTime(insight.created_at)}</small>
                      </article>
                    ))}
                    {visibleInsights.length === 0 ? <p>لا يوجد تحليل منشور بعد.</p> : null}
                  </div>

                  <section className="reports-block">
                    <div className="panel-head">
                      <h3>التقارير المنشورة</h3>
                      <span>{visibleReports.length} تقرير</span>
                    </div>
                    <div className="reports-list">
                      {visibleReports.map((report) => (
                        <article className="insight-item report-item" key={report.report_id}>
                          <h3>{displayText(report.title || "تقرير")}</h3>
                          <p>{displayText(report.content).slice(0, 320)}</p>
                          <div className="quick-topics">
                            <button
                              className="btn btn-small"
                              type="button"
                              onClick={() =>
                                setContentModal({
                                  title: displayText(report.title || "تقرير"),
                                  content: displayText(report.content || ""),
                                  createdAt: report.created_at
                                })
                              }
                            >
                              قراءة التقرير
                            </button>
                            <button className="btn btn-small" type="button" onClick={() => downloadReport(report.report_id)}>
                              تنزيل PDF
                            </button>
                          </div>
                          <small>
                            {formatTime(report.created_at)} | {report.report_id}
                          </small>
                        </article>
                      ))}
                      {visibleReports.length === 0 ? <p>لا يوجد تقارير منشورة بعد.</p> : null}
                    </div>
                  </section>
                </div>
              )}
            </article>
          </div>
        </section>
      </main>

        </>
      ) : (
        <section className="v2-command-center">
          <article className="panel v2-head">
            <div className="panel-head">
              <h2>مركز العمليات السردي V2</h2>
              <span>عرض مباشر: ماذا حدث | لماذا مهم | ماذا نراقب تالياً</span>
            </div>
            <div className="quick-topics">
              <button className="btn btn-accent" type="button" onClick={triggerIngestion}>
                تحديث فوري
              </button>
              <button className="btn btn-small" type="button" onClick={() => setVersionTab("v1")}>
                العودة إلى V1
              </button>
              <button className={`btn btn-small ${v2TrustedOnly ? "active" : ""}`} type="button" onClick={() => setV2TrustedOnly((prev) => !prev)}>
                {v2TrustedOnly ? "مصادر موثوقة فقط" : "كل المصادر"}
              </button>
              <button className={`btn btn-small ${v2UnreadOnly ? "active" : ""}`} type="button" onClick={() => setV2UnreadOnly((prev) => !prev)}>
                {v2UnreadOnly ? "إظهار الكل" : "غير المقروء فقط"}
              </button>
              <button className="btn btn-small btn-accent" type="button" onClick={analyzeV2Selected} disabled={submittingInsight}>
                {submittingInsight ? "جارٍ التحليل..." : `تحليل المحدد في V2 (${v2SelectedEventIds.length})`}
              </button>
            </div>
            <div className="v2-lanes">
              <button className={`btn btn-small lane-btn ${v2Lane === "all" ? "active" : ""}`} type="button" onClick={() => setV2Lane("all")}>
                كل المسارات ({v2LaneStats.all?.total || 0})
                {v2LaneStats.all?.newCount > 0 ? <span className="lane-pulse-dot" /> : null}
              </button>
              <button className={`btn btn-small lane-btn ${v2Lane === "geo" ? "active" : ""}`} type="button" onClick={() => setV2Lane("geo")}>
                جيوسياسي ({v2LaneStats.geo?.total || 0})
                {v2LaneStats.geo?.newCount > 0 ? <span className="lane-pulse-dot" /> : null}
              </button>
              <button className={`btn btn-small lane-btn ${v2Lane === "cyber" ? "active" : ""}`} type="button" onClick={() => setV2Lane("cyber")}>
                سيبراني ({v2LaneStats.cyber?.total || 0})
                {v2LaneStats.cyber?.newCount > 0 ? <span className="lane-pulse-dot" /> : null}
              </button>
              <button className={`btn btn-small lane-btn ${v2Lane === "marine" ? "active" : ""}`} type="button" onClick={() => setV2Lane("marine")}>
                ملاحي ({v2LaneStats.marine?.total || 0})
                {v2LaneStats.marine?.newCount > 0 ? <span className="lane-pulse-dot" /> : null}
              </button>
              <button className={`btn btn-small lane-btn ${v2Lane === "air" ? "active" : ""}`} type="button" onClick={() => setV2Lane("air")}>
                جوي ({v2LaneStats.air?.total || 0})
                {v2LaneStats.air?.newCount > 0 ? <span className="lane-pulse-dot" /> : null}
              </button>
            </div>
          </article>

          <section className="v2-grid">
            <article className="panel v2-narrative">
              <h3>القصة الحية</h3>
              <p>
                <strong>ماذا حدث:</strong> {v2Narrative.happened}
              </p>
              <p>
                <strong>لماذا مهم:</strong> {v2Narrative.why}
              </p>
              <p>
                <strong>ماذا نراقب تالياً:</strong> {v2Narrative.next}
              </p>
            </article>

            <article className="panel v2-freshness">
              <h3>رادار الحداثة</h3>
              <div className="v2-freshness-chips">
                <span className="fresh-chip live">Live {v2Freshness.live}</span>
                <span className="fresh-chip ten">10m {v2Freshness.ten}</span>
                <span className="fresh-chip hour">1h {v2Freshness.oneHour}</span>
                <span className="fresh-chip three">3h {v2Freshness.threeHours}</span>
                <span className="fresh-chip stale">3h+ {v2Freshness.stale}</span>
              </div>
              <small>كل بطاقة تبيّن عمر الخبر الفعلي لحظة العرض.</small>
            </article>

            <article ref={v2FocusPanelRef} id="v2-focus-panel" className={`panel v2-focus-panel ${v2FocusFlash ? "focus-flash" : ""}`}>
              <div className="panel-head">
                <h3>تركيز القصة</h3>
                <span>{v2FocusedEvent ? `S${v2FocusedEvent.severity} | ${formatRelativeTime(eventDisplayTime(v2FocusedEvent))}` : "لا يوجد"}</span>
              </div>
              {v2FocusedEvent ? (
                <>
                  <h4>{displayText(v2FocusedEvent.title)}</h4>
                  <p>{displayText(v2FocusedEvent.summary) || "لا يوجد ملخص."}</p>
                  <p className="details-meta">
                    {displayText(v2FocusedEvent.source_name)} | {formatTime(eventDisplayTime(v2FocusedEvent))}
                  </p>
                  <div className="quick-topics">
                    <button className="btn btn-small btn-ghost" type="button" onClick={() => openEventPopup(v2FocusedEvent.id, { scope: "v2" })}>
                      فتح التفاصيل
                    </button>
                    {v2FocusedEvent.url ? (
                      <a className="btn btn-small btn-ghost source-link-btn" href={v2FocusedEvent.url} target="_blank" rel="noreferrer">
                        زيارة الموقع الأصلي
                      </a>
                    ) : null}
                  </div>
                </>
              ) : (
                <p>لا توجد قصة محددة حالياً.</p>
              )}
            </article>

            <article className="panel v2-story-stream">
              <div className="panel-head">
                <h3>تدفق القصص المدمجة</h3>
                <span>{v2StoryGroups.length} قصة</span>
              </div>
              <div className="v2-story-list">
                {v2StoryGroups.length === 0 ? <p>لا توجد قصص ضمن الفلتر الحالي.</p> : null}
                {v2StoryGroups.slice(0, 18).map((group) => (
                  <article
                    key={group.key}
                    className={`v2-story-card severity-s${group.lead.severity} ${
                      !seenEventIdSet.has(group.lead.id) && minutesSince(eventDisplayTime(group.lead)) <= 10 ? "new-pulse" : ""
                    } ${v2FocusedEventId === group.lead.id ? "is-focused" : ""}`}
                    onClick={(event) => {
                      const target = event.target;
                      if (target instanceof Element && target.closest("button, a")) return;
                      focusV2Story(group.lead.id);
                    }}
                  >
                    <div className="v2-story-meta">
                      <span className="story-sev">S{group.lead.severity}</span>
                      <span className="story-fresh">{freshnessLabel(eventDisplayTime(group.lead))}</span>
                      <span className="story-time">{formatRelativeTime(eventDisplayTime(group.lead))}</span>
                    </div>
                    <h4>{displayText(group.lead.title)}</h4>
                    <p>{displayText(group.lead.summary) || "لا يوجد ملخص."}</p>
                    <div className="v2-story-footer">
                      <span>تأكيد مصادر: {group.size}</span>
                      <span>{group.sources.join(" | ")}</span>
                    </div>
                    <div className="quick-topics">
                      <label className="select-line">
                        <input
                          type="checkbox"
                          checked={v2SelectedEventIds.includes(group.lead.id)}
                          onChange={(event) => {
                            event.stopPropagation();
                            toggleV2Selected(group.lead.id);
                          }}
                        />
                        تحديد للتحليل
                      </label>
                      <button
                        className="btn btn-small"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          focusV2Story(group.lead.id);
                        }}
                      >
                        تركيز
                      </button>
                      <button
                        className="btn btn-small btn-ghost"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEventPopup(group.lead.id, { scope: "v2" });
                        }}
                      >
                        فتح التفاصيل
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </article>

            <article className="panel v2-predictions-panel">
              <div className="panel-head">
                <h3>تذاكر التوقع الذكي</h3>
                <span>
                  {filteredPredictionTickets.length} / {scopedPredictionTickets.length} تذكرة | {activePredictionWorkspace?.label || "مساحة"}
                </span>
              </div>
              <div className="v2-workspace-tabs">
                {predictionWorkspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    className={`btn btn-small v2-workspace-tab ${activePredictionWorkspace?.id === workspace.id ? "active" : ""}`}
                    onClick={() => setActivePredictionWorkspaceId(workspace.id)}
                  >
                    {workspace.label}
                  </button>
                ))}
                <button className="btn btn-small btn-accent v2-workspace-add" type="button" onClick={addPredictionWorkspace}>
                  + إضافة مساحة
                </button>
              </div>
              <div className="quick-topics v2-prediction-filters">
                <button
                  className={`btn btn-small ${activePredictionWorkspace?.predictionOpenOnly ? "active" : ""}`}
                  type="button"
                  onClick={() =>
                    updateActivePredictionWorkspace((prev) => ({
                      predictionOpenOnly: !prev.predictionOpenOnly,
                    }))
                  }
                >
                  {activePredictionWorkspace?.predictionOpenOnly ? "المفتوحة فقط" : "كل التذاكر"}
                </button>
                <label className="v2-filter-label">
                  التذاكر المستحقة خلال
                  <select
                    value={activePredictionWorkspace?.predictionDueWithinHours || 0}
                    onChange={(event) =>
                      updateActivePredictionWorkspace({
                        predictionDueWithinHours: Number(event.target.value || 0),
                      })
                    }
                  >
                    <option value={0}>الكل</option>
                    <option value={6}>6 ساعات</option>
                    <option value={12}>12 ساعة</option>
                    <option value={24}>24 ساعة</option>
                    <option value={48}>48 ساعة</option>
                    <option value={72}>72 ساعة</option>
                  </select>
                </label>
                <button className="btn btn-small btn-danger" type="button" onClick={clearActivePredictionWorkspace}>
                  مسح حقول النموذج
                </button>
                <button className="btn btn-small btn-danger" type="button" onClick={clearScopedPredictionTickets} disabled={clearingPredictionTickets}>
                  {clearingPredictionTickets ? "جارٍ مسح السجل..." : `مسح سجل التذاكر (${filteredPredictionTickets.length})`}
                </button>
              </div>
              <div className="source-form">
                <label>
                  الدولة المستهدفة
                  <input
                    value={activePredictionWorkspace?.country || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ country: event.target.value })}
                  />
                </label>
                <label>
                  الموضوع الأساسي
                  <input
                    value={activePredictionWorkspace?.topic || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ topic: event.target.value })}
                  />
                </label>
                <label>
                  عنوان التوقع
                  <input
                    value={activePredictionWorkspace?.predictionTitle || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ predictionTitle: event.target.value })}
                  />
                </label>
                <label>
                  تركيز التوقع
                  <input
                    value={activePredictionWorkspace?.predictionFocus || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ predictionFocus: event.target.value })}
                  />
                </label>
                <label>
                  طلب التوقع
                  <textarea
                    value={activePredictionWorkspace?.predictionRequest || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ predictionRequest: event.target.value })}
                    rows={3}
                  />
                </label>
                <label>
                  الأفق الزمني (ساعة)
                  <input
                    type="number"
                    min={1}
                    max={720}
                    value={activePredictionWorkspace?.predictionHorizon || 24}
                    onChange={(event) =>
                      updateActivePredictionWorkspace({
                        predictionHorizon: Number(event.target.value || 24),
                      })
                    }
                  />
                </label>
                <button className="btn btn-accent" type="button" onClick={createPredictionTicket} disabled={creatingPrediction}>
                  {creatingPrediction ? "جارٍ الإنشاء..." : "إنشاء تذكرة توقع"}
                </button>
              </div>

              <div className="v2-prediction-layout">
                <div className="v2-prediction-list">
                  {filteredPredictionTickets.map((ticket) => (
                    <article
                      key={ticket.id}
                      className={`v2-ticket-btn ${selectedPredictionTicket?.id === ticket.id ? "active" : ""}`}
                      onClick={() => updateActivePredictionWorkspace({ selectedPredictionId: ticket.id })}
                    >
                      <div className="ticket-head">
                        <strong>{displayText(ticket.title)}</strong>
                        <button
                          className="btn btn-small btn-danger ticket-delete-btn"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void deletePredictionTicket(ticket.id);
                          }}
                          disabled={deletingPredictionId === ticket.id}
                        >
                          {deletingPredictionId === ticket.id ? "..." : "حذف"}
                        </button>
                      </div>
                      <small>
                        {displayText(ticket.focus_query)} | {ticket.status} | {ticket.outcome}
                      </small>
                      <small>
                        الاستحقاق: {predictionDueAt(ticket) ? formatTime(predictionDueAt(ticket).toISOString()) : "غير متاح"}
                      </small>
                    </article>
                  ))}
                  {filteredPredictionTickets.length === 0 ? <p>لا توجد تذاكر ضمن الفلاتر الحالية.</p> : null}
                </div>

                <div className="v2-prediction-details">
                  {selectedPredictionTicket ? (
                    <>
                      <h4>{displayText(selectedPredictionTicket.title)}</h4>
                      <p className="details-meta">
                        الثقة: {Math.round((selectedPredictionTicket.confidence || 0) * 100)}% | الأفق: {selectedPredictionTicket.horizon_hours}h |
                        النتيجة: {selectedPredictionTicket.outcome}
                      </p>
                      <p className="details-meta">
                        وقت الاستحقاق:{" "}
                        {predictionDueAt(selectedPredictionTicket) ? formatTime(predictionDueAt(selectedPredictionTicket).toISOString()) : "غير متاح"}
                      </p>
                      <div className="v2-operational-grid">
                        {operationalSectionDefs.map((section) => {
                          const raw = selectedPredictionSections[section.key];
                          const bullets = toBulletLines(displayText(raw));
                          const preview = bullets.slice(0, 2).join(" - ");
                          const content = bullets.length > 0 ? bullets.map((line) => `• ${line}`).join("\n") : "غير متوفر بعد في هذه التذكرة.";
                          return (
                            <button
                              key={section.key}
                              type="button"
                              className="detail-block v2-operational-card"
                              onClick={() =>
                                setContentModal({
                                  title: section.title,
                                  content,
                                  createdAt: selectedPredictionTicket?.updated_at || selectedPredictionTicket?.created_at || null,
                                })
                              }
                            >
                              <h4>{section.title}</h4>
                              <p>{preview || "غير متوفر بعد في هذه التذكرة."}</p>
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        className="detail-block v2-click-block"
                        onClick={() =>
                          setContentModal({
                            title: "النص الكامل (منسق بالعربية)",
                            content: displayText(cleanOperationalTaggedText(selectedPredictionTicket.prediction_text)),
                            createdAt: selectedPredictionTicket?.updated_at || selectedPredictionTicket?.created_at || null,
                          })
                        }
                      >
                        <h4>النص الكامل (منسق بالعربية)</h4>
                        <p>{displayText(cleanOperationalTaggedText(selectedPredictionTicket.prediction_text))}</p>
                      </button>
                      <label>
                        تحديث/ملاحظة
                        <textarea value={predictionNote} onChange={(event) => setPredictionNote(event.target.value)} rows={2} />
                      </label>
                      <div className="quick-topics">
                        <button className="btn btn-small" type="button" onClick={() => pushPredictionUpdate(selectedPredictionTicket.id)} disabled={updatingPrediction}>
                          تحديث التوقع
                        </button>
                        <button className="btn btn-small" type="button" onClick={() => setPredictionOutcome(selectedPredictionTicket.id, "correct")} disabled={updatingPrediction}>
                          صحيح
                        </button>
                        <button className="btn btn-small" type="button" onClick={() => setPredictionOutcome(selectedPredictionTicket.id, "partial")} disabled={updatingPrediction}>
                          جزئي
                        </button>
                        <button className="btn btn-small btn-danger" type="button" onClick={() => setPredictionOutcome(selectedPredictionTicket.id, "wrong")} disabled={updatingPrediction}>
                          خاطئ
                        </button>
                      </div>
                      <div className="v2-prediction-history">
                        {predictionUpdates.map((update) => (
                          <button
                            key={update.id}
                            type="button"
                            className="detail-block v2-click-block"
                            onClick={() =>
                              setContentModal({
                                title: `تحديث التوقع: ${update.kind}${update.outcome ? ` | ${update.outcome}` : ""}`,
                                content: displayText(update.content),
                                createdAt: update.created_at,
                              })
                            }
                          >
                            <h4>
                              {update.kind} {update.outcome ? `| ${update.outcome}` : ""}
                            </h4>
                            <p>{displayText(update.content)}</p>
                            <small>{formatTime(update.created_at)}</small>
                          </button>
                        ))}
                        {predictionUpdates.length === 0 ? <p>لا يوجد سجل تحديثات بعد.</p> : null}
                      </div>
                    </>
                  ) : (
                    <p>اختر تذكرة لعرض تاريخ التوقع.</p>
                  )}
                </div>
              </div>

              <section className="v2-leaderboard">
                <div className="panel-head">
                  <h4>لوحة دقة النموذج عبر الزمن</h4>
                  <span>{aiStatus.model || "Model"}</span>
                </div>
                <div className="v2-leaderboard-list">
                  {predictionLeaderboard.map((row) => (
                    <article key={`${row.model}-${row.window_hours}`} className="detail-block">
                      <h4>{row.window_label}</h4>
                      <p>
                        الدقة: {Math.round((Number(row.accuracy || 0) * 10000) / 100)}% | التذاكر المقيمة: {row.evaluated_tickets}
                      </p>
                      <small>
                        صحيح: {row.correct_count} | جزئي: {row.partial_count} | خاطئ: {row.wrong_count} | التغير:{" "}
                        {Math.round((Number(row.trend_delta || 0) * 10000) / 100)}%
                      </small>
                    </article>
                  ))}
                  {predictionLeaderboard.length === 0 ? <p>لا توجد بيانات تقييم كافية بعد.</p> : null}
                </div>
              </section>
            </article>
          </section>
        </section>
      )}

      {contentModal ? (
        <div className="event-modal-overlay" onClick={() => setContentModal(null)}>
          <article className="event-modal panel content-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head event-modal-head">
              <h2>{contentModal.title}</h2>
              <button className="btn btn-small" type="button" onClick={() => setContentModal(null)}>
                إغلاق
              </button>
            </div>
            {contentModal.createdAt ? <p className="details-meta">{formatTime(contentModal.createdAt)}</p> : null}
            <article className="detail-block content-modal-body">
              {(() => {
                const items = toReadableBullets(contentModal.content);
                if (items.length > 1) {
                  return (
                    <ul className="content-modal-list">
                      {items.map((item, index) => (
                        <li key={`modal-item-${index}`}>{item}</li>
                      ))}
                    </ul>
                  );
                }
                return <p className="content-modal-paragraph">{String(contentModal.content || "لا يوجد محتوى.")}</p>;
              })()}
            </article>
          </article>
        </div>
      ) : null}

      {popupEvent ? (
        <div className="event-modal-overlay" onClick={() => setPopupEventId(null)}>
          <article className="event-modal panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-head event-modal-head">
              <h2>{displayText(popupEvent.title)}</h2>
              <button className="btn btn-small" type="button" onClick={() => setPopupEventId(null)}>
                إغلاق
              </button>
            </div>
            <p className="details-meta">
              {sourceTypeLabel(popupEvent.source_type)} | {formatTime(eventDisplayTime(popupEvent))} | الشدة S{popupEvent.severity} (
              {severityMeaning(popupEvent.severity)})
            </p>
            <div className="detail-sections">
              <article className="detail-block">
                <h4>الملخص</h4>
                <p>{displayText(popupEvent.summary) || "لا يوجد ملخص."}</p>
              </article>
              <article className="detail-block">
                <h4>تقييم الذكاء</h4>
                <p>{displayText(popupEvent.ai_assessment) || "لا يوجد تقييم إضافي."}</p>
              </article>
              <article className="detail-block">
                <h4>تفاصيل المصدر</h4>
                <p>{displayText(summarizeSourceDetails(popupEvent)) || "لا توجد تفاصيل إضافية."}</p>
              </article>
            </div>
            <div className="facts-grid">
              {popupFacts.map(([key, value], index) => (
                <span className="fact-pill" key={`popup-${key}-${index}`}>
                  <strong>{key}:</strong> {value}
                </span>
              ))}
            </div>
            <div className="quick-topics modal-links">
              {popupEvent.url ? (
                <a className="btn btn-ghost source-link-btn" href={popupEvent.url} target="_blank" rel="noreferrer">
                  زيارة الموقع الأصلي
                </a>
              ) : null}
              {popupSourceEndpoint ? (
                <a className="btn btn-ghost source-link-btn" href={popupSourceEndpoint} target="_blank" rel="noreferrer">
                  زيارة مصدر السحب
                </a>
              ) : null}
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}

