import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet } from "./api";

const COUNTRY_OPTIONS = [
  { code: "UAE", ar: "الإمارات", markers: ["uae", "united arab emirates", "الإمارات", "الامارات", "dubai", "abu dhabi"] },
  { code: "Saudi Arabia", ar: "السعودية", markers: ["saudi", "ksa", "saudi arabia", "السعودية", "الرياض", "جدة"] },
  { code: "Qatar", ar: "قطر", markers: ["qatar", "قطر", "doha", "الدوحة"] },
  { code: "Kuwait", ar: "الكويت", markers: ["kuwait", "الكويت"] },
  { code: "Oman", ar: "عمان", markers: ["oman", "عمان", "muscat", "مسقط"] },
  { code: "Bahrain", ar: "البحرين", markers: ["bahrain", "البحرين", "المنامة"] },
];

const TAB_OPTIONS = [
  { key: "air", label: "العمليات الجوية" },
  { key: "trade", label: "التجارة / سلاسل الإمداد" },
  { key: "threat", label: "إشارات التهديد" },
  { key: "timeline", label: "التسلسل / الأدلة" },
  { key: "risk", label: "مؤشر المخاطر الإقليمي" },
];

const RISK_LEVELS = [
  { max: 24, label: "Low", labelAr: "منخفض" },
  { max: 49, label: "Elevated", labelAr: "مرتفع نسبيًا" },
  { max: 74, label: "High", labelAr: "عالٍ" },
  { max: 100, label: "Critical", labelAr: "حرج" },
];

function cleanText(value) {
  return String(value || "").trim();
}

function normLower(value) {
  return cleanText(value).toLowerCase();
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatTime(value) {
  const parsed = parseDate(value);
  if (!parsed) return "غير متاح";
  return parsed.toLocaleString("ar-AE", { hour12: false });
}

function formatRelative(value) {
  const parsed = parseDate(value);
  if (!parsed) return "غير متاح";
  const diffMinutes = Math.max(0, Math.round((Date.now() - parsed.getTime()) / 60000));
  if (diffMinutes < 1) return "الآن";
  if (diffMinutes < 60) return `قبل ${diffMinutes} دقيقة`;
  const h = Math.round(diffMinutes / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return `قبل ${d} يوم`;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function severityLabel(level) {
  const value = asNumber(level, 1);
  if (value >= 5) return "S5";
  if (value >= 4) return "S4";
  if (value >= 3) return "S3";
  if (value >= 2) return "S2";
  return "S1";
}

function sourceClassOf(row) {
  const sourceName = normLower(row?.source_name);
  const sourceType = normLower(row?.source_type);
  if (
    /(ministry|government|gov|wam|moi|mod|official|وزارة|الدفاع|الداخلية|رئاسة)/.test(sourceName)
  ) {
    return "رسمي";
  }
  if (sourceType === "social") return "سوشال";
  if (sourceType === "news") return "إعلام";
  if (sourceType === "incident" || sourceType === "cyber") return "OSINT";
  return "عام";
}

function confidenceOfSignal(row) {
  const sourceClass = sourceClassOf(row);
  const sev = asNumber(row?.severity, 1);
  if (sourceClass === "رسمي" && sev >= 4) return "عالٍ";
  if ((sourceClass === "إعلام" || sourceClass === "رسمي") && sev >= 3) return "متوسط";
  return "منخفض";
}

function classifyThreatType(row) {
  const text = [
    row?.title,
    row?.summary,
    row?.details,
    row?.ai_assessment,
    row?.tags,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/intercept|interception|اعتراض/.test(text)) return "اعتراض";
  if (/ballistic|باليست|بالست/.test(text)) return "تهديد باليستي";
  if (/cruise|كروز/.test(text)) return "تهديد كروز";
  if (/drone|uav|مسي|درون/.test(text)) return "تهديد مسيّرات";
  if (/air\s*defense|دفاع جوي/.test(text)) return "دفاع جوي";
  return "إشارة تهديد";
}

function isThreatSignalRow(row) {
  const sourceType = normLower(row?.source_type);
  if (sourceType === "flight" || sourceType === "marine") return false;
  const text = [row?.title, row?.summary, row?.details, row?.ai_assessment, row?.tags]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /(missile|ballistic|cruise|drone|uav|intercept|air defense|attack|strike|threat|صاروخ|باليست|بالست|كروز|مسي|درون|اعتراض|هجوم|استهداف|تهديد|دفاع جوي)/.test(
    text
  );
}

function eventTime(row) {
  return row?.event_time || row?.created_at || null;
}

function matchCountry(row, countryMarkers) {
  const text = [row?.title, row?.summary, row?.details, row?.location, row?.source_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return countryMarkers.some((marker) => text.includes(marker.toLowerCase()));
}

function riskLevel(score) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const found = RISK_LEVELS.find((row) => value <= row.max) || RISK_LEVELS[RISK_LEVELS.length - 1];
  return { score: value, ...found };
}

function toRegionPreset(countryCode) {
  if (countryCode === "UAE") return "UAE";
  if (countryCode === "Saudi Arabia") return "Saudi Arabia";
  if (countryCode === "Qatar") return "Qatar";
  if (countryCode === "Kuwait") return "Kuwait";
  if (countryCode === "Oman") return "Oman";
  if (countryCode === "Bahrain") return "Bahrain";
  return "Custom";
}

export default function OperationalImpactConsole({
  events = [],
  trustedOnly = false,
  onRefreshIngestion = null,
}) {
  const [activeTab, setActiveTab] = useState("air");
  const [country, setCountry] = useState("UAE");
  const [windowHours, setWindowHours] = useState(24);
  const [airPayload, setAirPayload] = useState(null);
  const [tradePayload, setTradePayload] = useState(null);
  const [xIntelSnapshot, setXIntelSnapshot] = useState(null);
  const [loadingAir, setLoadingAir] = useState(false);
  const [loadingTrade, setLoadingTrade] = useState(false);
  const [loadingXIntel, setLoadingXIntel] = useState(false);
  const [loadingBrief, setLoadingBrief] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [error, setError] = useState("");

  const selectedCountry = useMemo(
    () => COUNTRY_OPTIONS.find((row) => row.code === country) || COUNTRY_OPTIONS[0],
    [country]
  );

  const refreshAir = useCallback(async () => {
    setLoadingAir(true);
    try {
      const row = await apiGet(
        `/ops/air?country=${encodeURIComponent(selectedCountry.code)}&hours=${encodeURIComponent(
          windowHours
        )}&delay_threshold=45`
      );
      setAirPayload(row);
      setError("");
    } catch (err) {
      setAirPayload(null);
      setError(err?.message || "تعذر تحميل بيانات العمليات الجوية.");
    } finally {
      setLoadingAir(false);
    }
  }, [selectedCountry.code, windowHours]);

  const refreshTrade = useCallback(async () => {
    setLoadingTrade(true);
    try {
      const row = await apiGet(`/ops/trade?country=${encodeURIComponent(selectedCountry.code)}`);
      setTradePayload(row);
      setError("");
    } catch (err) {
      setTradePayload(null);
      setError(err?.message || "تعذر تحميل بيانات التجارة.");
    } finally {
      setLoadingTrade(false);
    }
  }, [selectedCountry.code]);

  const refreshXIntel = useCallback(async () => {
    setLoadingXIntel(true);
    try {
      const row = await apiGet(
        `/x-intel/dashboard?country=${encodeURIComponent(
          selectedCountry.code
        )}&region_preset=${encodeURIComponent(toRegionPreset(selectedCountry.code))}&time_window=24h&language=both&threat_sensitivity=medium&include_live=true&source_class=all`
      );
      setXIntelSnapshot(row);
    } catch {
      setXIntelSnapshot(null);
    } finally {
      setLoadingXIntel(false);
    }
  }, [selectedCountry.code]);

  useEffect(() => {
    void refreshAir();
    void refreshTrade();
    void refreshXIntel();
  }, [refreshAir, refreshTrade, refreshXIntel]);

  const scopedThreatEvents = useMemo(() => {
    const cutoff = Date.now() - Math.max(1, windowHours) * 3600000;
    let rows = (events || []).filter((row) => isThreatSignalRow(row));
    rows = rows.filter((row) => {
      const ts = parseDate(eventTime(row))?.getTime() ?? 0;
      return ts >= cutoff;
    });
    rows = rows.filter((row) => matchCountry(row, selectedCountry.markers));
    if (trustedOnly) {
      rows = rows.filter((row) => {
        const sourceClass = sourceClassOf(row);
        return sourceClass === "رسمي" || sourceClass === "إعلام";
      });
    }
    return rows.sort((a, b) => (parseDate(eventTime(b))?.getTime() || 0) - (parseDate(eventTime(a))?.getTime() || 0));
  }, [events, selectedCountry.markers, trustedOnly, windowHours]);

  const threatFeed = useMemo(() => {
    return scopedThreatEvents.slice(0, 60).map((row) => {
      const confidence = confidenceOfSignal(row);
      const signalType = classifyThreatType(row);
      const sourceClass = sourceClassOf(row);
      const confirmed = confidence === "عالٍ" && asNumber(row?.severity, 1) >= 4;
      return {
        id: row.id,
        time: eventTime(row),
        type: signalType,
        location: cleanText(row.location) || selectedCountry.ar,
        confidence,
        sourceClass,
        source: cleanText(row.source_name) || "مصدر غير مسمى",
        implication:
          confirmed
            ? "قد ينعكس على جاهزية المجال الجوي/الأصول الحيوية."
            : "إشارة قيد التحقق تستدعي متابعة المصادر الرسمية.",
        statusLabel: confirmed ? "مؤكد" : "إشارة قيد التحقق",
        severity: severityLabel(row.severity),
        url: row.url || "",
        title: cleanText(row.title) || signalType,
      };
    });
  }, [scopedThreatEvents, selectedCountry.ar]);

  const threatCards = useMemo(() => {
    const confirmed = threatFeed.filter((row) => row.statusLabel === "مؤكد").length;
    const monitored = threatFeed.filter((row) => row.statusLabel !== "مؤكد").length;
    const latestTrusted = threatFeed.find((row) => row.sourceClass === "رسمي" || row.sourceClass === "إعلام") || null;
    const highConfidenceRatio = threatFeed.length
      ? threatFeed.filter((row) => row.confidence === "عالٍ").length / threatFeed.length
      : 0;
    const score = Math.min(100, confirmed * 20 + monitored * 7 + Math.round(highConfidenceRatio * 20));
    const level = riskLevel(score);
    return {
      confirmed,
      monitored,
      threatLevel: level.labelAr,
      threatScore: level.score,
      latestTrustedSource: latestTrusted ? `${latestTrusted.source} - ${formatRelative(latestTrusted.time)}` : "غير متاح",
      confidence: highConfidenceRatio >= 0.5 ? "متوسط إلى عالٍ" : threatFeed.length ? "متوسط" : "منخفض",
    };
  }, [threatFeed]);

  const timelineRows = useMemo(() => {
    const rows = [];
    const airFeed = Array.isArray(airPayload?.feed) ? airPayload.feed : [];
    for (const row of airFeed.slice(0, 18)) {
      rows.push({
        domain: "جوي",
        time: row.time,
        event: `${row.status === "cancelled" ? "إلغاء" : "تأخير"} رحلة ${row.flight || ""}`.trim(),
        confidence: row.confidence || (row.derived_indicator ? "متوسط" : "عالٍ"),
        source: row.source_label || "Aviation",
        impact: row.operational_implication || "تأثير على انسياب الحركة الجوية.",
      });
    }
    for (const row of threatFeed.slice(0, 18)) {
      rows.push({
        domain: "تهديد",
        time: row.time,
        event: row.title || row.type,
        confidence: row.confidence,
        source: row.source,
        impact: row.implication,
      });
    }
    if (tradePayload?.available) {
      const topPartner = tradePayload?.summary?.top_partners?.[0];
      const topImport = tradePayload?.summary?.top_imports?.[0];
      if (topPartner) {
        rows.push({
          domain: "تجارة",
          time: tradePayload.last_updated,
          event: `تركيز شريك تجاري: ${topPartner.name}`,
          confidence: tradePayload.confidence || "متوسط",
          source: tradePayload.source_label || "UN Comtrade",
          impact: `حصة ${topPartner.share_pct}% من إجمالي التدفق المرصود.`,
        });
      }
      if (topImport) {
        rows.push({
          domain: "إمداد",
          time: tradePayload.last_updated,
          event: `سلعة مستوردة مؤثرة: ${topImport.name}`,
          confidence: tradePayload.confidence || "متوسط",
          source: tradePayload.source_label || "UN Comtrade",
          impact: `اعتماد نسبي ${topImport.share_pct}% ضمن الواردات.`,
        });
      }
    }
    return rows
      .filter((row) => row.event && row.source)
      .sort((a, b) => (parseDate(b.time)?.getTime() || 0) - (parseDate(a.time)?.getTime() || 0))
      .slice(0, 70);
  }, [airPayload, threatFeed, tradePayload]);

  const riskIndex = useMemo(() => {
    const airSummary = airPayload?.summary || {};
    const delayed = asNumber(airSummary.delayed_flights, 0);
    const cancelled = asNumber(airSummary.cancelled_flights, 0);
    const clusters = asNumber(airSummary.delay_clusters, 0);
    const affectedAirports = asNumber(airSummary.affected_airports, 0);
    const airRisk = Math.min(100, delayed * 6 + cancelled * 12 + clusters * 10 + affectedAirports * 4);

    const threatRisk = threatCards.threatScore || 0;
    const tradeRisk = Math.min(100, asNumber(tradePayload?.summary?.exposure_score, 0));

    const overall = Math.round(0.35 * airRisk + 0.4 * threatRisk + 0.25 * tradeRisk);
    const level = riskLevel(overall);

    const drivers = [
      { domain: "مخاطر التهديدات", score: threatRisk },
      { domain: "مخاطر الطيران", score: airRisk },
      { domain: "مخاطر سلاسل الإمداد", score: tradeRisk },
    ].sort((a, b) => b.score - a.score);

    const confidence =
      (airPayload?.available ? 1 : 0) +
      (threatFeed.length > 0 ? 1 : 0) +
      (tradePayload?.available ? 1 : 0) >=
      2
        ? "متوسط إلى عالٍ"
        : "منخفض إلى متوسط";

    const reasons = [
      `الطيران: ${delayed} تأخير و${cancelled} إلغاء ضمن ${windowHours} ساعة.`,
      `التهديدات: ${threatCards.confirmed} مؤكد و${threatCards.monitored} قيد المتابعة.`,
      tradePayload?.available
        ? `التجارة: درجة تعرض ${tradeRisk}/100 من بيانات UN Comtrade للفترة ${tradePayload.period || "المتاحة"}.`
        : "التجارة: لا توجد عينة Comtrade كافية حاليًا.",
    ];

    const xRisk = xIntelSnapshot?.early_warning || xIntelSnapshot?.risk_early_warning || null;
    if (xRisk?.narrative_risk_level) {
      reasons.push(`إشارة X Narrative: مستوى ${xRisk.narrative_risk_level} (درجة ${xRisk.narrative_risk_score || "n/a"}).`);
    }

    return {
      score: level.score,
      levelAr: level.labelAr,
      levelEn: level.label,
      drivers,
      confidence,
      reasons,
      breakdown: {
        air: airRisk,
        threat: threatRisk,
        trade: tradeRisk,
      },
      lastUpdated: airPayload?.last_updated || tradePayload?.last_updated || threatFeed[0]?.time || null,
    };
  }, [airPayload, tradePayload, threatCards, threatFeed, windowHours, xIntelSnapshot]);

  const generateAiBrief = useCallback(async () => {
    setLoadingBrief(true);
    try {
      const response = await apiGet(
        `/x-intel/brief?country=${encodeURIComponent(
          selectedCountry.code
        )}&region_preset=${encodeURIComponent(toRegionPreset(selectedCountry.code))}&time_window=24h&language=both&threat_sensitivity=medium&include_live=true&source_class=all`
      );
      const text = cleanText(response?.brief?.content || response?.brief || "");
      setAiBrief(text || "");
    } catch {
      setAiBrief("");
    } finally {
      setLoadingBrief(false);
    }
  }, [selectedCountry.code]);

  const airSummary = airPayload?.summary || {};
  const tradeSummary = tradePayload?.summary || {};
  const showAirSignals = Boolean(airPayload?.available && (airSummary.monitored_flights || 0) > 0);
  const showTradeSignals = Boolean(tradePayload?.available && ((tradeSummary.top_imports || []).length > 0 || (tradeSummary.top_partners || []).length > 0));
  const showThreatSignals = threatFeed.length > 0;

  return (
    <div className="op-impact-console">
      <div className="op-impact-header">
        <div>
          <h3>وحدة الأثر التشغيلي</h3>
          <small>تحليل تشغيلي متمركز حول الإمارات بإشارات موثقة من المصادر.</small>
        </div>
        <div className="op-impact-toolbar">
          <label>
            الدولة
            <select value={country} onChange={(event) => setCountry(event.target.value)}>
              {COUNTRY_OPTIONS.map((row) => (
                <option key={row.code} value={row.code}>
                  {row.ar}
                </option>
              ))}
            </select>
          </label>
          <label>
            نافذة التحليل
            <select value={windowHours} onChange={(event) => setWindowHours(Number(event.target.value || 24))}>
              <option value={6}>آخر 6 ساعات</option>
              <option value={12}>آخر 12 ساعة</option>
              <option value={24}>آخر 24 ساعة</option>
              <option value={48}>آخر 48 ساعة</option>
            </select>
          </label>
          <button type="button" className="btn btn-small" onClick={() => {
            void refreshAir();
            void refreshTrade();
            void refreshXIntel();
          }}>
            تحديث اللوحة
          </button>
          {typeof onRefreshIngestion === "function" ? (
            <button type="button" className="btn btn-small btn-ghost" onClick={onRefreshIngestion}>
              سحب المصادر الآن
            </button>
          ) : null}
        </div>
      </div>

      <div className="op-impact-tabs">
        {TAB_OPTIONS.map((row) => (
          <button
            key={row.key}
            className={`btn btn-small ${activeTab === row.key ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab(row.key)}
          >
            {row.label}
          </button>
        ))}
      </div>

      {error ? <div className="status-badge warning">{error}</div> : null}

      {activeTab === "air" ? (
        <section className="op-impact-panel">
          <div className="op-impact-cards">
            <article className="op-impact-card">
              <h4>الرحلات المراقبة</h4>
              <p>{loadingAir ? "..." : asNumber(airSummary.monitored_flights, 0)}</p>
            </article>
            <article className="op-impact-card">
              <h4>الرحلات المتأخرة</h4>
              <p>{loadingAir ? "..." : asNumber(airSummary.delayed_flights, 0)}</p>
            </article>
            <article className="op-impact-card">
              <h4>الرحلات الملغاة</h4>
              <p>{loadingAir ? "..." : asNumber(airSummary.cancelled_flights, 0)}</p>
            </article>
            <article className="op-impact-card">
              <h4>المطارات المتأثرة</h4>
              <p>{loadingAir ? "..." : asNumber(airSummary.affected_airports, 0)}</p>
            </article>
            <article className="op-impact-card">
              <h4>آخر تحديث</h4>
              <p>{loadingAir ? "..." : formatTime(airPayload?.last_updated)}</p>
              {airSummary.derived_indicator ? <small>مؤشر تشغيلي مشتق</small> : <small>Aviationstack API</small>}
            </article>
          </div>

          {showAirSignals ? (
            <>
              <article className="detail-block">
                <h4>تدفق الرحلات ذات الأثر التشغيلي</h4>
                <div className="op-impact-list">
                  {(airPayload?.feed || []).slice(0, 20).map((row) => (
                    <div key={row.id} className="op-impact-list-item">
                      <strong>
                        {row.status === "cancelled" ? "إلغاء" : "تأخير"} {row.flight || "رحلة"} | {row.from_iata || "?"} →{" "}
                        {row.to_iata || "?"}
                      </strong>
                      <small>
                        {formatRelative(row.time)} | تأخير: {row.delay_minutes ?? "غير متاح"} دقيقة | ثقة: {row.confidence || "متوسط"} |{" "}
                        {row.source_label || "مصدر"}
                      </small>
                      <small>{row.operational_implication || "أثر تشغيلي مرصود."}</small>
                    </div>
                  ))}
                </div>
              </article>

              {(airPayload?.airport_table || []).length > 0 ? (
                <article className="detail-block">
                  <h4>جدول أثر المطارات</h4>
                  <small>يُعرض كـ مؤشر تشغيلي مشتق عند غياب حالة تشغيل مطار رسمية مباشرة.</small>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>المطار</th>
                          <th>تأخير</th>
                          <th>إلغاء</th>
                          <th>إجمالي أثر</th>
                          <th>نوع المؤشر</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(airPayload?.airport_table || []).slice(0, 12).map((row) => (
                          <tr key={row.airport_iata || row.airport}>
                            <td>{row.airport || row.airport_iata || "غير متاح"}</td>
                            <td>{asNumber(row.delayed, 0)}</td>
                            <td>{asNumber(row.cancelled, 0)}</td>
                            <td>{asNumber(row.total_impact, 0)}</td>
                            <td>{row.derived_indicator ? "مؤشر تشغيلي مشتق" : "إشارة مباشرة من Aviationstack"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ) : null}
            </>
          ) : (
            <article className="detail-block">
              <h4>العمليات الجوية</h4>
              <p>لا توجد إشارات تشغيلية جوية كافية ضمن النافذة الحالية للدولة المختارة.</p>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "trade" ? (
        <section className="op-impact-panel">
          <div className="op-impact-cards">
            <article className="op-impact-card">
              <h4>أعلى السلع المستوردة</h4>
              <p>{loadingTrade ? "..." : (tradeSummary.top_imports || []).length}</p>
            </article>
            <article className="op-impact-card">
              <h4>أعلى السلع المصدرة</h4>
              <p>{loadingTrade ? "..." : (tradeSummary.top_exports || []).length}</p>
            </article>
            <article className="op-impact-card">
              <h4>أعلى الشركاء التجاريين</h4>
              <p>{loadingTrade ? "..." : (tradeSummary.top_partners || []).length}</p>
            </article>
            <article className="op-impact-card">
              <h4>السلع الحساسة</h4>
              <p>{loadingTrade ? "..." : (tradeSummary.sensitive_commodities || []).length}</p>
            </article>
            <article className="op-impact-card">
              <h4>درجة التعرض التجاري</h4>
              <p>{loadingTrade ? "..." : `${asNumber(tradeSummary.exposure_score, 0)}/100`}</p>
            </article>
          </div>

          {showTradeSignals ? (
            <div className="op-impact-two-cols">
              <article className="detail-block">
                <h4>أهم الواردات / الصادرات</h4>
                <div className="op-impact-list">
                  {(tradeSummary.top_imports || []).slice(0, 6).map((row) => (
                    <div key={`imp-${row.name}`} className="op-impact-list-item">
                      <strong>وارد: {row.name}</strong>
                      <small>القيمة: {row.value.toLocaleString()} | الحصة: {row.share_pct}%</small>
                    </div>
                  ))}
                  {(tradeSummary.top_exports || []).slice(0, 6).map((row) => (
                    <div key={`exp-${row.name}`} className="op-impact-list-item">
                      <strong>صادر: {row.name}</strong>
                      <small>القيمة: {row.value.toLocaleString()} | الحصة: {row.share_pct}%</small>
                    </div>
                  ))}
                </div>
              </article>
              <article className="detail-block">
                <h4>تحليل التعرض التجاري</h4>
                <small>المصدر: {tradePayload?.source_label || "UN Comtrade"} | الفترة: {tradePayload?.period || "غير متاح"}</small>
                <ul className="op-impact-bullets">
                  {(tradePayload?.insights?.notes_ar || []).map((line, idx) => (
                    <li key={`trade-note-${idx}`}>{line}</li>
                  ))}
                </ul>
                <small>
                  تركّز الواردات: {tradePayload?.insights?.trade_concentration || "0%"} | تعرض الشركاء:{" "}
                  {tradePayload?.insights?.partner_exposure || "0%"} | حساسية السلع:{" "}
                  {tradePayload?.insights?.strategic_vulnerability || "0%"}
                </small>
              </article>
            </div>
          ) : (
            <article className="detail-block">
              <h4>التجارة / الإمداد</h4>
              <p>تعذر الحصول على بيانات UN Comtrade في الوقت الحالي. لا يتم استبدالها ببيانات تقديرية.</p>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "threat" ? (
        <section className="op-impact-panel">
          <div className="op-impact-cards">
            <article className="op-impact-card">
              <h4>الاعتراضات المؤكدة</h4>
              <p>{threatCards.confirmed}</p>
            </article>
            <article className="op-impact-card">
              <h4>الإشارات قيد المتابعة</h4>
              <p>{threatCards.monitored}</p>
            </article>
            <article className="op-impact-card">
              <h4>مستوى التهديد</h4>
              <p>{threatCards.threatLevel}</p>
            </article>
            <article className="op-impact-card">
              <h4>آخر مصدر موثوق</h4>
              <p>{threatCards.latestTrustedSource}</p>
            </article>
            <article className="op-impact-card">
              <h4>مستوى الثقة</h4>
              <p>{threatCards.confidence}</p>
            </article>
          </div>

          {showThreatSignals ? (
            <article className="detail-block">
              <h4>سجل إشارات التهديد</h4>
              <div className="op-impact-list">
                {threatFeed.slice(0, 30).map((row) => (
                  <div key={`threat-row-${row.id}`} className="op-impact-list-item">
                    <strong>{row.type} | {row.location}</strong>
                    <small>
                      {formatTime(row.time)} | {row.statusLabel} | ثقة: {row.confidence} | المصدر: {row.sourceClass} / {row.source}
                    </small>
                    <small>{row.implication}</small>
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <article className="detail-block">
              <h4>إشارات التهديد</h4>
              <p>لا توجد إشارات تهديد ذات صلة مباشرة بالدولة المختارة ضمن النافذة الحالية.</p>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "timeline" ? (
        <section className="op-impact-panel">
          {timelineRows.length > 0 ? (
            <article className="detail-block">
              <h4>التسلسل الزمني للأثر التشغيلي</h4>
              <div className="op-impact-list">
                {timelineRows.map((row, idx) => (
                  <div key={`timeline-${idx}`} className="op-impact-list-item">
                    <strong>{row.domain} | {row.event}</strong>
                    <small>
                      {formatTime(row.time)} | الثقة: {row.confidence} | المصدر: {row.source}
                    </small>
                    <small>{row.impact}</small>
                  </div>
                ))}
              </div>
            </article>
          ) : (
            <article className="detail-block">
              <h4>التسلسل الزمني / الأدلة</h4>
              <p>لا توجد أدلة كافية لبناء تسلسل عملي مفيد الآن.</p>
            </article>
          )}
        </section>
      ) : null}

      {activeTab === "risk" ? (
        <section className="op-impact-panel">
          <div className="op-impact-cards">
            <article className="op-impact-card">
              <h4>مؤشر المخاطر الإقليمي</h4>
              <p>{riskIndex.score}/100</p>
            </article>
            <article className="op-impact-card">
              <h4>مستوى المخاطر</h4>
              <p>{riskIndex.levelAr}</p>
            </article>
            <article className="op-impact-card">
              <h4>أبرز المحركات</h4>
              <p>{riskIndex.drivers.slice(0, 2).map((row) => row.domain).join(" | ") || "غير متاح"}</p>
            </article>
            <article className="op-impact-card">
              <h4>مستوى الثقة</h4>
              <p>{riskIndex.confidence}</p>
            </article>
            <article className="op-impact-card">
              <h4>آخر تحديث</h4>
              <p>{formatTime(riskIndex.lastUpdated)}</p>
            </article>
          </div>

          <div className="op-impact-two-cols">
            <article className="detail-block">
              <h4>تفكيك المخاطر حسب المجال</h4>
              <ul className="op-impact-bullets">
                <li>مخاطر الطيران: {riskIndex.breakdown.air}/100</li>
                <li>مخاطر التهديدات: {riskIndex.breakdown.threat}/100</li>
                <li>مخاطر سلاسل الإمداد: {riskIndex.breakdown.trade}/100</li>
              </ul>
            </article>
            <article className="detail-block">
              <h4>لماذا هذا المستوى؟</h4>
              <ul className="op-impact-bullets">
                {riskIndex.reasons.map((line, idx) => (
                  <li key={`risk-reason-${idx}`}>{line}</li>
                ))}
              </ul>
              <div className="quick-topics">
                <button type="button" className="btn btn-small btn-ghost" onClick={() => void generateAiBrief()} disabled={loadingBrief}>
                  {loadingBrief ? "جارٍ توليد شرح AI..." : "توليد شرح AI (X Narrative)"}
                </button>
              </div>
              {loadingXIntel ? <small>جارٍ تحديث مؤشرات X Narrative...</small> : null}
              {aiBrief ? <pre className="op-impact-ai-brief">{aiBrief}</pre> : null}
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
