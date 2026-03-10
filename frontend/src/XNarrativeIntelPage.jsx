import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "./api";

const REGION_PRESETS = ["UAE", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Gulf", "Custom"];
const COUNTRY_OPTIONS = ["UAE", "Saudi Arabia", "Qatar", "Kuwait", "Bahrain", "Oman", "Gulf"];
const TIME_WINDOWS = ["1h", "6h", "24h", "3d", "7d"];
const LANG_OPTIONS = [
  { value: "arabic", label: "العربية" },
  { value: "english", label: "الإنجليزية" },
  { value: "both", label: "كلتاهما" },
];
const THREAT_SENSITIVITY = ["low", "medium", "high"];
const MODULE_TABS = ["overview", "sentiment", "narratives", "watchlist", "network", "ai-brief"];
const SOURCE_CLASS_OPTIONS = [
  { value: "all", label: "الكل" },
  { value: "official", label: "رسمي" },
  { value: "media", label: "إعلام" },
  { value: "public", label: "عام" },
  { value: "unknown", label: "غير معروف" },
  { value: "suspicious", label: "للمراجعة" },
];

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ar-AE");
  } catch {
    return String(value);
  }
}

function toPercent(value, cap = 100) {
  const n = Number(value || 0);
  return `${Math.max(0, Math.min(cap, n))}%`;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreColor(score) {
  const n = Number(score || 0);
  if (n <= -0.2) return "negative";
  if (n >= 0.2) return "positive";
  return "neutral";
}

function sourceClassLabel(value) {
  const key = String(value || "").toLowerCase();
  if (key === "official" || key === "semi_official") return "رسمي";
  if (key === "major_media" || key === "regional_media" || key === "journalist") return "إعلام";
  if (key === "public_user" || key === "commentator") return "عام";
  if (key === "watchlist_candidate") return "للمراجعة";
  return "غير معروف";
}

function labelForTab(tab) {
  if (tab === "overview") return "نظرة عامة";
  if (tab === "sentiment") return "المشاعر";
  if (tab === "narratives") return "السرديات";
  if (tab === "watchlist") return "المراقبة";
  if (tab === "network") return "الشبكة";
  return "إحاطة الذكاء";
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(href);
}

function UiState({ type = "empty", title, description }) {
  return (
    <div className={`ui-state ui-state-${type}`} role="status" aria-live="polite">
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
    </div>
  );
}

function MetricCard({ label, value, tone = "" }) {
  return (
    <div className={`stat-item ${tone ? `tone-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniPostList({ title, rows }) {
  if (!rows?.length) {
    return (
      <article className="detail-block">
        <h4>{title}</h4>
        <UiState type="empty" title="لا توجد منشورات كافية" description="لا توجد عينة صالحة ضمن الفلتر الحالي." />
      </article>
    );
  }
  return (
    <article className="detail-block">
      <h4>{title}</h4>
      <ul className="xintel-list">
        {rows.slice(0, 6).map((row, idx) => (
          <li key={`${title}-${idx}`}>
            <strong>@{row.username || "-"}</strong> | {formatDateTime(row.created_at)} | {toNumber(row.score, 0)}
            <br />
            {row.text || "-"}
          </li>
        ))}
      </ul>
    </article>
  );
}

function PostGrid({ title, rows }) {
  if (!rows?.length) {
    return (
      <article className="detail-block">
        <h4>{title}</h4>
        <UiState type="empty" title="لا توجد منشورات" description="لا توجد نتائج لهذا القسم حالياً." />
      </article>
    );
  }
  return (
    <article className="detail-block">
      <h4>{title}</h4>
      <div className="xintel-columns">
        {rows.slice(0, 6).map((row, idx) => (
          <article key={`${row.post_id || idx}-${idx}`} className="xintel-post-card">
            <strong>
              @{row.username || "-"} | {sourceClassLabel(row.source_class)}
            </strong>
            <small>{formatDateTime(row.created_at)}</small>
            <p>{row.text || "-"}</p>
            <small>درجة الصلة: {toNumber(row.relevance_score, 0)}</small>
            <small>
              التفاعل: {toNumber(row.engagement_summary?.total, 0)} | ❤ {toNumber(row.engagement_summary?.likes, 0)} | 🔁{" "}
              {toNumber(row.engagement_summary?.reposts, 0)}
            </small>
            <small>وسوم الدولة: {(row.country_tags || []).join("، ") || "-"}</small>
            <small>وسوم السردية: {(row.narrative_tags || []).join("، ") || "-"}</small>
            {row.url ? (
              <button className="btn btn-small" type="button" onClick={() => window.open(row.url, "_blank", "noopener,noreferrer")}>
                فتح المنشور
              </button>
            ) : null}
          </article>
        ))}
      </div>
    </article>
  );
}

export default function XNarrativeIntelPage({ onError }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [regionPreset, setRegionPreset] = useState("UAE");
  const [country, setCountry] = useState("UAE");
  const [customCountry, setCustomCountry] = useState("");
  const [timeWindow, setTimeWindow] = useState("24h");
  const [language, setLanguage] = useState("both");
  const [threatSensitivity, setThreatSensitivity] = useState("medium");
  const [sourceClass, setSourceClass] = useState("all");
  const [lastUpdated, setLastUpdated] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [briefLoading, setBriefLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [data, setData] = useState(null);

  const countryValue = regionPreset === "Custom" ? customCountry.trim() || country : country;
  const hasData = Boolean(data && typeof data === "object");

  const buildQuery = (forceRefresh = false) => {
    const params = new URLSearchParams();
    params.set("country", countryValue || "UAE");
    params.set("region_preset", regionPreset);
    if (regionPreset === "Custom" && customCountry.trim()) params.set("custom_country", customCountry.trim());
    params.set("time_window", timeWindow);
    params.set("language", language);
    params.set("threat_sensitivity", threatSensitivity);
    params.set("source_class", sourceClass);
    params.set("include_live", "true");
    if (forceRefresh) params.set("refresh", "true");
    return params.toString();
  };

  const loadDashboard = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setErrorText("");
    try {
      const payload = await apiGet(`/x-intel/dashboard?${buildQuery(forceRefresh)}`);
      setData(payload);
      setLastUpdated(payload?.last_updated || new Date().toISOString());
    } catch (err) {
      const message = err?.message || "تعذر تحميل بيانات X Narrative Intelligence.";
      setErrorText(message);
      if (onError) onError(err, message);
    } finally {
      if (forceRefresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadDashboard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionPreset, country, customCountry, timeWindow, language, threatSensitivity, sourceClass]);

  const requestBrief = async () => {
    setBriefLoading(true);
    setErrorText("");
    try {
      const payload = await apiPost("/x-intel/brief", {
        country: countryValue || "UAE",
        region_preset: regionPreset,
        custom_country: regionPreset === "Custom" ? customCountry.trim() || null : null,
        time_window: timeWindow,
        language,
        threat_sensitivity: threatSensitivity,
        source_class: sourceClass,
        include_live: true,
        refresh: false,
      });
      setData((prev) => ({ ...(prev || {}), brief: payload?.brief || null }));
      setActiveTab("ai-brief");
    } catch (err) {
      const message = err?.message || "تعذر إنشاء إحاطة الذكاء.";
      setErrorText(message);
      if (onError) onError(err, message);
    } finally {
      setBriefLoading(false);
    }
  };

  const overview = data?.overview || {};
  const diagnostics = data?.diagnostics || {};
  const sourceClasses = data?.source_classes || {};
  const hashtags = data?.hashtags || {};
  const sentiment = data?.sentiment || {};
  const narratives = data?.narratives || {};
  const postViews = data?.posts || {};
  const watchlist = data?.watchlist || {};
  const network = data?.network || {};
  const influence = data?.influence || {};
  const earlyWarning = data?.early_warning || {};
  const brief = data?.brief || null;

  const topHashtags = useMemo(() => hashtags?.ranking || [], [hashtags]);
  const sourceCounts = sourceClasses?.counts || {};
  const representative = sentiment?.representative_posts || {};
  const sentimentDistribution = sentiment?.distribution || {};
  const sentimentTimeline = sentiment?.timeline || [];
  const narrativeItems = narratives?.items || [];
  const watchlistAccounts = watchlist?.accounts || [];
  const coordinationPairs = network?.coordination_pairs || [];
  const clusters = network?.clusters || [];
  const phraseGroups = network?.phrase_similarity_groups || [];
  const influenceLeaders = influence?.leaders || [];

  return (
    <section className="panel xintel-page">
      <div className="panel-head">
        <h2>X Narrative Intelligence</h2>
        <div className="xintel-head-meta">
          <small className="details-meta">آخر تحديث: {formatDateTime(lastUpdated)}</small>
          {(loading || refreshing) ? <span className="xintel-inline-loading">جاري التحديث...</span> : null}
        </div>
      </div>

      <div className="xintel-filters">
        <label>الدولة<select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRY_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>نطاق المنطقة<select value={regionPreset} onChange={(e) => setRegionPreset(e.target.value)}>{REGION_PRESETS.map((item) => <option key={item}>{item}</option>)}</select></label>
        {regionPreset === "Custom" ? <label>دولة مخصصة<input value={customCountry} onChange={(e) => setCustomCountry(e.target.value)} /></label> : null}
        <label>النافذة الزمنية<select value={timeWindow} onChange={(e) => setTimeWindow(e.target.value)}>{TIME_WINDOWS.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>اللغة<select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANG_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label>حساسية المخاطر<select value={threatSensitivity} onChange={(e) => setThreatSensitivity(e.target.value)}>{THREAT_SENSITIVITY.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>تصنيف المصدر<select value={sourceClass} onChange={(e) => setSourceClass(e.target.value)}>{SOURCE_CLASS_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <div className="quick-topics">
          <button className="btn btn-small" type="button" onClick={() => void loadDashboard(true)} disabled={refreshing}>
            {refreshing ? "جاري التحديث..." : "تحديث"}
          </button>
          <button className="btn btn-small" type="button" onClick={() => hasData && downloadJson(`x-intel-snapshot-${Date.now()}.json`, data)} disabled={!hasData}>
            تصدير اللقطة
          </button>
          <button className="btn btn-small btn-accent" type="button" onClick={requestBrief} disabled={briefLoading || !hasData}>
            {briefLoading ? "جاري إنشاء الإحاطة..." : "إنشاء إحاطة AI"}
          </button>
        </div>
      </div>

      <div className="xintel-tabs">
        {MODULE_TABS.map((tab) => (
          <button key={tab} className={`tab-btn ${activeTab === tab ? "active" : ""}`} type="button" onClick={() => setActiveTab(tab)}>
            {labelForTab(tab)}
          </button>
        ))}
      </div>

      <p className="xintel-disclaimer">
        يعرض هذا القسم مزيجًا من المصادر الرسمية والمفتوحة لتحليل السرديات والتأثير، بخلاف صفحة الأخبار المعتمدة على المصادر الموثوقة.
      </p>

      {errorText ? <UiState type="error" title="تعذر تحميل البيانات" description={errorText} /> : null}
      {loading && !hasData ? <UiState type="loading" title="جاري تحميل بيانات X" description="يتم الآن تجهيز التحليل من المصادر المتاحة." /> : null}
      {!loading && !hasData ? <UiState type="empty" title="لا توجد بيانات متاحة" description="جرّب تعديل الفلاتر أو توسيع النافذة الزمنية." /> : null}

      {activeTab === "overview" && hasData ? (
        <div className="xintel-grid">
          <article className="detail-block">
            <h4>ملخص المنصة</h4>
            <div className="stats-grid">
              <MetricCard label="إجمالي المنشورات" value={overview.total_posts || 0} />
              <MetricCard label="حسابات فريدة" value={overview.unique_authors || 0} />
              <MetricCard label="الوسم الأعلى" value={overview.top_hashtag_now || "-"} />
              <MetricCard label="الأسرع نموًا" value={overview.fastest_rising_hashtag || "-"} />
            </div>
          </article>

          <article className="detail-block">
            <h4>عدادات التشخيص</h4>
            <ul className="xintel-list">
              <li>منشورات مجمعة: {diagnostics.total_posts_collected || 0}</li>
              <li>منشورات عامة مجمعة: {diagnostics.total_public_posts_collected || 0}</li>
              <li>منشورات غير معروفة مجمعة: {diagnostics.total_unknown_posts_collected || 0}</li>
              <li>بعد التطبيع: {diagnostics.posts_after_normalization || 0}</li>
              <li>بعد فلتر الصلة: {diagnostics.posts_after_relevance_filter || 0}</li>
              <li>بعد فلتر الترتيب: {diagnostics.posts_after_ranking_filter || 0}</li>
              <li>عينة عامة معروضة: {diagnostics.displayed_public_posts_count || 0}</li>
            </ul>
          </article>

          <article className="detail-block">
            <h4>تصنيف المصادر</h4>
            <small>الفلتر النشط: {sourceClasses.active_filter || "all"}</small>
            <ul className="xintel-list">
              {Object.keys(sourceCounts).length === 0 ? <li>لا توجد فئات مصدر مرصودة.</li> : null}
              {Object.entries(sourceCounts).map(([k, v]) => (
                <li key={k}>
                  <strong>{sourceClassLabel(k)}:</strong> {v}
                </li>
              ))}
            </ul>
          </article>

          <article className="detail-block xintel-span-2">
            <h4>ترتيب الوسوم</h4>
            {topHashtags.length === 0 ? (
              <UiState type="empty" title="لا توجد وسوم مصنّفة" description="لا يوجد حجم كافٍ لترتيب الوسوم في النافذة الحالية." />
            ) : (
              <div className="xintel-table-wrap">
                <table className="xintel-table">
                  <thead>
                    <tr>
                      <th>الوسم</th>
                      <th>الحجم</th>
                      <th>النمو</th>
                      <th>التفاعل</th>
                      <th>حسابات فريدة</th>
                      <th>المشاعر</th>
                      <th>درجة الاتجاه</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topHashtags.slice(0, 12).map((row) => (
                      <tr key={row.hashtag}>
                        <td>{row.hashtag}</td>
                        <td>{toNumber(row.post_count, 0)}</td>
                        <td>{toNumber(row.growth_rate, 0)}</td>
                        <td>{toNumber(row.engagement, 0)}</td>
                        <td>{toNumber(row.unique_authors, 0)}</td>
                        <td className={scoreColor(row.sentiment)}>{toNumber(row.sentiment, 0)}</td>
                        <td>
                          <div className="xintel-bar-track">
                            <div className="xintel-bar-fill" style={{ width: toPercent(row.trend_score) }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <PostGrid title="أبرز التغريدات العامة" rows={postViews.top_public_posts} />
          <PostGrid title="أحدث التغريدات العامة ذات الصلة" rows={postViews.latest_public_posts} />
          <PostGrid title="تغريدات ناشئة" rows={postViews.emerging_public_posts} />
          <PostGrid title="منشورات داعمة للسرديات" rows={postViews.narrative_evidence_posts} />
          <PostGrid title="منشورات للمراجعة" rows={postViews.suspicious_posts} />
        </div>
      ) : null}

      {activeTab === "sentiment" && hasData ? (
        <div className="xintel-grid">
          <article className="detail-block">
            <h4>المشاعر العامة</h4>
            <div className="stats-grid">
              <MetricCard label="المؤشر الكلي" value={toNumber(sentiment.overall_score, 0)} tone={scoreColor(sentiment.overall_score)} />
              <MetricCard label="إيجابي" value={toNumber(sentimentDistribution.positive, 0)} tone="positive" />
              <MetricCard label="محايد" value={toNumber(sentimentDistribution.neutral, 0)} tone="neutral" />
              <MetricCard label="سلبي" value={toNumber(sentimentDistribution.negative, 0)} tone="negative" />
            </div>
          </article>

          <article className="detail-block">
            <h4>العربية مقابل الإنجليزية</h4>
            <ul className="xintel-list">
              <li>العربية: {toNumber(sentiment.language_breakdown?.arabic?.count, 0)} منشور | مؤشر {toNumber(sentiment.language_breakdown?.arabic?.score, 0)}</li>
              <li>الإنجليزية: {toNumber(sentiment.language_breakdown?.english?.count, 0)} منشور | مؤشر {toNumber(sentiment.language_breakdown?.english?.score, 0)}</li>
            </ul>
          </article>

          <article className="detail-block xintel-span-2">
            <h4>اتجاه المشاعر زمنيًا</h4>
            {sentimentTimeline.length === 0 ? (
              <UiState type="empty" title="لا يوجد خط زمني" description="لا توجد عينات كافية لبناء منحنى مشاعر." />
            ) : (
              <div className="xintel-table-wrap">
                <table className="xintel-table">
                  <thead>
                    <tr>
                      <th>الفترة</th>
                      <th>المؤشر</th>
                      <th>الحجم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sentimentTimeline.map((row) => (
                      <tr key={row.bucket}>
                        <td>{row.bucket}</td>
                        <td className={scoreColor(row.score)}>{toNumber(row.score, 0)}</td>
                        <td>{toNumber(row.volume, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <MiniPostList title="أمثلة إيجابية" rows={representative.positive} />
          <MiniPostList title="أمثلة محايدة" rows={representative.neutral} />
          <MiniPostList title="أمثلة سلبية" rows={representative.negative} />
        </div>
      ) : null}

      {activeTab === "narratives" && hasData ? (
        <div className="xintel-grid">
          {narrativeItems.length === 0 ? (
            <article className="detail-block xintel-span-2">
              <UiState type="empty" title="لا توجد سرديات مرصودة" description="لم يتم رصد تكتلات موضوعية كافية ضمن الفلاتر الحالية." />
            </article>
          ) : null}
          {narrativeItems.slice(0, 12).map((row) => (
            <article key={row.topic} className="detail-block">
              <h4>{row.topic}</h4>
              <small>الحجم: {toNumber(row.post_volume, 0)} | المشاعر: {toNumber(row.sentiment, 0)}</small>
              <p>الكلمات المفتاحية: {(row.keywords || []).join("، ") || "-"}</p>
              <ul className="xintel-list">
                {(row.sample_posts || []).slice(0, 2).map((sample, idx) => (
                  <li key={`${row.topic}-sample-${idx}`}>
                    <strong>@{sample.username || "-"}</strong>: {sample.text || "-"}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : null}

      {activeTab === "watchlist" && hasData ? (
        <div className="xintel-grid">
          <article className="detail-block xintel-span-2">
            <p className="xintel-disclaimer">
              {watchlist.disclaimer || "الحسابات المعروضة هنا مبنية على مؤشرات سلوكية وسردية وتتطلب تحققًا بشريًا."}
            </p>
            {watchlistAccounts.length === 0 ? (
              <UiState type="empty" title="لا توجد حسابات للمراجعة" description="لم يتم رصد نمط كافٍ لوضع حسابات في قائمة المراقبة حالياً." />
            ) : (
              <div className="xintel-table-wrap">
                <table className="xintel-table">
                  <thead>
                    <tr>
                      <th>الحساب</th>
                      <th>اللغة</th>
                      <th>الموقع</th>
                      <th>درجة العدائية</th>
                      <th>درجة التنسيق</th>
                      <th>احتمال الأتمتة</th>
                      <th>وسوم بارزة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlistAccounts.slice(0, 50).map((row) => (
                      <tr key={row.username}>
                        <td>@{row.username}</td>
                        <td>{row.language || "-"}</td>
                        <td>{row.inferred_location || "-"}</td>
                        <td>{toNumber(row.hostility_score, 0)}</td>
                        <td>{toNumber(row.coordination_score, 0)}</td>
                        <td>{toNumber(row.bot_likelihood, 0)}</td>
                        <td>{(row.top_hashtags || []).slice(0, 3).join("، ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </div>
      ) : null}

      {activeTab === "network" && hasData ? (
        <div className="xintel-grid">
          <article className="detail-block">
            <h4>ملخص الشبكة</h4>
            <div className="stats-grid">
              <MetricCard label="أزواج تنسيق" value={coordinationPairs.length} />
              <MetricCard label="عناقيد مرصودة" value={clusters.length} />
              <MetricCard label="مجموعات تشابه العبارات" value={phraseGroups.length} />
              <MetricCard label="قادة التأثير" value={influenceLeaders.length} />
            </div>
          </article>

          <article className="detail-block">
            <h4>التحذير المبكر</h4>
            <ul className="xintel-list">
              <li>درجة المخاطر السردية: {toNumber(earlyWarning.narrative_risk_score, 0)}</li>
              <li>مستوى المخاطر: {earlyWarning.narrative_risk_level || "-"}</li>
              <li>السرعة المبكرة: {toNumber(earlyWarning.early_velocity, 0)}</li>
              <li>انتشار عابر للغات: {toNumber(earlyWarning.cross_language_spread, 0)}</li>
            </ul>
          </article>

          <article className="detail-block xintel-span-2">
            <h4>أقوى أزواج التنسيق</h4>
            {coordinationPairs.length === 0 ? (
              <UiState type="empty" title="لا توجد روابط تنسيق كافية" description="لم يتم رصد أزواج ذات درجة تنسيق فوق الحد المعتمد." />
            ) : (
              <div className="xintel-table-wrap">
                <table className="xintel-table">
                  <thead>
                    <tr>
                      <th>الحساب أ</th>
                      <th>الحساب ب</th>
                      <th>الدرجة</th>
                      <th>الإشارة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coordinationPairs.slice(0, 20).map((row, idx) => (
                      <tr key={`${row.account_a}-${row.account_b}-${idx}`}>
                        <td>@{row.account_a}</td>
                        <td>@{row.account_b}</td>
                        <td>{toNumber(row.coordination_score, 0)}</td>
                        <td>{row.label || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <article className="detail-block xintel-span-2">
            <h4>قادة التأثير</h4>
            {influenceLeaders.length === 0 ? (
              <UiState type="empty" title="لا توجد قيادات تأثير مرصودة" description="لا توجد عينة كافية لبناء خريطة تأثير قوية." />
            ) : (
              <div className="xintel-table-wrap">
                <table className="xintel-table">
                  <thead>
                    <tr>
                      <th>الحساب</th>
                      <th>الدور</th>
                      <th>Influence Score</th>
                      <th>Engagement</th>
                      <th>Repost Centrality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {influenceLeaders.slice(0, 20).map((row) => (
                      <tr key={row.username}>
                        <td>@{row.username}</td>
                        <td>{row.role || "-"}</td>
                        <td>{toNumber(row.influence_score, 0)}</td>
                        <td>{toNumber(row.engagement_generation, 0)}</td>
                        <td>{toNumber(row.repost_centrality, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>
        </div>
      ) : null}

      {activeTab === "ai-brief" && hasData ? (
        <div className="xintel-grid">
          <article className="detail-block xintel-span-2">
            <h4>إحاطة الذكاء الاصطناعي</h4>
            {brief ? (
              <pre className="xintel-brief">{brief.content || brief}</pre>
            ) : (
              <UiState type="empty" title="لا توجد إحاطة منشورة بعد" description="اضغط على زر إنشاء إحاطة AI لتوليد التقرير التحليلي." />
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}
