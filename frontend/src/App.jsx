import { useCallback, useEffect, useMemo, useState } from "react";
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
  "news.sky.com",
  "skynews.com",
  "skynewsarabia.com",
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
  "sky news",
  "skynews",
  "reliefweb",
  "gdacs",
  "cisa",
  "opensky",
  "marinetraffic",
  "flightradar"
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
      "https://www.youtube.com/embed/live_stream?channel=UCkmm6DCJH-2ornZK-ozCs8w&autoplay=1",
    watchUrl: "https://www.youtube.com/channel/UCkmm6DCJH-2ornZK-ozCs8w/live"
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
  return text.includes(q);
}

function eventText(row) {
  return [row.title, row.summary, row.details, row.ai_assessment, row.tags, row.source_name].filter(Boolean).join(" ").toLowerCase();
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
    if (detailsMap.has(key)) facts.push([key, detailsMap.get(key)]);
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

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
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

  const loadAll = useCallback(async () => {
    try {
      const [eventsResp, alertsResp, sourcesResp, messagesResp, insightsResp, reportsResp, privacyResp] = await Promise.all([
        apiGet("/events?limit=500"),
        apiGet("/alerts?limit=200"),
        apiGet("/sources"),
        apiGet("/ai/messages?limit=120"),
        apiGet("/ai/insights?limit=80"),
        apiGet("/ai/reports?limit=40"),
        apiGet("/ai/privacy")
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
      if (payload?.type === "event" || payload?.type === "alert") loadAll();
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
    if (!includePeople) rows = rows.filter((r) => r.source_type !== "social");
    return rows;
  }, [sourceScopedEvents, sourceFilter, includePeople]);

  const sortedFilteredEvents = useMemo(
    () => [...filteredEvents].sort((a, b) => byDateDesc(a.event_time, b.event_time)),
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
  }, [query, sourceFilter, selectedSourceNames, trustedOnly, includePeople]);

  useEffect(() => {
    setFeedPage((prev) => Math.min(Math.max(1, prev), feedTotalPages));
  }, [feedTotalPages]);

  useEffect(() => {
    setAlertsPage((prev) => Math.min(Math.max(1, prev), alertsTotalPages));
  }, [alertsTotalPages]);

  useEffect(() => {
    setSelectedAlertIds((prev) => prev.filter((id) => alerts.some((row) => row.id === id)));
  }, [alerts]);

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

  const popupEvent = useMemo(() => {
    if (!popupEventId) return null;
    return eventsById.get(popupEventId) || null;
  }, [eventsById, popupEventId]);

  const popupFacts = useMemo(() => parseFacts(popupEvent), [popupEvent]);

  const popupSourceEndpoint = useMemo(() => {
    if (!popupEvent) return null;
    return sourceEndpointByName.get(popupEvent.source_name) || sources.find((row) => row.source_type === popupEvent.source_type)?.endpoint || null;
  }, [popupEvent, sourceEndpointByName, sources]);

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

  const broadcastNewsEvents = useMemo(() => {
    const trusted = events.filter((row) => row.source_type === "news" && (!trustedOnly || isTrustedEvent(row)));
    const fallback = events.filter((row) => row.source_type === "incident" && (!trustedOnly || isTrustedEvent(row)));
    const rows = trusted.length > 0 ? trusted : fallback;
    return [...rows].sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
  }, [events, trustedOnly]);

  const tickerEvents = useMemo(() => {
    const rows = [...broadcastNewsEvents];
    rows.sort((a, b) => {
      const aTime = new Date(a.event_time).getTime();
      const bTime = new Date(b.event_time).getTime();
      const aScore = a.severity * 100 + a.relevance_score * 35;
      const bScore = b.severity * 100 + b.relevance_score * 35;
      if (bScore !== aScore) return bScore - aScore;
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
    return rows.slice(0, 20);
  }, [broadcastNewsEvents]);

  const lowerThirdLoop = useMemo(() => [...tickerEvents, ...tickerEvents], [tickerEvents]);

  const breakingEvents = useMemo(() => {
    const rows = broadcastNewsEvents
      .filter((row) => row.severity >= 3)
      .sort((a, b) => new Date(b.event_time).getTime() - new Date(a.event_time).getTime());
    return rows.slice(0, 12);
  }, [broadcastNewsEvents]);

  const primaryBroadcastEvent = useMemo(() => breakingEvents[0] || tickerEvents[0] || null, [breakingEvents, tickerEvents]);

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
  const socialEnabledSources = useMemo(
    () => sources.filter((row) => row.enabled && row.source_type === "social").length,
    [sources]
  );

  const translationCandidates = useMemo(() => {
    const inputs = [
      ...filteredEvents.slice(0, 25).flatMap((row) => [row.title, row.summary]),
      ...alerts.slice(0, 20).flatMap((row) => [row.title, row.details]),
      ...tickerEvents.slice(0, 25).flatMap((row) => [row.title]),
      activeEvent?.title,
      activeEvent?.summary,
      activeEvent?.ai_assessment,
      summarizeSourceDetails(activeEvent),
      popupEvent?.title,
      popupEvent?.summary,
      popupEvent?.ai_assessment,
      summarizeSourceDetails(popupEvent)
    ];
    return [...new Set(inputs.map(cleanText).filter((text) => text && likelyEnglish(text)))].slice(0, 90);
  }, [activeEvent, alerts, filteredEvents, popupEvent, tickerEvents]);

  useEffect(() => {
    if (!openAiConnected || translationCandidates.length === 0) return;
    const missing = translationCandidates.filter((text) => !arabicMap[text]).slice(0, 40);
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
    setFocusedEventId(eventId);
    if (typeof options.alertId === "number") {
      setFocusedAlertId(options.alertId);
    } else if (!options.keepAlert) {
      setFocusedAlertId(null);
    }
    setPopupEventId(eventId);
    void ensureEventLoaded(eventId);
  }

  function focusEvent(eventId, options = {}) {
    if (!eventId) return;
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

  async function triggerIngestion() {
    try {
      await apiPost("/ingest/run?force=true");
      await loadAll();
    } catch (err) {
      setError(err.message || "فشل تشغيل السحب.");
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
          <h1>رصد آخر الأخبار</h1>
        </div>
        <div className="hero-actions">
          <button className="btn btn-accent" type="button" onClick={triggerIngestion}>
            تشغيل سحب فوري
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => setSourceDrawerOpen((prev) => !prev)}>
            {sourceDrawerOpen ? "إخفاء المصادر" : "المصادر والربط"}
          </button>
          <div className="openai-status" title={aiStatus.message}>
            <span className={`status-dot ${openAiConnected ? "online" : "offline"}`} />
            <strong>OpenAI</strong>
            <small>{openAiConnected ? "Connected" : "Disconnected"}</small>
          </div>
          <span className="sync">آخر مزامنة: {formatTime(lastSync)}</span>
        </div>
      </header>

      <section className="panel version-switch">
        <div className="version-switch-head">
          <h2>وضع المنصة</h2>
          <span>V1 محفوظة | V2 للتجربة قبل الاعتماد</span>
        </div>
        <div className="version-tabs">
          <button className={`tab-btn ${versionTab === "v1" ? "active" : ""}`} type="button" onClick={() => setVersionTab("v1")}>
            النسخة الحالية (V1)
          </button>
          <button className={`tab-btn ${versionTab === "v2" ? "active" : ""}`} type="button" onClick={() => setVersionTab("v2")}>
            النسخة التجريبية (V2)
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
          </div>

          <div className="video-lower-third">
            <span className="lower-third-label">عاجل</span>
            <div className="lower-third-window" dir="ltr">
              {tickerEvents.length === 0 ? (
                <strong>{displayText(primaryBroadcastEvent?.title || "لا توجد تحديثات عاجلة حالياً.")}</strong>
              ) : (
                <div className="lower-third-track">
                  {lowerThirdLoop.map((row, index) => (
                    <button
                      key={`lower-third-${row.id}-${index}`}
                      className="lower-third-item"
                      type="button"
                      onClick={() => openEventPopup(row.id)}
                    >
                      <span className={`severity severity-${row.severity}`}>S{row.severity}</span>
                      <strong>{displayText(row.title)}</strong>
                      <small>{row.source_name}</small>
                    </button>
                  ))}
                </div>
              )}
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
          <small>عدد الأحداث بدرجة خطورة S4 و S5.</small>
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
            <button className="btn btn-small" type="button" onClick={clearSelections}>
              مسح الاختيار
            </button>
          </div>

          {leftTab === "feed" ? (
            <>
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
                    className={`event-item ${focusedEventId === eventItem.id ? "focused" : ""} ${selectedEventIds.includes(eventItem.id) ? "selected" : ""}`}
                    key={eventItem.id}
                    onClick={() => openEventPopup(eventItem.id)}
                  >
                    <div className="event-top">
                      <span className={`severity severity-${eventItem.severity}`}>S{eventItem.severity}</span>
                      <span className="source">{sourceTypeLabel(eventItem.source_type)}</span>
                      {isTrustedEvent(eventItem) ? <span className="trusted-tag">موثوق</span> : null}
                      <label className="select-line inline" onClick={(event) => event.stopPropagation()}>
                        <input type="checkbox" checked={selectedEventIds.includes(eventItem.id)} onChange={() => toggleSelected(eventItem.id)} />
                        تحديد
                      </label>
                    </div>
                    <h3>{displayText(eventItem.title)}</h3>
                    <p>{displayText(eventItem.summary || eventItem.ai_assessment || eventItem.details || "بدون ملخص.").slice(0, 150)}</p>
                    <div className="event-meta">
                      <span>{eventItem.source_name}</span>
                      <time>{formatTime(eventItem.event_time)}</time>
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
                    {sourceTypeLabel(activeEvent.source_type)} | {formatTime(activeEvent.event_time)} | الشدة S{activeEvent.severity}
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
                  <h4>توزيع الشدة</h4>
                  {[1, 2, 3, 4, 5].map((level) => {
                    const max = Math.max(...Object.values(severityCounts), 1);
                    const width = `${(severityCounts[level] / max) * 100}%`;
                    return (
                      <div className="bar-row" key={level}>
                        <span>S{level}</span>
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
              <p>{String(contentModal.content || "لا يوجد محتوى.")}</p>
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
              {sourceTypeLabel(popupEvent.source_type)} | {formatTime(popupEvent.event_time)} | الشدة S{popupEvent.severity}
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
        </>
      ) : (
        <section className="panel version-preview">
          <div className="panel-head">
            <h2>النسخة التجريبية V2</h2>
            <span>بيئة اختبار منفصلة عن V1</span>
          </div>
          <p>
            هذه المساحة مخصصة لبناء خط مصادر العمليات الجديد (LiveUAmap / NOTAM / NASA FIRMS / ACLED) بدون التأثير على النسخة الحالية.
          </p>
          <div className="quick-topics">
            <button className="btn btn-accent" type="button" onClick={() => setVersionTab("v1")}>
              العودة إلى النسخة الحالية
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
