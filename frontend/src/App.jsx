import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
      "https://news.google.com/rss/search?q=site:wam.ae%20(uae%20OR%20dubai%20OR%20abu%20dhabi%20OR%20war%20OR%20attack%20OR%20killed%20OR%20deaths%20OR%20fatalities%20OR%20injuries)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Khaleej Times UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:khaleejtimes.com%20(uae%20OR%20dubai%20OR%20abu%20dhabi%20OR%20war%20OR%20attack%20OR%20killed%20OR%20deaths%20OR%20fatalities%20OR%20injuries)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "Emirates 24/7 UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:emirates247.com%20(uae%20OR%20dubai%20OR%20abu%20dhabi%20OR%20war%20OR%20attack%20OR%20killed%20OR%20deaths%20OR%20fatalities%20OR%20injuries)&hl=en-US&gl=US&ceid=US:en",
    parser_hint: "rss",
    poll_interval_seconds: 180
  },
  {
    name: "The National UAE Feed",
    source_type: "news",
    endpoint:
      "https://news.google.com/rss/search?q=site:thenationalnews.com%20(uae%20OR%20dubai%20OR%20abu%20dhabi%20OR%20war%20OR%20attack%20OR%20killed%20OR%20deaths%20OR%20fatalities%20OR%20injuries)&hl=en-US&gl=US&ceid=US:en",
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
    name: "Abu Dhabi TV YouTube Feed",
    source_type: "news",
    endpoint: "https://www.youtube.com/feeds/videos.xml?channel_id=UCZ33NIO6rgl291T88-9jreQ",
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
    name: "OpenSky Gulf Airspace (Official API)",
    source_type: "flight",
    endpoint: "https://opensky-network.org/api/states/all?lamin=16&lomin=45&lamax=32&lomax=60",
    parser_hint: "opensky",
    poll_interval_seconds: 90
  },
  {
    name: "JSONCargo Gulf AIS (Official API)",
    source_type: "marine",
    endpoint: "https://api.jsoncargo.com/api/v1/vessel/finder?country_iso=GULF&type=cargo",
    parser_hint: "jsoncargo",
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
  },
  {
    name: "X Trusted GCC Agencies",
    source_type: "social",
    endpoint:
      "https://api.x.com/2/tweets/search/recent?query=(from%3Awamnews%20OR%20from%3Aspagov%20OR%20from%3AQNAEnglish%20OR%20from%3AQNAArabic%20OR%20from%3AKUNAArabTimes%20OR%20from%3ABNA_BH%20OR%20from%3AOmanNewsAgency%20OR%20from%3AMOIUAE%20OR%20from%3Anet_ad)%20(%D8%B9%D8%A7%D8%AC%D9%84%20OR%20%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1%20OR%20%D8%A7%D9%84%D8%AE%D9%84%D9%8A%D8%AC%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA)%20lang%3Aar%20-is%3Aretweet&max_results=60",
    parser_hint: "x_recent",
    poll_interval_seconds: 90
  },
  {
    name: "X UAE Government + Media Offices",
    source_type: "social",
    endpoint:
      "https://api.x.com/2/tweets/search/recent?query=(from%3Awamnews%20OR%20from%3Auaegov%20OR%20from%3ADXBMediaOffice%20OR%20from%3Aadmediaoffice)%20(%D8%B9%D8%A7%D8%AC%D9%84%20OR%20%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA%20OR%20UAE)%20lang%3Aar%20-is%3Aretweet&max_results=60",
    parser_hint: "x_recent",
    poll_interval_seconds: 90
  },
  {
    name: "X UAE News Outlets",
    source_type: "social",
    endpoint:
      "https://api.x.com/2/tweets/search/recent?query=(from%3Agulf_news%20OR%20from%3Akhaleejtimes%20OR%20from%3Aemirates247%20OR%20from%3Athenationalnews)%20(%D8%B9%D8%A7%D8%AC%D9%84%20OR%20%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA%20OR%20UAE)%20-is%3Aretweet&max_results=60",
    parser_hint: "x_recent",
    poll_interval_seconds: 90
  },
  {
    name: "X Trusted Arab News Channels",
    source_type: "social",
    endpoint:
      "https://api.x.com/2/tweets/search/recent?query=(from%3Acnnarabic%20OR%20from%3ASkyNewsArabia%20OR%20from%3AAlArabiya%20OR%20from%3AAlHadath%20OR%20from%3ACNBCArabia)%20(%D8%B9%D8%A7%D8%AC%D9%84%20OR%20%D8%A3%D8%AE%D8%A8%D8%A7%D8%B1%20OR%20%D8%A7%D9%84%D8%AE%D9%84%D9%8A%D8%AC%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA)%20lang%3Aar%20-is%3Aretweet&max_results=60",
    parser_hint: "x_recent",
    poll_interval_seconds: 90
  },
  {
    name: "X Trusted Intl Arabic + Gulf",
    source_type: "social",
    endpoint:
      "https://api.x.com/2/tweets/search/recent?query=(from%3ABBCAArabic%20OR%20from%3AFR24_ar%20OR%20from%3AAJArabic%20OR%20from%3ASkyNews%20OR%20from%3AQNAEnglish)%20(gulf%20OR%20uae%20OR%20saudi%20OR%20qatar%20OR%20kuwait%20OR%20bahrain%20OR%20oman%20OR%20breaking)%20-is%3Aretweet&max_results=60",
    parser_hint: "x_recent",
    poll_interval_seconds: 90
  }
];

const officialPresetSourceNames = new Set([
  "WAM UAE Feed",
  "Sky News Arabia RSS",
  "BBC Arabic RSS",
  "France 24 Arabic RSS",
  "X Trusted GCC Agencies",
  "X UAE Government + Media Offices",
  "X UAE News Outlets",
  "X Trusted Arab News Channels",
  "X Trusted Intl Arabic + Gulf",
  "Abu Dhabi TV YouTube Feed",
  "OpenSky Gulf Airspace (Official API)",
  "JSONCargo Gulf AIS (Official API)",
]);

const officialSourceNameMarkers = [
  "wam",
  "spa",
  "qna",
  "kuna",
  "bna",
  "oman",
  "moiuae",
  "uaegov",
  "dxbmediaoffice",
  "admediaoffice",
  "gulf_news",
  "khaleejtimes",
  "emirates247",
  "thenationalnews",
  "net_ad",
  "abu dhabi tv",
  "ministry of interior",
  "opensky",
  "jsoncargo",
  "marinetraffic",
  "official",
  "licensed api",
];

const officialAgencyXHandles = new Set([
  "wamnews",
  "spagov",
  "qnaenglish",
  "qnaarabic",
  "kunaarabtimes",
  "bna_bh",
  "omannewsagency",
  "moiuae",
  "uaegov",
  "dxbmediaoffice",
  "admediaoffice",
  "gulf_news",
  "khaleejtimes",
  "emirates247",
  "thenationalnews",
  "net_ad",
]);

const officialPresetSources = presetSources.filter((preset) => officialPresetSourceNames.has(preset.name));

const trustedDomains = [
  "cnn.com",
  "edition.cnn.com",
  "news.google.com",
  "google.com",
  "alarabiya.net",
  "gulfnews.com",
  "khaleejtimes.com",
  "emirates247.com",
  "thenationalnews.com",
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
  "api.jsoncargo.com",
  "jsoncargo.com",
  "marinetraffic.com",
  "flightradar24.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "x.com",
  "twitter.com"
];

const trustedNameMarkers = [
  "cnn",
  "alarabiya",
  "gulf news",
  "khaleej times",
  "emirates 24/7",
  "the national",
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
  "abu dhabi tv",
  "youtube",
  "reliefweb",
  "gdacs",
  "cisa",
  "opensky",
  "jsoncargo",
  "marinetraffic",
  "flightradar",
  "x gulf live feed"
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
const SOURCE_DRAWER_PAGE_SIZE = 5;
const DEFAULT_NEWS_WINDOW_HOURS = Math.max(0, Number(import.meta.env.VITE_NEWS_MAX_AGE_HOURS || 24));
const predictionReviewIntervalOptions = [
  { value: 600, label: "كل 10 دقائق" },
  { value: 1800, label: "كل 30 دقيقة" },
  { value: 3600, label: "كل ساعة" },
  { value: 7200, label: "كل ساعتين" },
];

const threatCountryDefs = [
  {
    country: "UAE",
    country_ar: "الإمارات",
    lat: 24.4539,
    lon: 54.3773,
    markers: ["uae", "united arab emirates", "dubai", "abu dhabi", "الإمارات", "الامارات", "أبوظبي", "دبي"],
  },
  {
    country: "Qatar",
    country_ar: "قطر",
    lat: 25.2854,
    lon: 51.531,
    markers: ["qatar", "doha", "قطر", "الدوحة"],
  },
  {
    country: "Kuwait",
    country_ar: "الكويت",
    lat: 29.3759,
    lon: 47.9774,
    markers: ["kuwait", "الكويت"],
  },
  {
    country: "Bahrain",
    country_ar: "البحرين",
    lat: 26.2285,
    lon: 50.586,
    markers: ["bahrain", "البحرين", "المنامة"],
  },
  {
    country: "Saudi Arabia",
    country_ar: "السعودية",
    lat: 24.7136,
    lon: 46.6753,
    markers: ["saudi", "saudi arabia", "ksa", "السعودية", "الرياض", "جدة"],
  },
  {
    country: "Oman",
    country_ar: "عمان",
    lat: 23.588,
    lon: 58.3829,
    markers: ["oman", "muscat", "عمان", "مسقط"],
  },
  {
    country: "Jordan",
    country_ar: "الأردن",
    lat: 31.9539,
    lon: 35.9106,
    markers: ["jordan", "الأردن", "عمان الأردن"],
  },
];

const UAE_COUNTRY_MARKERS = ["uae", "united arab emirates", "الإمارات", "الامارات", "emirates"];
const UAE_IATA_AIRPORT_CODES = new Set(["AUH", "DXB", "DWC", "SHJ", "AAN", "RKT", "FJR", "XNB", "AZI", "OMAA", "OMDB"]);
const THREAT_SIGNAL_MAX_VALUE = 1500;
const THREAT_SIGNAL_MAX_DIGITS = 4;
const ICAO_COUNTRY_PREFIX_MAP = {
  OM: "UAE",
  OE: "Saudi Arabia",
  OT: "Qatar",
  OK: "Kuwait",
  OB: "Bahrain",
  OO: "Oman",
  OJ: "Jordan",
  OI: "Iran",
  OR: "Iraq",
  OP: "Pakistan",
  HE: "Egypt",
  EG: "United Kingdom",
  LF: "France",
  ED: "Germany",
  ET: "Germany",
  LE: "Spain",
  LI: "Italy",
  EH: "Netherlands",
  LS: "Switzerland",
  UU: "Russia",
  UE: "Russia",
  UH: "Russia",
  UR: "Ukraine",
  VI: "India",
  VO: "India",
};

const threatSignalDefs = [
  {
    key: "ballistic",
    label: "بالستي",
    patterns: [
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:صاروخ|صواريخ)?\s*(?:بالستي(?:ة)?|ballistic(?:\s+missiles?)?)/giu,
      /(?:بالستي(?:ة)?|ballistic(?:\s+missiles?)?)\s*[:\-–]?\s*([0-9٠-٩][0-9٠-٩.,]*)/giu,
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:اعتراض(?:ات)?|interceptions?)\s*(?:ل|of)?\s*(?:صاروخ(?:ات)?|missiles?|تهديد(?:ات)?\s+جوية)/giu,
      /(?:اعتراض(?:ات)?|interceptions?)\s*[:\-–]?\s*([0-9٠-٩][0-9٠-٩.,]*)\s*(?:صاروخ(?:ات)?|missiles?|تهديد(?:ات)?\s+جوية)?/giu,
    ],
    mentionPatterns: [
      /\bballistic(?:\s+missiles?)?\b/iu,
      /صاروخ(?:\s+)?بالستي(?:ة)?/u,
      /صواريخ(?:\s+)?بالستية/u,
      /(?:صاروخ|صواريخ|missiles?)/iu,
    ],
  },
  {
    key: "cruise",
    label: "كروز",
    patterns: [
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:صاروخ|صواريخ)?\s*(?:كروز|cruise(?:\s+missiles?)?)/giu,
      /(?:كروز|cruise(?:\s+missiles?)?)\s*[:\-–]?\s*([0-9٠-٩][0-9٠-٩.,]*)/giu,
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:صاروخ|صواريخ)?\s*(?:مجنح(?:ة)?|مجنّح(?:ة)?)/giu,
    ],
    mentionPatterns: [
      /\bcruise(?:\s+missiles?)?\b/iu,
      /صاروخ(?:\s+)?كروز/u,
      /صواريخ(?:\s+)?كروز/u,
      /صاروخ(?:\s+)?مجنح(?:ة)?/u,
    ],
  },
  {
    key: "drones",
    label: "مسيّرات",
    patterns: [
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:طائرات|مسي(?:رة|رات)|درون(?:ات)?|drones?|uavs?)/giu,
      /(?:مسي(?:رة|رات)|درون(?:ات)?|drones?|uavs?)\s*[:\-–]?\s*([0-9٠-٩][0-9٠-٩.,]*)/giu,
      /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:تهديد(?:ات)?\s+جوية|air\s+threats?)/giu,
    ],
    mentionPatterns: [
      /\bdrones?\b/iu,
      /\buavs?\b/iu,
      /مسي(?:رة|رات)/u,
      /درون(?:ات)?/u,
      /طائرة(?:\s+)?مسي(?:رة|ّرة)/u,
      /تهديد(?:ات)?\s+جوية/u,
      /اعتراض(?:ات)?\s+جوية/u,
    ],
  },
];

const maritimeZoneDefs = [
  { id: "hormuz", label: "مضيق هرمز", lat: 26.57, lon: 56.25, markers: ["hormuz", "هرمز", "strait of hormuz"] },
  { id: "oman_gulf", label: "خليج عمان", lat: 24.3, lon: 58.6, markers: ["gulf of oman", "خليج عمان"] },
  { id: "arabian_gulf", label: "الخليج العربي", lat: 27.2, lon: 51.7, markers: ["arabian gulf", "persian gulf", "الخليج العربي", "الخليج"] },
  { id: "red_sea", label: "البحر الأحمر", lat: 20.8, lon: 38.8, markers: ["red sea", "البحر الأحمر"] },
  { id: "arabian_sea", label: "بحر العرب", lat: 18.5, lon: 64.0, markers: ["arabian sea", "بحر العرب"] },
  { id: "mediterranean", label: "البحر المتوسط", lat: 34.8, lon: 29.5, markers: ["mediterranean", "البحر الأبيض المتوسط", "البحر المتوسط"] },
];

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
    id: "abudhabi-tv-live",
    label: "Abu Dhabi TV (قناة أبوظبي)",
    embedUrl:
      import.meta.env.VITE_ABUDHABI_TV_EMBED_URL ||
      "https://www.youtube.com/embed/d5MZBC81zMg?autoplay=1",
    embedCandidates: [
      import.meta.env.VITE_ABUDHABI_TV_EMBED_URL || "https://www.youtube.com/embed/d5MZBC81zMg?autoplay=1",
      "https://www.youtube.com/embed/ntakmDtUNnA?autoplay=1",
      "https://www.youtube.com/embed/live_stream?channel=UCZ33NIO6rgl291T88-9jreQ&autoplay=1",
    ],
    watchUrl: "https://www.youtube.com/watch?v=d5MZBC81zMg"
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
  const date = parsePossiblyDate(value);
  if (!date) return "غير متاح";
  return date.toLocaleString("ar-AE", { hour12: false, timeZone: "Asia/Dubai" });
}

function predictionStatusLabel(value) {
  const key = String(value || "").toLowerCase();
  if (key === "resolved") return "مغلق";
  if (key === "watching") return "مراقبة";
  if (key === "open") return "مفتوح";
  return value || "غير معروف";
}

function predictionOutcomeLabel(value) {
  const key = String(value || "").toLowerCase();
  if (key === "correct") return "صحيح";
  if (key === "partial") return "جزئي";
  if (key === "wrong") return "خاطئ";
  if (key === "unknown") return "غير محسوم";
  return value || "غير محسوم";
}

function predictionScorePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric * 100)));
}

function predictionUpdateKindLabel(value) {
  const key = String(value || "").toLowerCase().trim();
  if (key === "initial") return "إنشاء التوقع";
  if (key === "update") return "تحديث";
  if (key === "auto") return "تحديث تلقائي";
  if (key === "auto_review") return "مراجعة آلية";
  if (key === "outcome") return "تقييم النتيجة";
  return value || "تحديث";
}

function parsePossiblyDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  let normalized = raw;
  // Backend rows can be timezone-less; treat those as UTC to keep UI clocks stable.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)) {
    normalized = `${raw}Z`;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function eventDisplayTime(row) {
  return row?.created_at || row?.event_time || null;
}

function isLiveFreshNews(row, maxAgeHours) {
  if (Number(maxAgeHours) <= 0) return true;
  if (!row || row.source_type !== "news") return true;
  const date = parsePossiblyDate(eventDisplayTime(row));
  if (!date) return false;
  return Date.now() - date.getTime() <= Number(maxAgeHours) * 60 * 60 * 1000;
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
  const date = parsePossiblyDate(value);
  if (!date) return "غير معروف";
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
  const date = parsePossiblyDate(value);
  if (!date) return 0;
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

function sectionToggleLabel(isOpen) {
  return isOpen ? "إخفاء" : "إظهار";
}

function predictionDueAt(ticket) {
  if (!ticket?.created_at) return null;
  const createdDate = parsePossiblyDate(ticket.created_at);
  if (!createdDate) return null;
  const createdMs = createdDate.getTime();
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

const ARABIC_INDIC_DIGITS = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
};

const COUNTRY_ALIAS_MAP = {
  "الإمارات": [
    "الإمارات",
    "الامارات",
    "الإمارات العربية المتحدة",
    "الامارات العربية المتحدة",
    "uae",
    "u.a.e",
    "united arab emirates",
    "دبي",
    "dubai",
    "أبو ظبي",
    "ابو ظبي",
    "abu dhabi",
    "abudhabi",
    "الشارقة",
    "sharjah",
    "عجمان",
    "ajman",
    "رأس الخيمة",
    "راس الخيمة",
    "ras al khaimah",
    "rak",
    "الفجيرة",
    "fujairah",
    "أم القيوين",
    "ام القيوين",
    "umm al quwain",
    "uae coast",
    "سواحل الإمارات",
  ],
  "السعودية": ["السعودية", "المملكة العربية السعودية", "saudi arabia", "saudi", "ksa", "riyadh", "jeddah"],
  "قطر": ["قطر", "qatar", "doha", "الدوحة"],
  "الكويت": ["الكويت", "kuwait", "kuwaiti", "كويتي", "الكويتي", "مطار الكويت", "kuwait airport"],
  "البحرين": ["البحرين", "bahrain", "المنامة", "manama"],
  "عمان": ["عمان", "oman", "مسقط", "muscat"],
};

const FATALITY_COUNT_PATTERNS = [
  /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:قتيل(?:اً|ا)?|قتلى|وفيات|وفاة|ضحايا|مصرع|استشهاد|متوف(?:ى|ين|ون)?|killed|dead|deaths?|fatalit(?:y|ies))/giu,
  /(?:مقتل|قتل|وفاة|وفيات|ضحايا|مصرع|استشهاد|متوف(?:ى|ين|ون)?)\s*(?:[:\-–]?\s*)?([0-9٠-٩][0-9٠-٩.,]*)/giu,
  /(?:killed|dead|deaths?|fatalit(?:y|ies))\s*(?:[:\-–]?\s*)?([0-9٠-٩][0-9٠-٩.,]*)/giu,
];

const INJURY_COUNT_PATTERNS = [
  /([0-9٠-٩][0-9٠-٩.,]*)\s*(?:مصاب(?:اً|ا)?|مصابين|إصابات|اصابات|إصابة|اصابة|جرحى|جريح(?:اً|ا)?|injured|injuries|wounded)/giu,
  /(?:إصابات|اصابات|إصابة|اصابة|مصاب(?:ين)?|جرحى|جريح(?:ين)?)\s*(?:[:\-–]?\s*)?([0-9٠-٩][0-9٠-٩.,]*)/giu,
  /(?:injured|injuries|wounded)\s*(?:[:\-–]?\s*)?([0-9٠-٩][0-9٠-٩.,]*)/giu,
];

const FATALITY_ZERO_PATTERNS = [
  /(?:لا توجد|لا يوجد)\s+(?:أي\s+)?(?:وفيات|قتلى|ضحايا|خسائر بشرية)/iu,
  /(?:no|zero|without)\s+(?:confirmed\s+)?(?:deaths?|fatalit(?:y|ies)|killed|dead)/iu,
];

const INJURY_ZERO_PATTERNS = [
  /(?:لا توجد|لا يوجد)\s+(?:أي\s+)?(?:إصابات|اصابات|جرحى|مصابين)/iu,
  /(?:no|zero|without)\s+(?:confirmed\s+)?(?:injuries|injured|wounded)/iu,
];

const FATALITY_SIGNAL_PATTERN = /(?:قتيل|قتلى|وفيات|وفاة|ضحايا|مصرع|استشهاد|متوف(?:ى|ين|ون)?|killed|dead|deaths?|fatalit(?:y|ies))/iu;
const INJURY_SIGNAL_PATTERN = /(?:مصاب(?:اً|ا)?|مصابين|إصابات|اصابات|إصابة|اصابة|جرحى|جريح(?:اً|ا)?|injured|injuries|wounded)/iu;

const EN_NUMBER_WORDS = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
};

function normalizeDateInputValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function resolveAnalysisDateRange(workspace) {
  const rawFrom = normalizeDateInputValue(workspace?.analysisDateFrom);
  if (!rawFrom) {
    return {
      hasRange: false,
      from: "",
      fromIso: "",
      fromDate: null,
    };
  }
  const from = rawFrom;
  const fromIso = `${from}T00:00:00+04:00`;
  const fromDate = parsePossiblyDate(fromIso);
  return {
    hasRange: true,
    from,
    fromIso,
    fromDate,
  };
}

function formatArabicDate(value) {
  const normalized = normalizeDateInputValue(value);
  if (!normalized) return "غير محدد";
  const parsed = parsePossiblyDate(`${normalized}T00:00:00+04:00`);
  if (!parsed) return normalized;
  return parsed.toLocaleDateString("ar-AE", { timeZone: "Asia/Dubai" });
}

function analysisDateRangeLabel(workspace) {
  const range = resolveAnalysisDateRange(workspace);
  if (!range.hasRange) return "ضمن كامل البيانات المتاحة";
  return `من ${formatArabicDate(range.from)} حتى الآن`;
}

function eventDateForRange(row) {
  return parsePossiblyDate(row?.event_time || row?.created_at || null);
}

function eventInsideRange(row, range) {
  if (!range?.hasRange) return true;
  const timestamp = eventDateForRange(row);
  if (!timestamp || !range.fromDate) return false;
  const ms = timestamp.getTime();
  return ms >= range.fromDate.getTime();
}

function normalizeDigits(value) {
  return String(value || "").replace(/[٠-٩]/g, (digit) => ARABIC_INDIC_DIGITS[digit] || digit);
}

function normalizeNumericText(value) {
  let text = normalizeDigits(value).toLowerCase();
  for (const [word, numeric] of Object.entries(EN_NUMBER_WORDS)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "g"), numeric);
  }
  return text;
}

function parseLocalizedInteger(value, options = {}) {
  const maxDigits = Number(options.maxDigits ?? 9);
  const maxValue = Number(options.maxValue ?? Number.MAX_SAFE_INTEGER);
  const minValue = Number(options.minValue ?? 0);
  const normalized = normalizeDigits(value).replace(/[^\d]/g, "");
  if (!normalized) return null;
  if (Number.isFinite(maxDigits) && maxDigits > 0 && normalized.length > maxDigits) return null;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < minValue) return null;
  if (Number.isFinite(maxValue) && parsed > maxValue) return null;
  return parsed;
}

function parseLooseNumber(value) {
  const normalized = normalizeNumericText(value).replace(/[^0-9.-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseLooseBoolean(value) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;
  if (["true", "1", "yes", "y"].includes(raw)) return true;
  if (["false", "0", "no", "n"].includes(raw)) return false;
  return null;
}

function normalizeThreatValue(value) {
  const raw = cleanText(value).trim();
  if (!raw) return "غير معلن";
  const lower = raw.toLowerCase();
  if (lower === "unknown") return "غير معلن";
  if (lower === "some") return "بعض";
  if (raw === "-") return "-";
  return raw;
}

function classifyFlightType(text) {
  const source = cleanText(text).toLowerCase();
  if (/(cargo|freighter|air\s*cargo|شحن)/.test(source)) return "شحن";
  if (/(military|air force|fighter|عسكري|حربي)/.test(source)) return "عسكري";
  if (/(passenger|commercial|airline|ركاب|مدني)/.test(source)) return "ركاب";
  return "غير محدد";
}

function classifyShipType(text) {
  const source = cleanText(text).toLowerCase();
  if (/(tanker|ناقلة|oil\s*tanker)/.test(source)) return "ناقلة";
  if (/(container|حاويات)/.test(source)) return "حاويات";
  if (/(bulk|cargo|بضائع)/.test(source)) return "بضائع عامة";
  if (/(fishing|صيد)/.test(source)) return "صيد";
  if (/(naval|warship|military|عسكري|حربي)/.test(source)) return "حربي";
  return "غير محدد";
}

function classifyCargoType(text) {
  const source = cleanText(text).toLowerCase();
  if (/(food|grain|wheat|rice|flour|غذاء|قمح|أرز|طحين|مواد غذائية)/.test(source)) return "غذاء";
  if (/(oil|crude|lng|gas|fuel|نفط|غاز|وقود)/.test(source)) return "طاقة";
  if (/(container|حاويات)/.test(source)) return "حاويات";
  if (/(aid|humanitarian|مساعدات)/.test(source)) return "مساعدات";
  return "غير محدد";
}

function summarizeCounts(values) {
  const out = {};
  for (const value of values) {
    const key = cleanText(value) || "غير محدد";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function extractSignalMaxFromText(text, patterns, parseOptions = {}) {
  const source = normalizeNumericText(text || "");
  if (!source) return null;
  let max = null;
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      const value = parseLocalizedInteger(match[1], parseOptions);
      if (value != null) max = max == null ? value : Math.max(max, value);
      match = pattern.exec(source);
    }
    pattern.lastIndex = 0;
  }
  return max;
}

function hasSignalMention(text, mentionPatterns = []) {
  const source = normalizeNumericText(text || "");
  if (!source) return false;
  for (const pattern of mentionPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(source)) return true;
  }
  return false;
}

function opsTypeIcon(type) {
  if (type === "air" || type === "air-intel") return "✈";
  if (type === "marine" || type === "marine-intel") return "⛴";
  if (type === "threat" || type === "threat-intel") return "🚀";
  return "ℹ";
}

function toArabicOperationalAssessment(value, severity) {
  const raw = cleanText(value);
  if (!raw) return `تقييم آلي: ${severityMeaning(severity)} ويحتاج متابعة تشغيلية مستمرة.`;
  if (/[\u0600-\u06FF]/.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (/(high[\s-]?priority|critical|urgent)/.test(lower)) {
    return "تقييم آلي: تطور عالي الأولوية وقد يسبب أثرًا تشغيليًا إقليميًا.";
  }
  if (/(medium|moderate|watch)/.test(lower)) {
    return "تقييم آلي: تطور متوسط ويستلزم مراقبة مستمرة للتغيرات.";
  }
  if (/(low|minor|limited)/.test(lower)) {
    return "تقييم آلي: تأثير محدود حاليًا مع استمرار الرصد.";
  }
  return "تقييم آلي: الحدث ذو دلالة تشغيلية ويحتاج تحققًا من نطاق التأثير.";
}

function inferOpsGeoHint(text) {
  const source = cleanText(text).toLowerCase();
  if (!source) return null;
  for (const zone of maritimeZoneDefs) {
    if (zone.markers.some((marker) => source.includes(marker.toLowerCase()))) {
      return { lat: zone.lat, lon: zone.lon, label: zone.label };
    }
  }
  for (const country of threatCountryDefs) {
    if (country.markers.some((marker) => source.includes(marker.toLowerCase()))) {
      return { lat: country.lat, lon: country.lon, label: country.country_ar };
    }
  }
  return null;
}

function isMarineIntelLike(row) {
  if (!row || row.source_type === "marine") return false;
  const text = eventText(row);
  return /(marine|maritime|ship|vessel|tanker|cargo ship|lng|imo|ملاحة|بحري|سفينة|ناقلة|شحنة|ميناء|منظمة البحرية)/.test(text);
}

function isFlightIntelLike(row) {
  if (!row || row.source_type === "flight") return false;
  const text = eventText(row);
  return /(flight|aircraft|airport|aviation|airspace|takeoff|landing|طيران|رحلة|مطار|مجال جوي|إقلاع|هبوط)/.test(text);
}

function isThreatIntelLike(row) {
  if (!row) return false;
  const text = eventText(row);
  return /(missile|ballistic|cruise|drone|uav|intercept|air defense|صاروخ|بالستي|كروز|مسي(?:رة|رات)|درون|اعتراض|دفاع جوي)/.test(
    text
  );
}

function inferThreatSignalKind(text) {
  const source = normalizeNumericText(text || "");
  if (!source) return "threat";
  if (/drone|uav|مسي(?:رة|رات)|درون/.test(source)) return "drones";
  if (/cruise|كروز|مجنح/.test(source)) return "cruise";
  if (/ballistic|بالستي|missile|صاروخ|intercept|اعتراض/.test(source)) return "ballistic";
  return "threat";
}

function isCumulativeThreatStatement(text) {
  const source = normalizeNumericText(text || "");
  if (!source) return false;
  return /(?:since\s+(?:start|beginning)|so\s*far|to\s*date|cumulative|total|tally|overall|from\s+start|from\s+the\s+start|منذ\s+(?:بدء|بداية)|حتى\s+الآن|إجمالي|اجمالي|حصيلة|من\s+أصل|من\s+اصل|منذ\s+بدء\s+الهجمات|منذ\s+بداية\s+الهجمات)/iu.test(
    source
  );
}

function extractShipDisplayName(row) {
  const detailsMap = new Map(parseDetailsTokens(row?.details));
  const fromDetails =
    detailsMap.get("ship_name") ||
    detailsMap.get("vessel") ||
    detailsMap.get("name") ||
    detailsMap.get("mmsi");
  if (fromDetails) return cleanText(fromDetails);
  const title = cleanText(row?.title || "");
  const vesselMatch = title.match(/(?:ناقلة|سفينة|ship|vessel)\s+([^|،,:]{2,90})/iu);
  if (vesselMatch?.[1]) return cleanText(vesselMatch[1]);
  return normalizeStoryTitle(title) || `سفينة-${row?.id || "غير معروف"}`;
}

function sourceLooksOfficialName(value) {
  const name = cleanText(value).toLowerCase();
  if (!name) return false;
  return officialSourceNameMarkers.some((marker) => name.includes(marker));
}

function sourceHasOfficialAuthor(details) {
  const tokens = new Map(parseDetailsTokens(details));
  const authorRaw = cleanText(tokens.get("author")).replace(/^@/, "").toLowerCase();
  if (authorRaw && officialAgencyXHandles.has(authorRaw)) return true;
  const detailsText = cleanText(details).toLowerCase();
  return [...officialAgencyXHandles].some((handle) => detailsText.includes(`@${handle}`));
}

function sourceHostLooksOfficial(urlValue) {
  if (!urlValue) return false;
  try {
    const host = new URL(String(urlValue)).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host.endsWith("wam.ae") ||
      host.endsWith("spa.gov.sa") ||
      host.endsWith("qna.org.qa") ||
      host.endsWith("moi.gov.ae") ||
      host.endsWith("opensky-network.org") ||
      host.endsWith("api.jsoncargo.com") ||
      host.endsWith("jsoncargo.com") ||
      host.endsWith("marinetraffic.com") ||
      host.endsWith("x.com")
    );
  } catch {
    return false;
  }
}

function videoEmbedCandidates(source) {
  if (!source) return [];
  const explicit = Array.isArray(source.embedCandidates) ? source.embedCandidates : [];
  const list = [...explicit, source.embedUrl].map((value) => cleanText(value)).filter(Boolean);
  return [...new Set(list)];
}

function isOfficialOpsEvidence(row) {
  if (!row) return false;
  if (sourceLooksOfficialName(row.source_name)) return true;
  if (sourceHostLooksOfficial(row.url)) return true;
  if (row.source_type === "social" && sourceHasOfficialAuthor(row.details)) return true;
  return false;
}

function buildCountryMarkers(country) {
  const normalized = cleanText(country).toLowerCase();
  if (!normalized) return [];
  let aliases = [];
  for (const [key, values] of Object.entries(COUNTRY_ALIAS_MAP)) {
    const keyNormalized = cleanText(key).toLowerCase();
    const valueNormalized = values.map((value) => cleanText(value).toLowerCase());
    if (normalized === keyNormalized || valueNormalized.includes(normalized)) {
      aliases = [...values];
      break;
    }
  }
  return [...new Set([normalized, ...aliases.map((value) => value.toLowerCase())])];
}

function eventMatchesCountry(row, markers) {
  if (!markers.length) return true;
  const text = eventText(row);
  return markers.some((marker) => marker && text.includes(marker));
}

function findFatalityCounts(text) {
  const source = normalizeNumericText(text);
  const values = [];
  for (const pattern of FATALITY_COUNT_PATTERNS) {
    let match = pattern.exec(source);
    while (match) {
      const count = parseLocalizedInteger(match[1]);
      if (count != null) values.push(count);
      match = pattern.exec(source);
    }
    pattern.lastIndex = 0;
  }
  return values;
}

function hasExplicitZeroFatalities(text) {
  const source = normalizeNumericText(text);
  return FATALITY_ZERO_PATTERNS.some((pattern) => pattern.test(source));
}

function findInjuryCounts(text) {
  const source = normalizeNumericText(text);
  const values = [];
  for (const pattern of INJURY_COUNT_PATTERNS) {
    let match = pattern.exec(source);
    while (match) {
      const count = parseLocalizedInteger(match[1]);
      if (count != null) values.push(count);
      match = pattern.exec(source);
    }
    pattern.lastIndex = 0;
  }
  return values;
}

function hasExplicitZeroInjuries(text) {
  const source = normalizeNumericText(text);
  return INJURY_ZERO_PATTERNS.some((pattern) => pattern.test(source));
}

function sentenceChunks(text) {
  return normalizeNumericText(text || "")
    .split(/[\n\r.!?؟؛]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function chunkMatchesCountry(chunk, markers) {
  if (!markers?.length) return true;
  return markers.some((marker) => marker && chunk.includes(marker));
}

function extractScopedSignalMax(text, markers, countPatterns, signalPattern, parseOptions = {}) {
  const chunks = sentenceChunks(text);
  let max = null;
  for (const chunk of chunks) {
    signalPattern.lastIndex = 0;
    if (!signalPattern.test(chunk)) continue;
    if (!chunkMatchesCountry(chunk, markers)) continue;
    const value = extractSignalMaxFromText(chunk, countPatterns, parseOptions);
    if (value != null) max = max == null ? value : Math.max(max, value);
  }
  return max;
}

function hasScopedExplicitZero(text, markers, zeroPatterns) {
  const chunks = sentenceChunks(text);
  for (const chunk of chunks) {
    if (!chunkMatchesCountry(chunk, markers)) continue;
    for (const pattern of zeroPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(chunk)) return true;
    }
  }
  return false;
}

function countryAffinity(row, markers) {
  if (!markers?.length) return { any: true, strong: true };
  const detailsMap = new Map(parseDetailsTokens(row?.details));
  const locationText = cleanText(
    [
      row?.location,
      detailsMap.get("country"),
      detailsMap.get("country_iso"),
      detailsMap.get("country_ar"),
      detailsMap.get("from_country"),
      detailsMap.get("to_country"),
      detailsMap.get("from_port"),
      detailsMap.get("to_port"),
      detailsMap.get("city"),
      detailsMap.get("location"),
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
  const headlineText = cleanText([row?.title, row?.summary].filter(Boolean).join(" ")).toLowerCase();
  const fullText = eventText(row);
  const inLocation = markers.some((marker) => marker && locationText.includes(marker));
  const inHeadline = markers.some((marker) => marker && headlineText.includes(marker));
  const inAnyText = markers.some((marker) => marker && fullText.includes(marker));
  return {
    any: inLocation || inHeadline || inAnyText,
    strong: inLocation || inHeadline,
  };
}

function deriveFatalityStats(events, workspace) {
  const range = resolveAnalysisDateRange(workspace);
  const markers = buildCountryMarkers(workspace?.country);
  const perStoryFatalityMax = new Map();
  const perStoryInjuryMax = new Map();
  let explicitFatalityZero = false;
  let explicitInjuryZero = false;
  let scanned = 0;
  for (const row of events || []) {
    if (!eventInsideRange(row, range)) continue;
    const affinity = countryAffinity(row, markers);
    if (!affinity.any) continue;
    scanned += 1;
    const text = [row?.title, row?.summary, row?.details, row?.ai_assessment].filter(Boolean).join(" ");
    if (!text) continue;
    const storyKey = normalizeStoryTitle(row?.title) || `event-${row?.id || scanned}`;
    const scopedFatality = extractScopedSignalMax(text, markers, FATALITY_COUNT_PATTERNS, FATALITY_SIGNAL_PATTERN);
    const scopedInjury = extractScopedSignalMax(text, markers, INJURY_COUNT_PATTERNS, INJURY_SIGNAL_PATTERN);
    const fallbackFatality = affinity.strong || !markers.length ? extractSignalMaxFromText(text, FATALITY_COUNT_PATTERNS) : null;
    const fallbackInjury = affinity.strong || !markers.length ? extractSignalMaxFromText(text, INJURY_COUNT_PATTERNS) : null;
    const rowFatalityMax = scopedFatality ?? fallbackFatality;
    const rowInjuryMax = scopedInjury ?? fallbackInjury;

    if (
      hasScopedExplicitZero(text, markers, FATALITY_ZERO_PATTERNS) ||
      ((affinity.strong || !markers.length) && hasExplicitZeroFatalities(text))
    ) {
      explicitFatalityZero = true;
    }
    if (
      hasScopedExplicitZero(text, markers, INJURY_ZERO_PATTERNS) ||
      ((affinity.strong || !markers.length) && hasExplicitZeroInjuries(text))
    ) {
      explicitInjuryZero = true;
    }

    if (rowFatalityMax != null) {
      const current = perStoryFatalityMax.get(storyKey) || 0;
      if (rowFatalityMax > current) perStoryFatalityMax.set(storyKey, rowFatalityMax);
    }
    if (rowInjuryMax != null) {
      const current = perStoryInjuryMax.get(storyKey) || 0;
      if (rowInjuryMax > current) perStoryInjuryMax.set(storyKey, rowInjuryMax);
    }
  }
  const confirmed = perStoryFatalityMax.size > 0 ? Math.max(...perStoryFatalityMax.values()) : null;
  const injured = perStoryInjuryMax.size > 0 ? Math.max(...perStoryInjuryMax.values()) : null;
  return {
    confirmed,
    injured,
    explicitFatalityZero,
    explicitInjuryZero,
    scanned,
  };
}

function buildFatalityAutoLine(workspace, fatalityStats) {
  const safeCountry = String(workspace?.country || "الدولة المستهدفة").trim() || "الدولة المستهدفة";
  const rangeLabel = analysisDateRangeLabel(workspace);
  if (fatalityStats?.confirmed != null) {
    return `حصيلة الوفيات المؤكدة في ${safeCountry} ${rangeLabel}: ${fatalityStats.confirmed} (مستخرجة آلياً من المصادر).`;
  }
  if (fatalityStats?.explicitFatalityZero) {
    return `لا توجد وفيات مؤكدة في ${safeCountry} ${rangeLabel} وفق المصادر المتاحة.`;
  }
  return `حصيلة الوفيات المؤكدة في ${safeCountry} ${rangeLabel}: غير متاحة في المصادر الحالية.`;
}

function buildInjuryAutoLine(workspace, fatalityStats) {
  const safeCountry = String(workspace?.country || "الدولة المستهدفة").trim() || "الدولة المستهدفة";
  const rangeLabel = analysisDateRangeLabel(workspace);
  if (fatalityStats?.injured != null) {
    return `حصيلة الإصابات المؤكدة في ${safeCountry} ${rangeLabel}: ${fatalityStats.injured} (مستخرجة آلياً من المصادر).`;
  }
  if (fatalityStats?.explicitInjuryZero) {
    return `لا توجد إصابات مؤكدة في ${safeCountry} ${rangeLabel} وفق المصادر المتاحة.`;
  }
  return `حصيلة الإصابات المؤكدة في ${safeCountry} ${rangeLabel}: غير متاحة في المصادر الحالية.`;
}

function buildTransportIntelSummary(rows, workspace) {
  const markers = buildCountryMarkers(workspace?.country);
  const scopedRows = (rows || []).filter((row) => rowMatchesCountryMarkersForOps(row, markers));
  const marineRows = scopedRows.filter((row) => row?.source_type === "marine");
  const flightRows = scopedRows.filter((row) => row?.source_type === "flight");

  const shipRouteCounter = new Map();
  const flightRouteCounter = new Map();
  const shipSamples = [];
  const flightSamples = [];

  for (const row of marineRows) {
    const transport = parseTransportContext(row);
    const routeKey = `${routeArrowSummary(transport.fromCountry, transport.toCountry)} | ${routeArrowSummary(
      transport.fromPort,
      transport.toPort
    )} | نوع=${transport.vehicleType || "غير محدد"}`;
    shipRouteCounter.set(routeKey, (shipRouteCounter.get(routeKey) || 0) + 1);
    if (shipSamples.length < 10) {
      shipSamples.push(
        `- سفينة ${transport.shipName || normalizeStoryTitle(row.title) || row.id} | الدول: ${routeArrowSummary(
          transport.fromCountry,
          transport.toCountry
        )} | الموانئ: ${routeArrowSummary(transport.fromPort, transport.toPort)} | النوع: ${
          transport.vehicleType || "غير محدد"
        } | المصدر: ${cleanText(row.source_name)} #${row.id}`
      );
    }
  }

  for (const row of flightRows) {
    const transport = parseTransportContext(row);
    const routeKey = `${routeArrowSummary(transport.fromCountry, transport.toCountry)} | ${routeArrowSummary(
      transport.fromPort,
      transport.toPort
    )} | نوع=${transport.vehicleType || "غير محدد"}`;
    flightRouteCounter.set(routeKey, (flightRouteCounter.get(routeKey) || 0) + 1);
    if (flightSamples.length < 10) {
      flightSamples.push(
        `- رحلة ${cleanText(new Map(parseDetailsTokens(row.details)).get("callsign") || normalizeStoryTitle(row.title) || row.id)} | الدول: ${routeArrowSummary(
          transport.fromCountry,
          transport.toCountry
        )} | المطارات: ${routeArrowSummary(transport.fromPort, transport.toPort)} | نوع الطائرة: ${
          transport.vehicleType || "غير محدد"
        } | المصدر: ${cleanText(row.source_name)} #${row.id}`
      );
    }
  }

  const sortedShipRoutes = [...shipRouteCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const sortedFlightRoutes = [...flightRouteCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const lines = [
    `ملخص نقل مهيكل (ضمن نطاق الدولة): سفن=${marineRows.length} | رحلات=${flightRows.length}.`,
    "المسارات البحرية الأكثر تكراراً:",
    ...(sortedShipRoutes.length > 0
      ? sortedShipRoutes.map(([route, count]) => `- ${route} | عدد الإشارات: ${count}`)
      : ["- لا توجد مسارات بحرية كافية ضمن النطاق."]),
    "عينات سفن تفصيلية:",
    ...(shipSamples.length > 0 ? shipSamples : ["- لا توجد عينات سفن ضمن النطاق."]),
    "المسارات الجوية الأكثر تكراراً:",
    ...(sortedFlightRoutes.length > 0
      ? sortedFlightRoutes.map(([route, count]) => `- ${route} | عدد الإشارات: ${count}`)
      : ["- لا توجد مسارات جوية كافية ضمن النطاق."]),
    "عينات رحلات تفصيلية:",
    ...(flightSamples.length > 0 ? flightSamples : ["- لا توجد عينات رحلات ضمن النطاق."]),
  ];
  return lines.join("\n").slice(0, 2500);
}

function buildOperationalAnalysisTemplate({ focus, country, topic, userRequest, analysisDateFrom, fatalityStats, transportIntel }) {
  const safeFocus = String(focus || "").trim() || "تصعيد إقليمي";
  const safeCountry = String(country || "").trim() || "الدولة المحددة";
  const safeTopic = String(topic || "").trim() || safeFocus;
  const safeRequest = String(userRequest || "").trim() || "تحليل تشغيلي متكامل";
  const safeTransportIntel = String(transportIntel || "").trim();
  const scopeFrom = normalizeDateInputValue(analysisDateFrom);
  const fatalityLine = buildFatalityAutoLine({ country: safeCountry, analysisDateFrom }, fatalityStats);
  const injuryLine = buildInjuryAutoLine({ country: safeCountry, analysisDateFrom }, fatalityStats);
  const rangeLine = `فترة التحليل: ${analysisDateRangeLabel({ analysisDateFrom })}.`;
  return [
    `scope_country: ${safeCountry}`,
    `scope_topic: ${safeTopic}`,
    `scope_from: ${scopeFrom || "none"}`,
    `التركيز: ${safeFocus}`,
    `الدولة المستهدفة: ${safeCountry}`,
    `الموضوع: ${safeTopic}`,
    rangeLine,
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
    "مهم جداً: استخدم كل الأحداث المرفقة من جميع المصادر (رسمية/إعلامية/اجتماعية) ولا تتجاهل أي مصدر.",
    "المحتوى المطلوب تحت العناوين:",
    "1) ملخص الوضع الحالي مقابل الوضع المرجعي عند بداية الموضوع.",
    "2) معلومات لوجستية فعلية للدولة المستهدفة (المطارات/الموانئ/الطرق/سلاسل الإمداد/الطاقة) وتأثير الحدث عليها.",
    "3) الأضرار والخسائر: بشرية/مادية/تشغيلية مع تمييز المؤكد من غير المؤكد وذكر درجة الثقة لكل رقم.",
    `3-أ) ضمن قسم [DAMAGES_LOSSES] أضف سطرين إلزاميين بصيغة واضحة: ${fatalityLine} ثم ${injuryLine}`,
    "3-ب) إذا وُجد تضارب أرقام بين المصادر: اذكر الرقم الرسمي الأحدث كـ(مؤكد) ثم اذكر الأرقام الأخرى كـ(غير مؤكدة) مع سبب مختصر.",
    "3-ج) لا تعرض المراجع/روابط المصادر داخل النص النهائي المخصص للمستخدم؛ استخدمها فقط داخلياً في الاستدلال.",
    "4) تقدير التكلفة الاقتصادية المباشرة وغير المباشرة إن توفرت المؤشرات.",
    "5) إجراءات التخفيف والاستجابة التي تم اتخاذها فعلياً منذ بداية الحدث.",
    "5-أ) داخل [MITIGATION] اكتب قسمين واضحين: (إجراءات حالية) و(إجراءات تنبؤية خلال 6-24 ساعة).",
    "5-ب) كل نقطة في [MITIGATION] يجب أن ترتبط بدليل محدد من الأحداث المرفقة، دون إظهار سطر مصدر للمستخدم.",
    "5-ج) امنع التكرار: لا تعِد نفس الصياغة العامة بين التحليلات؛ عدّل الإجراءات وفق الدولة/المجال/الأدلة الأحدث.",
    "6) فجوات الاستجابة الحالية وما الذي يجب متابعته خلال 6/24/72 ساعة.",
    "7) توقع تشغيلي قصير المدى مع سيناريو رئيسي وبديل ونسبة ثقة.",
    "8) أدرج تحليل النقل (بحري/جوي) داخل الأقسام المناسبة مع توضيح: من أي دولة إلى أي دولة، ومن أي ميناء/مطار إلى أي ميناء/مطار، ونوع السفينة/الرحلة، وتأثيره التشغيلي.",
    ...(safeTransportIntel
      ? ["", "[TRANSPORT_INTEL]", safeTransportIntel, "استخدم الملحق أعلاه كأدلة رقمية مساعدة ولا تهمله."]
      : []),
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

function enrichDamagesLossesSection(text, workspace, fatalityStats) {
  const country = String(workspace?.country || "الدولة المستهدفة").trim();
  const fatalityLine = buildFatalityAutoLine({ country, analysisDateFrom: workspace?.analysisDateFrom }, fatalityStats);
  const injuryLine = buildInjuryAutoLine({ country, analysisDateFrom: workspace?.analysisDateFrom }, fatalityStats);
  const autoLines = `${fatalityLine}\n${injuryLine}`;
  const baseText = String(text || "").trim();
  if (!baseText) return autoLines;
  const lines = baseText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/حصيلة\s+الوفيات\s+المؤكدة|لا\s+توجد\s+وفيات\s+مؤكدة|حصيلة\s+الإصابات\s+المؤكدة|لا\s+توجد\s+إصابات\s+مؤكدة/i.test(line));
  const cleaned = lines.join("\n").trim();
  return cleaned ? `${autoLines}\n${cleaned}` : autoLines;
}

function parseNumericIdList(value) {
  const ids = String(value || "")
    .split(/[\s,]+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((num) => Number.isInteger(num) && num > 0);
  return [...new Set(ids)];
}

function mitigationLaneLabel(lane) {
  if (lane === "air") return "جوي";
  if (lane === "marine") return "بحري";
  if (lane === "cyber") return "سيبراني";
  return "جيوسياسي";
}

function compactEvidenceTitle(row) {
  const title = cleanText(row?.title || row?.summary || "حدث تشغيلي");
  if (!title) return "حدث تشغيلي";
  return title.length > 110 ? `${title.slice(0, 110)}...` : title;
}

function mitigationCurrentActionByLane(lane, country, row) {
  const trigger = compactEvidenceTitle(row);
  if (lane === "air") {
    return `إجراء مرصود في الطيران داخل ${country}: تم رفع جاهزية المطارات والمجال الجوي وتحديث تعليمات التشغيل بناءً على التطور التالي: ${trigger}.`;
  }
  if (lane === "marine") {
    return `إجراء مرصود في الملاحة داخل ${country}: تم تشديد رقابة الموانئ ومسارات العبور وإعادة توجيه المسارات عالية المخاطر وفق التطور التالي: ${trigger}.`;
  }
  if (lane === "cyber") {
    return `إجراء مرصود في الأمن السيبراني داخل ${country}: تم رفع المراقبة الأمنية وعزل المؤشرات المشبوهة وتسريع التحديثات الوقائية بناءً على التطور التالي: ${trigger}.`;
  }
  return `إجراء مرصود أمني/ميداني في ${country}: تم رفع الجاهزية والتنسيق بين الجهات التشغيلية استنادًا إلى التطور التالي: ${trigger}.`;
}

function mitigationForecastActionByLane(lane, country) {
  if (lane === "air") {
    return `خلال 6-24 ساعة: إبقاء خطط تشغيل بديلة للمطارات والرحلات الحساسة في ${country} مع مراجعة دورية كل ساعة للمجال الجوي.`;
  }
  if (lane === "marine") {
    return `خلال 6-24 ساعة: توسيع نقاط المراقبة البحرية حول الممرات الحيوية في ${country} وتحديث مسارات السفن وفق تغير المخاطر.`;
  }
  if (lane === "cyber") {
    return `خلال 6-24 ساعة: تنفيذ دورة تحقق سيبراني متكررة للأنظمة الحرجة في ${country} مع اختبار استجابة الحوادث وتحديث قواعد الرصد.`;
  }
  return `خلال 6-24 ساعة: اعتماد مصفوفة تصعيد مرنة في ${country} تربط مستوى التهديد بإجراءات تشغيلية واضحة قابلة للتنفيذ.`;
}

function normalizeMitigationLine(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[0-9٠-٩]/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeMitigationBaseLines(lines) {
  const out = [];
  const seen = new Set();
  for (const raw of lines || []) {
    const line = cleanText(raw);
    if (!line) continue;
    if (/^\d+[،,]?$/.test(normalizeDigits(line))) continue;
    if (/^المصدر\s*[:：]/i.test(line)) continue;
    if (line.length < 8) continue;
    const key = normalizeMitigationLine(line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

function enrichMitigationSection(text, workspace, ticket, evidenceRows) {
  const country = cleanText(workspace?.country || "الدولة المستهدفة");
  const scopedRows = Array.isArray(evidenceRows) ? evidenceRows.slice(0, 4) : [];
  const baseLines = sanitizeMitigationBaseLines(toBulletLines(String(text || "")));

  const dynamicCurrent = [];
  const dynamicPredictive = [];
  const seenDynamic = new Set();

  for (const row of scopedRows) {
    const lane = eventLane(row);
    const current = mitigationCurrentActionByLane(lane, country, row);
    const forecast = mitigationForecastActionByLane(lane, country);
    const currentKey = normalizeMitigationLine(current);
    if (!seenDynamic.has(currentKey)) {
      dynamicCurrent.push(current);
      seenDynamic.add(currentKey);
    }
    const forecastKey = `${lane}|${normalizeMitigationLine(forecast)}`;
    if (!seenDynamic.has(forecastKey)) {
      dynamicPredictive.push(forecast);
      seenDynamic.add(forecastKey);
    }
  }

  const dominantLane = scopedRows.length
    ? mitigationLaneLabel(
        Object.entries(
          scopedRows.reduce(
            (acc, row) => {
              const lane = eventLane(row);
              acc[lane] = (acc[lane] || 0) + 1;
              return acc;
            },
            { geo: 0, air: 0, marine: 0, cyber: 0 }
          )
        ).sort((a, b) => b[1] - a[1])[0]?.[0] || "geo"
      )
    : "جيوسياسي";

  const headerLine = `مجال الإجراءات المسيطر: ${dominantLane}${cleanText(ticket?.focus_query) ? ` | تركيز التذكرة: ${cleanText(ticket.focus_query)}` : ""}.`;
  const topBase = baseLines.slice(0, 2);
  const currentLines = dynamicCurrent.length > 0 ? dynamicCurrent : topBase;
  const predictiveLines =
    dynamicPredictive.length > 0 ? dynamicPredictive : [mitigationForecastActionByLane("geo", country), mitigationForecastActionByLane("air", country)];

  const lines = [
    headerLine,
    "ما تم تنفيذه فعلياً (مستخرج من الأدلة):",
    ...currentLines.slice(0, 4).map((line) => `- ${line}`),
    "اقتراحات الذكاء لتعزيز خطة التخفيف (6-24 ساعة):",
    ...predictiveLines.slice(0, 4).map((line) => `- ${line}`),
  ];
  return sanitizePredictionBoxContent(lines.join("\n"));
}

function buildSpecialistAnalysisBox({ workspace, ticket, evidenceRows }) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows : [];
  if (rows.length === 0) {
    return "لا توجد أدلة كافية داخل نطاق التذكرة لبناء تحليل تخصصي موثوق حالياً. المطلوب: إضافة أحداث مرتبطة بالدولة/الموضوع ثم إعادة التحليل.";
  }

  const laneCounts = rows.reduce(
    (acc, row) => {
      const lane = eventLane(row);
      acc[lane] = (acc[lane] || 0) + 1;
      return acc;
    },
    { geo: 0, air: 0, marine: 0, cyber: 0 }
  );
  const dominantLaneKey = Object.entries(laneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "geo";
  const dominantLane = mitigationLaneLabel(dominantLaneKey);
  const highSeverity = rows.filter((row) => Number(row?.severity || 0) >= 4).length;
  const country = cleanText(workspace?.country || "الدولة المستهدفة");
  const horizon = Number(ticket?.horizon_hours || 24);

  const lead = rows[0];
  const leadTitle = compactEvidenceTitle(lead);
  const predictiveFocus = mitigationForecastActionByLane(dominantLaneKey, country);

  return sanitizePredictionBoxContent([
    `تقدير تخصصي (حالي + تنبئي) | الدولة: ${country} | المجال الغالب: ${dominantLane}.`,
    `المشهد الحالي: ${rows.length} دليل ضمن نطاق التذكرة، منها ${highSeverity} أدلة عالية الشدة.`,
    `أقوى مؤشر حالي: ${leadTitle}.`,
    `التفسير التشغيلي الحالي: الأولوية التشغيلية الآن في مسار ${dominantLane} مع ضرورة ربط القرار بالأدلة الأحدث فقط.`,
    `التقدير التنبئي حتى ${horizon} ساعة: ${predictiveFocus}`,
    "مؤشرات المراقبة القادمة: تغير الشدة، توسع النطاق الجغرافي، وظهور أدلة مؤكدة جديدة على نفس موضوع التذكرة.",
  ].join("\n"));
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

function splitReadableChunks(line) {
  const value = String(line || "").trim();
  if (!value) return [];
  const byPipe = value
    .split(/\s+\|\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byPipe.length > 1) return byPipe;
  if (value.length > 220) {
    return value
      .split(/\s[-–]\s(?=(?:Official|X|BBC|CNN|RT|Sky|Al|France|حدث|المصدر|Source|@|https?:\/\/))/i)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [value];
}

function looksLikeSourceLabel(label) {
  const raw = cleanText(label);
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return (
    /\[[sS]\d\]/.test(raw) ||
    lower.includes("@") ||
    /(official|feed|feeds|agency|news|source|bbc|cnn|rt|sky|al arabiya|france|x|wam|spa|qna|kuna|bna|moi)/.test(lower) ||
    /(المصدر|وكالة|وزارة|حساب رسمي|رسمي)/.test(raw)
  );
}

function toStructuredReadableBullets(value) {
  const baseItems = toReadableBullets(value);
  const out = [];
  for (const item of baseItems) {
    const chunks = splitReadableChunks(item);
    for (const chunk of chunks) {
      const text = cleanText(chunk).replace(/\s+/g, " ").trim();
      if (!text) continue;

      const labeled = text.match(/^([^:]{2,90})\s*[:：]\s*(.+)$/);
      if (labeled && looksLikeSourceLabel(labeled[1])) {
        out.push({ text: labeled[2].trim(), source: labeled[1].trim() });
        continue;
      }

      const sourceInline = text.match(/^(.+?)\s*\((?:المصدر|Source)\s*[:：]\s*([^)]+)\)\s*$/i);
      if (sourceInline) {
        out.push({ text: sourceInline[1].trim(), source: sourceInline[2].trim() });
        continue;
      }

      if (/^https?:\/\//i.test(text) && out.length > 0 && !out[out.length - 1].source) {
        out[out.length - 1].source = text;
        continue;
      }

      out.push({ text, source: "" });
    }
  }
  return out.filter((row) => row.text);
}

function makePredictionWorkspace(id, index) {
  return {
    id,
    label: `مساحة ${index}`,
    country: "الإمارات",
    analysisDateFrom: "",
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

function eventStoryDedupKey(row) {
  if (!row) return "";
  const detailsMap = new Map(parseDetailsTokens(row.details));
  const urlCandidate =
    normalizeDetectedUrl(row.url) ||
    normalizeDetectedUrl(detailsMap.get("expanded_url")) ||
    normalizeDetectedUrl(detailsMap.get("external_url")) ||
    normalizeDetectedUrl(detailsMap.get("link"));
  if (urlCandidate) return urlCandidate.toLowerCase();
  return normalizeStoryTitle(row.title) || `event-${row.id || "na"}`;
}

function noticeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toFiniteCoord(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function sanitizeLatLon(latValue, lonValue) {
  const lat = toFiniteCoord(latValue);
  const lon = toFiniteCoord(lonValue);
  if (lat == null || lon == null) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function normalizeDetectedUrl(raw) {
  const value = cleanText(raw);
  if (!value) return "";
  return value.replace(/[),.;:!?،؛»"'`]+$/u, "");
}

function extractUrlsFromText(text) {
  const source = String(text || "");
  if (!source) return [];
  const matches = source.match(/https?:\/\/[^\s<>"'`]+/g) || [];
  const out = [];
  for (const match of matches) {
    const normalized = normalizeDetectedUrl(match);
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function toYouTubeEmbedUrl(urlValue) {
  if (!urlValue) return "";
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = url.pathname.replace("/", "").trim();
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (!host.includes("youtube.com")) return "";
    const watchId = url.searchParams.get("v");
    if (watchId) return `https://www.youtube.com/embed/${watchId}`;
    const pathMatch = url.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i);
    if (pathMatch?.[1]) return `https://www.youtube.com/embed/${pathMatch[1]}`;
    return "";
  } catch {
    return "";
  }
}

function toXStatusEmbedUrl(urlValue) {
  if (!urlValue) return "";
  try {
    const url = new URL(urlValue);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.endsWith("x.com") && !host.endsWith("twitter.com")) return "";
    const match = url.pathname.match(/\/status\/(\d+)/i);
    const tweetId = match?.[1] || "";
    if (!tweetId) return "";
    return `https://platform.twitter.com/embed/Tweet.html?id=${tweetId}&theme=dark&dnt=true`;
  } catch {
    return "";
  }
}

function isDirectVideoUrl(urlValue) {
  return /\.(mp4|webm|ogg|m3u8)(?:[?#].*)?$/i.test(String(urlValue || ""));
}

function detectMediaFromEvent(row) {
  if (!row) return { imageUrl: "", videoUrl: "", sourceUrls: [], hasVideoHint: false };
  const detailsMap = new Map(parseDetailsTokens(row.details));
  const videoHintRegex = /(فيديو|video|clip|شاهد|watch)/i;
  const hasVideoHint = videoHintRegex.test(
    [row.title, row.summary, row.details, row.ai_assessment].filter(Boolean).join(" ")
  );
  const textBlob = [
    row.url,
    row.title,
    row.summary,
    row.details,
    row.ai_assessment,
    detailsMap.get("media"),
    detailsMap.get("media_url"),
    detailsMap.get("expanded_url"),
    detailsMap.get("external_url"),
    detailsMap.get("preview_image_url"),
    detailsMap.get("image"),
    detailsMap.get("image_url"),
    detailsMap.get("thumbnail"),
    detailsMap.get("thumb"),
    detailsMap.get("video"),
    detailsMap.get("video_url"),
  ]
    .filter(Boolean)
    .join(" ");
  const urls = extractUrlsFromText(textBlob);
  let imageUrl = "";
  let videoUrl = "";
  let fallbackEmbedUrl = toXStatusEmbedUrl(row.url);
  for (const url of urls) {
    if (!videoUrl) {
      const ytEmbed = toYouTubeEmbedUrl(url);
      if (ytEmbed) {
        videoUrl = ytEmbed;
        continue;
      }
      const xEmbed = toXStatusEmbedUrl(url);
      if (xEmbed && !fallbackEmbedUrl) {
        fallbackEmbedUrl = xEmbed;
      }
      if (isDirectVideoUrl(url)) {
        videoUrl = url;
        continue;
      }
    }
    if (!imageUrl && /\.(png|jpe?g|gif|webp|bmp|svg|avif)(?:[?#].*)?$/i.test(url)) {
      imageUrl = url;
    }
  }
  if (!videoUrl && fallbackEmbedUrl && (hasVideoHint || String(row.source_type || "").toLowerCase() === "social")) {
    videoUrl = fallbackEmbedUrl;
  }
  return { imageUrl, videoUrl, sourceUrls: urls.slice(0, 10), hasVideoHint };
}

function parseDetailsTokens(details) {
  return String(details || "")
    .split(/\||;|\n/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((token) => {
      const eqIndex = token.indexOf("=");
      const colonIndex = token.indexOf(":");
      const splitIndex =
        eqIndex >= 0 && colonIndex >= 0 ? Math.min(eqIndex, colonIndex) : eqIndex >= 0 ? eqIndex : colonIndex;
      if (splitIndex <= 0) return null;
      const key = token.slice(0, splitIndex).trim().toLowerCase();
      const value = token.slice(splitIndex + 1).trim();
      if (!key) return null;
      return [key, value];
    })
    .filter(Boolean);
}

function normalizeTransportValue(value) {
  const cleaned = cleanText(value).trim();
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (["n/a", "na", "unknown", "none", "null", "-", "غير محدد"].includes(lower)) return "";
  return cleaned;
}

function inferCountryFromIcaoCode(value) {
  const code = cleanText(value).toUpperCase().trim();
  if (code.length < 2) return "";
  const prefix2 = code.slice(0, 2);
  if (ICAO_COUNTRY_PREFIX_MAP[prefix2]) return ICAO_COUNTRY_PREFIX_MAP[prefix2];
  if (code.startsWith("K")) return "United States";
  if (code.startsWith("C")) return "Canada";
  if (code.startsWith("Y")) return "Australia";
  return "";
}

function isUaeCountryValue(value) {
  const text = normalizeTransportValue(value).toLowerCase();
  if (!text) return false;
  return UAE_COUNTRY_MARKERS.some((marker) => text.includes(marker.toLowerCase()));
}

function isUaeAirportCode(value) {
  const text = normalizeTransportValue(value).toUpperCase();
  if (!text) return false;
  if (UAE_IATA_AIRPORT_CODES.has(text)) return true;
  const tokenMatch = text.match(/\b[A-Z0-9]{3,4}\b/g) || [];
  return tokenMatch.some((token) => UAE_IATA_AIRPORT_CODES.has(token));
}

function isUaeIcaoCode(value) {
  const code = normalizeTransportValue(value).toUpperCase();
  if (!code) return false;
  return code.startsWith("OM");
}

function parseTransportContext(row) {
  const detailsMap = new Map(parseDetailsTokens(row?.details));
  const sourceType = String(row?.source_type || "").toLowerCase();
  if (sourceType === "marine") {
    const shipName = normalizeTransportValue(
      detailsMap.get("ship_name") || detailsMap.get("vessel") || detailsMap.get("name") || normalizeStoryTitle(row?.title || "")
    );
    const fromCountry = normalizeTransportValue(detailsMap.get("from_country") || detailsMap.get("country") || detailsMap.get("country_name"));
    const toCountry = normalizeTransportValue(detailsMap.get("to_country") || detailsMap.get("destination_country"));
    const fromPort = normalizeTransportValue(detailsMap.get("from_port") || detailsMap.get("home_port") || detailsMap.get("origin_port"));
    const toPort = normalizeTransportValue(detailsMap.get("to_port") || detailsMap.get("destination_port") || detailsMap.get("destination"));
    const vehicleType = normalizeTransportValue(detailsMap.get("vessel_type") || detailsMap.get("type"));
    const vehicleTypeSpecific = normalizeTransportValue(detailsMap.get("vessel_type_specific") || detailsMap.get("type_specific"));
    return {
      shipName,
      fromCountry,
      toCountry,
      fromPort,
      toPort,
      vehicleType,
      vehicleTypeSpecific,
      speedKn: parseLooseNumber(detailsMap.get("speed_kn") || detailsMap.get("speed") || detailsMap.get("sog")),
      heading: normalizeTransportValue(detailsMap.get("heading")),
      detailsMap,
    };
  }
  if (sourceType === "flight") {
    const fromCountry = normalizeTransportValue(detailsMap.get("from_country") || detailsMap.get("origin_country"));
    const toCountry = normalizeTransportValue(detailsMap.get("to_country") || detailsMap.get("destination_country"));
    const fromPort = normalizeTransportValue(detailsMap.get("from_port") || detailsMap.get("origin"));
    const toPort = normalizeTransportValue(detailsMap.get("to_port") || detailsMap.get("destination"));
    const vehicleType = normalizeTransportValue(detailsMap.get("aircraft_type"));
    return {
      fromCountry,
      toCountry,
      fromPort,
      toPort,
      vehicleType,
      speedKn: parseLooseNumber(detailsMap.get("speed_kt") || detailsMap.get("speed") || detailsMap.get("ground_speed")),
      altitude: parseLooseNumber(detailsMap.get("altitude") || detailsMap.get("baro_alt_m")),
      detailsMap,
    };
  }
  return {
    detailsMap,
  };
}

function routeArrowSummary(fromValue, toValue) {
  const from = normalizeTransportValue(fromValue) || "غير محدد";
  const to = normalizeTransportValue(toValue) || "غير محدد";
  return `${from} → ${to}`;
}

function rowMatchesCountryMarkersForOps(row, markers) {
  if (!markers?.length) return true;
  const transport = parseTransportContext(row);
  const text = cleanText(
    [
      row?.title,
      row?.summary,
      row?.details,
      row?.location,
      transport.fromCountry,
      transport.toCountry,
      transport.fromPort,
      transport.toPort,
      transport.shipName,
      transport.vehicleType,
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();
  return markers.some((marker) => marker && text.includes(marker));
}

function geoDistanceKm(latA, lonA, latB, lonB) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(latB - latA);
  const dLon = toRad(lonB - lonA);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

function inferCountryByCoords(latValue, lonValue, maxKm = 430) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  let best = { country: "", distance: Number.POSITIVE_INFINITY };
  for (const country of threatCountryDefs) {
    const distance = geoDistanceKm(lat, lon, Number(country.lat), Number(country.lon));
    if (distance < best.distance) {
      best = { country: country.country_ar, distance };
    }
  }
  return best.distance <= maxKm ? best.country : "";
}

function isInsideCountryOpsRadius(row, countryDef, maxKm = 450) {
  if (!row || !countryDef) return false;
  const coords = sanitizeLatLon(row.latitude, row.longitude);
  if (!coords) return false;
  const countryLat = Number(countryDef.lat);
  const countryLon = Number(countryDef.lon);
  if (!Number.isFinite(countryLat) || !Number.isFinite(countryLon)) return false;
  return geoDistanceKm(coords.lat, coords.lon, countryLat, countryLon) <= maxKm;
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
    if (detailsMap.get("from_country") || detailsMap.get("to_country")) {
      parts.push(`المسار: ${routeArrowSummary(detailsMap.get("from_country"), detailsMap.get("to_country"))}`);
    }
    if (detailsMap.get("from_port") || detailsMap.get("to_port")) {
      parts.push(`المطار: ${routeArrowSummary(detailsMap.get("from_port"), detailsMap.get("to_port"))}`);
    }
    if (detailsMap.get("speed_kt")) parts.push(`السرعة: ${detailsMap.get("speed_kt")} عقدة`);
    if (detailsMap.get("velocity_mps")) parts.push(`السرعة: ${detailsMap.get("velocity_mps")} م/ث`);
    if (detailsMap.get("altitude")) parts.push(`الارتفاع: ${detailsMap.get("altitude")}`);
    if (detailsMap.get("baro_alt_m")) parts.push(`الارتفاع: ${detailsMap.get("baro_alt_m")} م`);
    if (detailsMap.get("on_ground")) parts.push(`على الأرض: ${detailsMap.get("on_ground")}`);
    return parts.join(" | ") || cleanText(row.summary || "");
  }

  if (row.source_type === "marine") {
    const parts = [];
    if (detailsMap.get("ship_name")) parts.push(`السفينة: ${detailsMap.get("ship_name")}`);
    if (detailsMap.get("from_country") || detailsMap.get("to_country")) {
      parts.push(`الدول: ${routeArrowSummary(detailsMap.get("from_country"), detailsMap.get("to_country"))}`);
    }
    if (detailsMap.get("from_port") || detailsMap.get("to_port")) {
      parts.push(`الموانئ: ${routeArrowSummary(detailsMap.get("from_port"), detailsMap.get("to_port"))}`);
    }
    if (detailsMap.get("vessel_type")) parts.push(`النوع: ${detailsMap.get("vessel_type")}`);
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
    ["النوع", sourceTypeLabel(row.source_type)],
    ["الشدّة", `S${row.severity}`],
    ["الصلة", row.relevance_score],
    ["الموقع", row.location],
    ["الوسوم", row.tags]
  ];
  if (row.latitude != null && row.longitude != null) facts.push(["الإحداثيات", `${row.latitude}, ${row.longitude}`]);

  const detailsMap = new Map(parseDetailsTokens(row.details));
  const importantByType = {
    flight: ["callsign", "from_country", "to_country", "from_port", "to_port", "aircraft_type", "speed_kt", "altitude", "on_ground"],
    marine: ["ship_name", "from_country", "to_country", "from_port", "to_port", "vessel_type", "mmsi", "imo", "speed_kn", "heading", "status"],
    cyber: ["cve", "severity", "vendor", "product"],
    incident: ["country", "city", "category"],
    news: ["published", "author"],
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

function hasArabicScript(value) {
  return /[\u0600-\u06FF]/.test(String(value || ""));
}

function isLikelyMojibake(value) {
  const text = String(value || "");
  if (!text) return false;
  if (hasArabicScript(text)) return false;
  return /(?:Ø.|Ù.|Ã.|Â.)/.test(text);
}

function repairArabicMojibake(value) {
  const input = String(value || "");
  if (!isLikelyMojibake(input)) return input;
  const decodePass = (candidate) => {
    const bytes = Uint8Array.from(Array.from(String(candidate || "")).map((ch) => ch.charCodeAt(0) & 0xff));
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  };
  try {
    let current = input;
    for (let i = 0; i < 3; i += 1) {
      const decoded = decodePass(current);
      if (!decoded || decoded === current) break;
      if (hasArabicScript(decoded)) return decoded;
      if (!isLikelyMojibake(decoded)) return decoded;
      current = decoded;
    }
    return current;
  } catch {
    return input;
  }
}

function normalizeLegacyText(value) {
  const text = repairArabicMojibake(cleanText(value));
  return text
    .replace(/تعذر الحصول على رد من OpenAI/gi, "تم التحويل إلى التحليل المحلي (تعذر اتصال OpenAI)")
    .replace(/تعذر إنشاء التحليل عبر OpenAI/gi, "تم التحويل إلى التحليل المحلي (تعذر اتصال OpenAI)")
    .replace(/تحقق من صلاحية (?:المفتاح|المتاح)[^.]*\./gi, "")
    .replace(/تحقق من (?:المفتاح|صلاحية المفتاح)[^.]*\./gi, "")
    .replace(/war_focus/gi, "تركيز الحرب")
    .replace(/\bauto_review\b/gi, "مراجعة آلية")
    .replace(/\bwatching\b/gi, "مراقبة")
    .replace(/\bresolved\b/gi, "مغلق")
    .replace(/\bopen\b/gi, "مفتوح")
    .replace(/\bunknown\b/gi, "غير محسوم")
    .replace(/\bcorrect\b/gi, "صحيح")
    .replace(/\bpartial\b/gi, "جزئي")
    .replace(/\bwrong\b/gi, "خاطئ")
    .replace(/\boutcome\b/gi, "النتيجة");
}

function sanitizePredictionUpdateContent(value, kind) {
  let text = normalizeLegacyText(value).replace(/\r/g, "\n");
  text = text
    .replace(/\(\s*(?:المصدر|source)\s*[:：][^)]+\)/gi, "")
    .replace(/\|\s*(?:المصدر|source)\s*[:：][^|]+/gi, "")
    .replace(/[ ]{2,}/g, " ");
  if (String(kind || "").toLowerCase() !== "auto_review") {
    return text.trim();
  }
  const hiddenPrefixes = [
    "مراجعة آلية",
    "عنوان التذكرة:",
    "التركيز:",
    "النطاق:",
    "موعد الاستحقاق",
    "أدلة القرار",
    "طلب المستخدم:",
  ];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !hiddenPrefixes.some((prefix) => line.startsWith(prefix)));
  return lines.join("\n").trim();
}

function sanitizePredictionBoxContent(value) {
  const text = normalizeLegacyText(value)
    .replace(/\r/g, "\n")
    .replace(/\(\s*(?:المصدر|source)\s*[:：][^)]+\)/gi, "")
    .replace(/\|\s*(?:المصدر|source)\s*[:：][^|]+/gi, "")
    .replace(/[ ]{2,}/g, " ");
  const hiddenLinePatterns = [
    /^\s*(?:المصدر|source)\s*[:：]/i,
    /^\s*scope_(?:country|topic|from)\s*[:=]/i,
    /^\s*(?:عنوان التذكرة|التركيز|النطاق|طلب المستخدم)\s*[:：]/i,
  ];
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !hiddenLinePatterns.some((pattern) => pattern.test(line)));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeEventDetailText(value) {
  const raw = normalizeLegacyText(value).replace(/\r/g, "\n");
  if (!raw) return "";
  const tokenBlockedPatterns = [
    /(?:المصدر|source)\s*[:：]/i,
    /(?:url|link|expanded_url|external_url|canonical_url|source_url|tweet_url|post_url)\s*[:=]/i,
    /(?:video(?:_url)?|image(?:_url)?|photo|media)\s*[:=]/i,
    /(?:source_name|source_type)\s*[:=]/i,
  ];
  const cleaned = raw
    .split("|")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => token.replace(/https?:\/\/\S+/gi, "").replace(/\bt\.co\/\S+/gi, "").trim())
    .filter((token) => token && !tokenBlockedPatterns.some((pattern) => pattern.test(token)))
    .join(" | ")
    .replace(/\(\s*(?:المصدر|source)\s*[:：][^)]+\)/gi, "")
    .replace(/\b(?:المصدر|source)\s*[:：][^|]+/gi, "")
    .replace(/[ ]{2,}/g, " ")
    .trim();
  return cleaned;
}

function confidenceBucketLabel(value) {
  const score = Number(value || 0);
  if (score >= 80) return "مرتفعة";
  if (score >= 60) return "متوسطة";
  return "منخفضة";
}

function aiVerdictBySeverity(level) {
  const value = Number(level || 0);
  if (value >= 5) return "أولوية حرجة";
  if (value >= 4) return "أولوية عالية";
  if (value === 3) return "مراقبة نشطة";
  if (value === 2) return "متابعة اعتيادية";
  return "خلفية معلوماتية";
}

function clampInt(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function aiLineKey(value) {
  return cleanText(String(value || ""))
    .toLowerCase()
    .replace(/[^\u0600-\u06FFa-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeAiLines(lines, exclude = []) {
  const blocked = new Set(exclude.map((item) => aiLineKey(item)).filter(Boolean));
  const out = [];
  const seen = new Set();
  for (const line of lines || []) {
    const clean = sanitizeEventDetailText(line);
    const key = aiLineKey(clean);
    if (!clean || !key || blocked.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function parseStructuredAiAssessment(value) {
  const text = normalizeLegacyText(value).replace(/\r/g, "\n");
  if (!text.trim()) {
    return { summary: "", operationalImpact: "", actions: [], triggers: [], evidence: [] };
  }

  const promptLeakPatterns = [
    /^\s*(?:task|fields|output_schema|title|summary|details|source_type|relevance_score)\s*[:={]/i,
    /^\s*[{\[\]}",]+$/,
  ];
  const lines = text
    .split("\n")
    .map((line) => sanitizeEventDetailText(line))
    .map((line) => line.replace(/^[•\-–—]+\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !promptLeakPatterns.some((pattern) => pattern.test(line)));

  const out = { summary: "", operationalImpact: "", actions: [], triggers: [], evidence: [] };
  for (const line of lines) {
    let match = line.match(/^(?:خلاصة|الملخص|summary)\s*[:：-]\s*(.+)$/i);
    if (match) {
      if (!out.summary) out.summary = sanitizeEventDetailText(match[1]);
      continue;
    }
    match = line.match(/^(?:أثر\s*تشغيلي|الأثر\s*التشغيلي|operational impact)\s*[:：-]\s*(.+)$/i);
    if (match) {
      if (!out.operationalImpact) out.operationalImpact = sanitizeEventDetailText(match[1]);
      continue;
    }
    match = line.match(/^(?:اقتراح(?:ات)?|إجراء(?:ات)?|action(?:s)?)\s*[:：-]\s*(.+)$/i);
    if (match) {
      out.actions.push(match[1]);
      continue;
    }
    match = line.match(/^(?:مؤشر(?:ات)?\s*تصعيد|trigger(?:s)?)\s*[:：-]\s*(.+)$/i);
    if (match) {
      out.triggers.push(match[1]);
      continue;
    }
    match = line.match(/^(?:دليل|أدلة|evidence)\s*[:：-]\s*(.+)$/i);
    if (match) {
      out.evidence.push(match[1]);
      continue;
    }
  }

  out.actions = dedupeAiLines(out.actions).slice(0, 4);
  out.triggers = dedupeAiLines(out.triggers).slice(0, 4);
  out.evidence = dedupeAiLines(out.evidence).slice(0, 4);
  return out;
}

function buildAiActionSuggestions(row) {
  const sourceType = String(row?.source_type || "").toLowerCase();
  const severity = Number(row?.severity || 0);
  if (sourceType === "flight") {
    return [
      "فوري (0-2 ساعة): تأكيد حالة المسارات المرتبطة بالإمارات ورصد أي تغيّر مفاجئ في الإقلاع/الهبوط.",
      "قصير (2-12 ساعة): مراجعة نمط الرحلات (قادمة/مغادرة) وتحديد أي انحراف عن المعدل التشغيلي المعتاد.",
      "متابعة (12-24 ساعة): تجهيز بدائل تشغيلية للمسارات الحساسة عند تكرار نفس الإشارة.",
    ];
  }
  if (sourceType === "marine") {
    return [
      "فوري (0-2 ساعة): مراجعة حركة السفن قرب الممرات الحيوية والموانئ ذات الحساسية العالية.",
      "قصير (2-12 ساعة): تحديث مسارات السفن المعرضة للمخاطر وتأكيد نقاط العبور الآمنة.",
      "متابعة (12-24 ساعة): تحليل نمط التكدس/التحويل في الموانئ وربطه بخطط الاستمرارية.",
    ];
  }
  if (sourceType === "cyber") {
    return [
      "فوري (0-2 ساعة): تفعيل مراقبة أمنية مركزة على الأنظمة الحرجة وربطها بإنذارات فورية.",
      "قصير (2-12 ساعة): مراجعة الثغرات المحتملة وسجل المحاولات غير الاعتيادية.",
      "متابعة (12-24 ساعة): تحديث ضوابط الوقاية وخطة الاستجابة وفق التهديدات الجديدة.",
    ];
  }
  if (severity >= 4) {
    return [
      "فوري (0-2 ساعة): التحقق من الدقة عبر مصادر موثوقة متعددة وتثبيت المعلومة التشغيلية الأساسية.",
      "قصير (2-12 ساعة): مواءمة قرار التشغيل مع الأدلة الأحدث ومنع ردود الفعل غير المؤكدة.",
      "متابعة (12-24 ساعة): إعادة تقييم المخاطر بشكل دوري مع كل تحديث جوهري في نفس السياق.",
    ];
  }
  return [
    "فوري (0-2 ساعة): المتابعة الهادئة للحدث دون تصعيد تشغيلي.",
    "قصير (2-12 ساعة): التأكد من استمرار نفس الاتجاه وعدم ظهور مؤشرات تصعيد.",
    "متابعة (12-24 ساعة): إبقاء الحدث ضمن الرصد الخلفي مع التحديث عند تغيّر النمط.",
  ];
}

function buildAiEscalationTriggers(row) {
  const sourceType = String(row?.source_type || "").toLowerCase();
  const base = [
    "ظهور تأكيد رسمي جديد يغيّر التقييم الحالي.",
    "تكرار نفس النمط عبر أكثر من حدث خلال نافذة زمنية قصيرة.",
  ];
  if (sourceType === "flight") {
    base.push("تحول مفاجئ في اتجاه الرحلات (انخفاض حاد/إلغاء/تحويل مسارات واسعة).");
  } else if (sourceType === "marine") {
    base.push("رصد اضطراب ملاحي مستمر قرب الممرات الحيوية أو الموانئ الرئيسية.");
  } else if (sourceType === "cyber") {
    base.push("انتقال النشاط السيبراني من محاولات رصد إلى تأثير تشغيلي مباشر.");
  } else {
    base.push("انتقال الحدث من خبر منفرد إلى سلسلة أحداث مرتبطة بنفس الموضوع.");
  }
  return base.slice(0, 3);
}

function buildAiMissingInfo(row) {
  const detailsMap = new Map(parseDetailsTokens(row?.details));
  const missing = [];
  if (!cleanText(row?.location) && (row?.latitude == null || row?.longitude == null)) {
    missing.push("الموقع الدقيق للحدث غير متوفر.");
  }
  if (!cleanText(row?.summary)) {
    missing.push("ملخص تحليلي موحّد غير متوفر.");
  }
  if (String(row?.source_type || "").toLowerCase() === "flight") {
    if (!detailsMap.get("from_country") && !detailsMap.get("orig_iata") && !detailsMap.get("orig_icao")) {
      missing.push("بيانات منشأ الرحلة غير مكتملة.");
    }
    if (!detailsMap.get("to_country") && !detailsMap.get("dest_iata") && !detailsMap.get("dest_icao")) {
      missing.push("بيانات وجهة الرحلة غير مكتملة.");
    }
  }
  if (String(row?.source_type || "").toLowerCase() === "marine") {
    if (!detailsMap.get("from_port") && !detailsMap.get("to_port")) {
      missing.push("بيانات الموانئ المرتبطة بالحركة غير واضحة.");
    }
  }
  return missing.slice(0, 3);
}

function pickBriefSentence(value) {
  const text = sanitizeEventDetailText(value);
  if (!text) return "";
  const sentence = text
    .split(/[\n.!؟؛]+/)
    .map((part) => part.trim())
    .find(Boolean);
  if (!sentence) return text.slice(0, 180);
  return sentence.length > 180 ? `${sentence.slice(0, 177)}...` : sentence;
}

function countSignalHits(text, patterns) {
  const source = cleanText(text).toLowerCase();
  if (!source) return 0;
  return patterns.reduce((sum, pattern) => {
    pattern.lastIndex = 0;
    const found = source.match(pattern);
    return sum + (found ? found.length : 0);
  }, 0);
}

function buildAiImpactBalance(row, operationalSummary) {
  const sourceType = String(row?.source_type || "").toLowerCase();
  const severity = Number(row?.severity || 0);
  const text = [row?.title, row?.summary, row?.details, row?.ai_assessment, operationalSummary].filter(Boolean).join(" ");

  const positivePatterns = [
    /تهدئ(?:ة|ات)/g,
    /احتواء/g,
    /تعزيز/g,
    /استقرار/g,
    /تنسيق/g,
    /دعم/g,
    /نجاح/g,
    /حماية/g,
    /خفض(?:\s+)?التوتر/g,
    /agreement|de-escalat|stabil|contain|support|protect/g,
  ];
  const negativePatterns = [
    /هجوم/g,
    /تصعيد/g,
    /استهداف/g,
    /إصابات|اصابات/g,
    /وفيات|قتلى|ضحايا/g,
    /تهديد/g,
    /إغلاق|اغلاق/g,
    /تعطل|تعطيل/g,
    /اختراق/g,
    /توتر/g,
    /attack|escalat|threat|strike|casualt|injur|disrupt|closure/g,
  ];

  const positiveHits = countSignalHits(text, positivePatterns);
  const negativeHits = countSignalHits(text, negativePatterns);
  const brief = pickBriefSentence(row?.summary || row?.title || operationalSummary) || "قراءة مختصرة غير متوفرة.";

  let potentialBenefit = "يدعم تحسين الوعي المبكر واتخاذ قرار تشغيلي أسرع عند ظهور إشارات مؤكدة.";
  let potentialRisk = "قد يسبب ضغطًا تشغيليًا إضافيًا إذا تكرر الحدث أو ارتفعت شدته خلال نافذة قصيرة.";
  if (sourceType === "flight") {
    potentialBenefit = "يفيد في تحسين إدارة الحركة الجوية وتحديد المسارات الأكثر استقرارًا.";
    potentialRisk = "قد ينعكس على انتظام الرحلات إذا ظهرت مؤشرات تحويل/إلغاء متتابعة.";
  } else if (sourceType === "marine") {
    potentialBenefit = "يساعد على تأمين الممرات البحرية وتحديث أولويات العبور للموانئ الحساسة.";
    potentialRisk = "قد يرفع مخاطر التأخير أو التحويل الملاحي عند استمرار المؤشرات السلبية.";
  } else if (sourceType === "cyber") {
    potentialBenefit = "يعزز الاستجابة الوقائية المبكرة للأنظمة الحرجة.";
    potentialRisk = "قد يتطور إلى أثر تشغيلي مباشر إذا تحولت المؤشرات إلى اختراق فعلي.";
  }

  let netImpact = "المحصلة التشغيلية: أثر متوازن يحتاج متابعة دورية.";
  if (severity >= 4 || negativeHits > positiveHits + 1) {
    netImpact = "المحصلة التشغيلية: يميل الأثر حاليًا إلى السلبية ويتطلب تشديد المراقبة.";
  } else if (positiveHits > negativeHits + 1 && severity <= 2) {
    netImpact = "المحصلة التشغيلية: الأثر أقرب للإيجابي مع استمرار المراقبة بدون تصعيد.";
  }

  return { brief, potentialBenefit, potentialRisk, netImpact, positiveHits, negativeHits };
}

function aiLaneLabel(lane) {
  if (lane === "air") return "جوي";
  if (lane === "marine") return "بحري";
  if (lane === "cyber") return "سيبراني";
  return "جيوسياسي";
}

function pickActionByWindow(lines, matcher, fallback = "") {
  const match = (lines || []).find((line) => matcher.test(cleanText(line)));
  return match || fallback;
}

function buildAiEvidenceRows(candidates, exclude = []) {
  const blocked = new Set(exclude.map((item) => aiLineKey(item)).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const candidate of candidates || []) {
    const rows = toStructuredReadableBullets(candidate);
    for (const row of rows) {
      const text = sanitizeEventDetailText(row?.text || row);
      const source = sanitizeEventDetailText(row?.source || "");
      const key = aiLineKey(text);
      if (!text || !key || blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ text, source });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function buildAiDecisionOptions(sourceType, severity, countryLabel) {
  const place = countryLabel || "النطاق";
  const options = [
    {
      id: "A",
      title: "مراقبة محافظة",
      detail: `إبقاء الحالة في رصد خلفي داخل ${place} مع تحديث كل دورة دون تغيير تشغيلي كبير.`
    },
    {
      id: "B",
      title: "احتواء تشغيلي",
      detail: `تعديل محدود في التشغيل داخل ${place} (مسارات/أولويات/جاهزية) مع مراجعة مستمرة للبيانات.`
    },
    {
      id: "C",
      title: "رفع الجاهزية",
      detail: `إجراءات وقائية أعلى داخل ${place} واستدعاء تنسيق متعدد الجهات إذا استمر الضغط التصاعدي.`
    },
  ];
  if (sourceType === "flight") {
    options[1].detail = `إعادة توزيع مسارات الرحلات المرتبطة بـ${place} وتفعيل خطة استمرارية للمطارات الحساسة.`;
    options[2].detail = `رفع جاهزية غرف الطيران والملاحة فورًا في ${place} عند أي موجة تحويل/إلغاء متتابعة.`;
  } else if (sourceType === "marine") {
    options[1].detail = `تحديث مسارات العبور البحري في ${place} مع تشديد تدقيق الموانئ ونقاط الاختناق.`;
    options[2].detail = `تفعيل ممرات بديلة وقيود عبور وقائية في ${place} عند مؤشرات تهديد ملاحي متكرر.`;
  } else if (sourceType === "cyber") {
    options[1].detail = `رفع مستوى الرصد الدفاعي للأنظمة الحرجة في ${place} مع تدقيق سجل الأنشطة غير الاعتيادية.`;
    options[2].detail = `تفعيل إجراءات عزل واحتواء متقدمة في ${place} عند مؤشرات تأثير تشغيلي مباشر.`;
  }

  const recommendedId = severity >= 4 ? "C" : severity >= 3 ? "B" : "A";
  return { options, recommendedId };
}

function buildAiThresholds(sourceType) {
  const common = [
    "تكرار إشارات شدة S4 أو أعلى مرتين خلال 90 دقيقة.",
    "ظهور تأكيد رسمي يناقض التقييم الحالي أو يضيف رقمًا مؤكدًا جديدًا.",
  ];
  if (sourceType === "flight") {
    return [
      ...common,
      "انخفاض/ارتفاع حركة الرحلات المرتبطة بالدولة بأكثر من 20% خلال ساعة.",
      "تكرار تحويل أو إلغاء 3 رحلات فأكثر على نفس المسار خلال نافذة قصيرة.",
    ];
  }
  if (sourceType === "marine") {
    return [
      ...common,
      "تحويل مسار 3 سفن أو أكثر قرب ممر حيوي خلال 120 دقيقة.",
      "توقف أو تأخير ملاحي متتابع في ميناء رئيسي مرتبط بنفس الحدث.",
    ];
  }
  if (sourceType === "cyber") {
    return [
      ...common,
      "انتقال التهديد من مرحلة استكشاف إلى تأثير فعلي على خدمة تشغيلية.",
      "تكرار إنذارات متشابهة عبر أكثر من نظام حرج خلال ساعتين.",
    ];
  }
  return [
    ...common,
    "انتقال الحدث من خبر منفرد إلى سلسلة أحداث مترابطة بنفس الموضوع.",
  ];
}

function eventTimeMs(row) {
  return parsePossiblyDate(eventDisplayTime(row))?.getTime() ?? 0;
}

function impactLevelLabel(score) {
  const value = Number(score || 0);
  if (value >= 70) return "عال";
  if (value >= 45) return "متوسط";
  return "منخفض";
}

function keywordBoost(text, patterns, score) {
  const src = cleanText(text).toLowerCase();
  if (!src) return 0;
  return patterns.some((pattern) => pattern.test(src)) ? score : 0;
}

function clampScore(value) {
  return clampInt(value, 0, 100);
}

function buildUaeImpactRows(row, sourceType, severity, impact) {
  const text = [row?.title, row?.summary, row?.details, row?.ai_assessment].filter(Boolean).join(" ");
  const base = 18 + severity * 10;

  const security = clampScore(
    base +
      keywordBoost(text, [/هجوم|استهداف|تهديد|attack|strike|missile|drone|injur|casualt|وفيات|إصابات/i], 24) +
      keywordBoost(text, [/إمارات|الامارات|uae|abudhabi|dubai/i], 8)
  );
  const diplomacy = clampScore(
    base - 3 +
      keywordBoost(text, [/تصريح|بيان|مفاوض|قم[ةه]|diplom|minister|foreign|policy|قانون/i], 26) +
      keywordBoost(text, [/gulf|gcc|الخليج/i], 6)
  );
  const aviation = clampScore(
    base - 6 +
      (sourceType === "flight" ? 30 : 0) +
      keywordBoost(text, [/طيران|مطار|مجال جوي|flight|airspace|airport|route|cancel|divert/i], 24)
  );
  const marine = clampScore(
    base - 8 +
      (sourceType === "marine" ? 30 : 0) +
      keywordBoost(text, [/بحر|ميناء|سفينة|ملاحة|marine|maritime|port|vessel|shipping|tanker/i], 26)
  );
  const economy = clampScore(
    base - 8 +
      keywordBoost(text, [/اقتصاد|سوق|نفط|تجارة|تأمين|cost|market|oil|trade|logistics|supply/i], 22) +
      Math.max(0, impact?.negativeHits || 0) * 2
  );

  return [
    { axis: "الأمن الداخلي", score: security, why: "يرتبط بمستوى التهديد المباشر واحتمال انتقاله لنطاق داخلي." },
    { axis: "الدبلوماسية", score: diplomacy, why: "يقيس الضغط السياسي على تحركات الدولة ورسائلها الرسمية." },
    { axis: "الطيران", score: aviation, why: "يعكس احتمالية تغير التشغيل الجوي أو المسارات أو وتيرة الرحلات." },
    { axis: "الملاحة", score: marine, why: "يقيس أثر الخبر على مسارات العبور البحري والموانئ." },
    { axis: "الاقتصاد", score: economy, why: "يرصد الأثر غير المباشر على السوق والتكلفة التشغيلية." },
  ];
}

function buildGulfImpactRows(row, sourceType, severity, impact) {
  const text = [row?.title, row?.summary, row?.details, row?.ai_assessment].filter(Boolean).join(" ");
  const base = 20 + severity * 10;

  const cohesion = clampScore(
    base - 6 +
      keywordBoost(text, [/مجلس التعاون|gcc|الخليج|قمة|تنسيق|collective|joint/i], 20) -
      Math.max(0, impact?.negativeHits || 0) * 2
  );
  const transportPressure = clampScore(
    base +
      (sourceType === "flight" || sourceType === "marine" ? 18 : 0) +
      keywordBoost(text, [/طيران|مطار|مجال جوي|بحر|ميناء|route|shipping|airspace|port/i], 22)
  );
  const escalation = clampScore(
    base +
      keywordBoost(text, [/تصعيد|هجوم|تهديد|strike|escalat|attack|missile|drone|تحذير/i], 24) +
      Math.max(0, impact?.negativeHits || 0) * 3
  );

  return [
    { axis: "تماسك الموقف الخليجي", score: cohesion, why: "يرصد قدرة التنسيق السياسي الخليجي تحت الضغط." },
    { axis: "ضغط النقل الإقليمي", score: transportPressure, why: "يقيس احتمالية اضطراب الحركة الجوية/البحرية بين دول الخليج." },
    { axis: "احتمالية التصعيد السياسي", score: escalation, why: "يعكس احتمال انتقال الخطاب إلى قرار سياسي أو ميداني أعلى." },
  ];
}

function buildConfidenceReasons(row, confidence, evidenceRows, missingInfo) {
  const reasons = [];
  if (Number(row?.severity || 0) >= 4) {
    reasons.push("الحدث عالي الشدة؛ ما يرفع حساسية التقييم لكنه يزيد احتمال التغير السريع.");
  }
  if (Number(row?.relevance_score || 0) >= 0.7) {
    reasons.push("صلة الخبر عالية بنطاق المتابعة الحالي.");
  } else if (Number(row?.relevance_score || 0) <= 0.35) {
    reasons.push("صلة الخبر متوسطة/ضعيفة، لذلك تم تخفيض درجة اليقين.");
  }
  if (isTrustedEvent(row)) {
    reasons.push("المصدر ضمن النطاق الموثوق أو ذو نمط معلوماتي معتبر.");
  } else {
    reasons.push("المصدر غير رسمي بالكامل؛ يلزم تحقق إضافي قبل رفع القرار.");
  }
  if (evidenceRows.length >= 3) {
    reasons.push("توفر أدلة مختصرة كافية لبناء حكم تشغيلي أولي.");
  } else {
    reasons.push("عدد الأدلة المتاحة محدود؛ التقييم قابل للتعديل مع أي تأكيد جديد.");
  }
  if ((missingInfo || []).length > 0) {
    reasons.push("وجود بيانات ناقصة يقلل الثقة ويؤخر الانتقال لقرار أعلى.");
  }
  reasons.push(`درجة الثقة الحالية: ${confidence}% (${confidenceBucketLabel(confidence)}).`);
  return reasons.slice(0, 4);
}

function buildNoActionCost(sourceType, severity) {
  const high = severity >= 4;
  if (sourceType === "flight") {
    return {
      in6h: high
        ? "خلال 6 ساعات: احتمال ارتفاع الإلغاءات/التحويلات دون استعداد مبكر."
        : "خلال 6 ساعات: تزايد محدود في عدم اليقين التشغيلي للمسارات المرتبطة.",
      in24h: high
        ? "خلال 24 ساعة: اتساع الضغط على الحركة الجوية وخسارة كفاءة التشغيل."
        : "خلال 24 ساعة: قرارات متأخرة قد ترفع التكلفة التشغيلية دون مبرر.",
    };
  }
  if (sourceType === "marine") {
    return {
      in6h: high
        ? "خلال 6 ساعات: ارتفاع احتمال التكدس/التأخير في مسارات العبور الحساسة."
        : "خلال 6 ساعات: زيادة طفيفة في مخاطر التأخير الملاحي.",
      in24h: high
        ? "خلال 24 ساعة: تعطّل سلاسل بحرية مرتبطة وتكلفة أعلى على التوريد والتأمين."
        : "خلال 24 ساعة: تراكم تأخيرات تشغيلية مع أثر اقتصادي تدريجي.",
    };
  }
  return {
    in6h: high
      ? "خلال 6 ساعات: فقدان فرصة الاحتواء المبكر وارتفاع احتمالية القرار المتأخر."
      : "خلال 6 ساعات: توسع محدود في الضبابية التشغيلية إذا لم تتم المتابعة.",
    in24h: high
      ? "خلال 24 ساعة: انتقال الحدث إلى مستوى قرار أعلى بتكلفة تنسيق أكبر."
      : "خلال 24 ساعة: زيادة ضغط المتابعة على الفرق بدون تحسن نوعي في الرؤية.",
  };
}

function getPreviousStoryRow(row, candidateRows) {
  const rows = Array.isArray(candidateRows) ? candidateRows : [];
  const currentKey = eventStoryDedupKey(row);
  const currentTs = eventTimeMs(row);
  return rows
    .filter((item) => item?.id !== row?.id && eventStoryDedupKey(item) === currentKey)
    .filter((item) => eventTimeMs(item) < currentTs)
    .sort((a, b) => eventTimeMs(b) - eventTimeMs(a))[0];
}

function buildWhatsNewLine(row, candidateRows, previous = null) {
  const prev = previous || getPreviousStoryRow(row, candidateRows);

  if (!prev) {
    return "لا يوجد تحديث سابق مطابق داخل نفس القصة؛ هذا أول إدخال مرصود في النافذة الحالية.";
  }

  const prevSeverity = Number(prev?.severity || 0);
  const currSeverity = Number(row?.severity || 0);
  if (currSeverity > prevSeverity) {
    return `جديد: ارتفعت الشدة من S${prevSeverity} إلى S${currSeverity} مقارنةً بآخر تحديث مشابه.`;
  }
  if (currSeverity < prevSeverity) {
    return `جديد: انخفضت الشدة من S${prevSeverity} إلى S${currSeverity} مقارنةً بآخر تحديث مشابه.`;
  }
  const prevSummary = aiLineKey(prev?.summary || prev?.title || "");
  const currSummary = aiLineKey(row?.summary || row?.title || "");
  if (prevSummary !== currSummary) {
    return "جديد: المعلومة الأساسية محدثة بصياغة مختلفة دون تغيير واضح في مستوى الشدة.";
  }
  return "لا تغير جوهري منذ آخر تحديث مشابه؛ المتابعة مطلوبة فقط عند ظهور دليل جديد.";
}

function buildPoliticalReading(row, sourceType, severity, impact, scopeLabel) {
  const laneLabel = aiLaneLabel(eventLane(row));
  const lines = [];
  lines.push(`قراءة المجال: الحدث ضمن مسار ${laneLabel} (${scopeLabel}).`);

  if (severity >= 4 || (impact?.negativeHits || 0) > (impact?.positiveHits || 0) + 1) {
    lines.push("القراءة السياسية: الإشارات الحالية تميل لرفع الضغط السياسي/التشغيلي أكثر من كونها خبرًا عابرًا.");
  } else {
    lines.push("القراءة السياسية: الحدث أقرب إلى ضغط إعلامي/سياسي قابل للاحتواء ما لم تظهر مؤشرات ميدانية مؤكدة.");
  }

  if (sourceType === "flight") {
    lines.push("تأثير القرار السياسي يظهر سريعًا في الطيران عبر المسارات والقيود الوقائية.");
  } else if (sourceType === "marine") {
    lines.push("تأثير القرار السياسي يظهر في الملاحة عبر المسارات البحرية وأولوية العبور.");
  } else if (sourceType === "cyber") {
    lines.push("تأثير القرار السياسي يظهر عبر قواعد الاستجابة الرقمية وحماية البنية الحساسة.");
  } else {
    lines.push("تأثيره المرجح سياسي-إقليمي، ويحتاج ربطًا مباشرًا مع إشارات تشغيل فعلية قبل التصعيد.");
  }
  return lines.slice(0, 3);
}

function buildAiAssessmentView(row, candidateRows = []) {
  if (!row) {
    return {
      verdict: "غير متاح",
      confidence: 0,
      confidenceLabel: "منخفضة",
      operationalSummary: "لا توجد بيانات كافية لبناء تقييم تشغيلي.",
      evidence: [],
      evidenceRows: [],
      actions: [],
      triggers: [],
      missingInfo: [],
      scopeLabel: "غير متاح",
      whyItMatters: "لا يوجد سياق كافٍ.",
      actionNow: "لا يوجد إجراء فوري متاح.",
      actionNext: "لا يوجد إجراء قصير المدى متاح.",
      actionFollow: "لا يوجد إجراء متابعة متاح.",
      scenario6h: "لا يوجد سيناريو متاح.",
      scenario24h: "لا يوجد سيناريو متاح.",
      decisionOptions: [],
      recommendedDecisionId: "",
      thresholds: [],
      contradictions: [],
      impactVector: [],
      whatsNew: "لا يوجد.",
      politicalReading: [],
      uaeImpactRows: [],
      gulfImpactRows: [],
      confidenceReasons: [],
      noActionCost: { in6h: "", in24h: "" },
      sectionDelta: {
        summary: false,
        political: false,
        impact: false,
        decision: false,
        triggers: false,
        confidence: false,
        evidence: false,
      },
    };
  }

  const severity = Number(row.severity || 0);
  const relevance = Number(row.relevance_score || 0);
  const parsedAi = parseStructuredAiAssessment(row.ai_assessment);
  const assessment = sanitizeEventDetailText(row.ai_assessment);
  const summary = sanitizeEventDetailText(row.summary || row.details);
  const title = sanitizeEventDetailText(row.title);
  const operationalSummary = parsedAi.summary || assessment || summary || title || "لا يوجد وصف تشغيلي كافٍ.";
  const evidenceRows = buildAiEvidenceRows([...parsedAi.evidence, summary, title], [operationalSummary, parsedAi.operationalImpact]).slice(
    0,
    4
  );
  const evidence = evidenceRows.map((item) => item.text);

  let confidenceRaw = 42 + relevance * 28 + severity * 6;
  if (assessment) confidenceRaw += 8;
  if (summary) confidenceRaw += 6;
  if (row.latitude != null && row.longitude != null) confidenceRaw += 4;
  const confidence = clampInt(confidenceRaw, 35, 96);
  const impact = buildAiImpactBalance(row, parsedAi.operationalImpact || operationalSummary);
  if (parsedAi.operationalImpact) {
    impact.netImpact = `المحصلة التشغيلية: ${parsedAi.operationalImpact}`;
  }
  const actions = dedupeAiLines(
    parsedAi.actions.length > 0 ? parsedAi.actions : buildAiActionSuggestions(row),
    [operationalSummary]
  );
  const triggers = dedupeAiLines(
    parsedAi.triggers.length > 0 ? parsedAi.triggers : buildAiEscalationTriggers(row),
    [operationalSummary]
  );
  const missingInfo = buildAiMissingInfo(row);
  const sourceType = String(row?.source_type || "").toLowerCase();
  const lane = eventLane(row);
  const laneLabel = aiLaneLabel(lane);
  const transport = parseTransportContext(row);
  const detailsMap = new Map(parseDetailsTokens(row?.details));
  const countryLabel =
    normalizeTransportValue(
      transport.toCountry ||
        transport.fromCountry ||
        detailsMap.get("country") ||
        detailsMap.get("country_name") ||
        detailsMap.get("country_code") ||
        row?.location
    ) || "النطاق الإقليمي";

  const routeHint =
    sourceType === "flight" || sourceType === "marine"
      ? routeArrowSummary(
          transport.fromCountry || transport.fromPort || "غير محدد",
          transport.toCountry || transport.toPort || "غير محدد"
        )
      : "";
  const scopeLabel = routeHint ? `${laneLabel} | ${countryLabel} | ${routeHint}` : `${laneLabel} | ${countryLabel}`;

  let whyItMatters = impact.netImpact;
  if (sourceType === "flight") {
    whyItMatters = `الخبر مرتبط بحركة الطيران (${routeHint || "مسار غير مكتمل"}) وقد يغيّر كثافة الرحلات القادمة/المغادرة خلال نافذة قصيرة.`;
  } else if (sourceType === "marine") {
    whyItMatters = `الخبر مرتبط بحركة الملاحة (${routeHint || "مسار غير مكتمل"}) ويؤثر على استمرارية العبور والموانئ الحساسة.`;
  } else if (sourceType === "cyber") {
    whyItMatters = "الخبر يمس استقرار الأنظمة الحساسة، وتأخر الاستجابة قد يحول الإشارة إلى أثر تشغيلي مباشر.";
  } else if (severity >= 4) {
    whyItMatters = "شدة الحدث مرتفعة وتكراره المحتمل يفرض قرارًا تشغيليًا مبكرًا بدل الانتظار حتى تتوسع الدائرة.";
  }

  const actionNow =
    pickActionByWindow(actions, /(0-2|فوري|عاجل|الآن)/i, "") ||
    "التحقق الفوري من أحدث دليل موثوق قبل أي قرار تشغيلي.";
  const actionNext =
    pickActionByWindow(actions, /(2-12|قصير|خلال\s*12)/i, "") ||
    "مراجعة الاتجاه خلال الساعات القادمة وربط القرار بتغير الشدة والنطاق.";
  const actionFollow =
    pickActionByWindow(actions, /(12-24|24|متابعة)/i, "") ||
    "تحديث خطة التشغيل كل دورة عند ظهور دليل أقوى أو تغير نمط الحدث.";

  const scenario6h =
    severity >= 4 || impact.negativeHits > impact.positiveHits
      ? "احتمال استمرار ضغط تشغيلي قصير المدى مع حاجة لتعديل ميداني محدود."
      : "مرجح بقاء الحدث في نطاق المتابعة بدون تصعيد تشغيلي واسع.";
  const scenario24h =
    severity >= 4
      ? "إذا استمر نفس النمط، قد تنتقل الحالة إلى مستوى قرار أعلى متعدد الجهات خلال 24 ساعة."
      : "إذا لم تظهر إشارات جديدة قوية، يبقى الحدث ضمن الرصد الخلفي مع تحديث دوري.";

  const { options: decisionOptions, recommendedId: recommendedDecisionId } = buildAiDecisionOptions(sourceType, severity, countryLabel);
  const thresholds = buildAiThresholds(sourceType);
  const contradictions = dedupeAiLines(
    [
      ...missingInfo,
      impact.negativeHits > 0 && impact.positiveHits > 0
        ? "توجد إشارات إيجابية وسلبية متزامنة؛ يلزم فصل المؤكد عن غير المؤكد قبل رفع المستوى."
        : "",
      evidenceRows.length < 2 ? "عدد الأدلة المختصرة محدود؛ يلزم توسيع مصادر التحقق قبل التوصية النهائية." : "",
    ].filter(Boolean)
  );

  const impactVector = [
    {
      label: "ضغط المخاطر",
      value: clampInt(32 + severity * 11 + impact.negativeHits * 6 - impact.positiveHits * 2, 0, 100),
      note: "كلما ارتفع الرقم، زادت الحاجة لضبط تشغيلي."
    },
    {
      label: "استقرار التشغيل",
      value: clampInt(74 + impact.positiveHits * 5 - severity * 8 - impact.negativeHits * 4, 0, 100),
      note: "كلما ارتفع الرقم، كانت الاستمرارية أفضل."
    },
    {
      label: "تقلب المشهد",
      value: clampInt(28 + Math.max(0, impact.negativeHits - impact.positiveHits) * 10 + severity * 7, 0, 100),
      note: "ارتفاعه يعني أن التقييم قد يتغير بسرعة."
    },
  ];
  const previousRow = getPreviousStoryRow(row, candidateRows);
  const whatsNew = buildWhatsNewLine(row, candidateRows, previousRow);
  const politicalReading = buildPoliticalReading(row, sourceType, severity, impact, scopeLabel);
  const uaeImpactRows = buildUaeImpactRows(row, sourceType, severity, impact);
  const gulfImpactRows = buildGulfImpactRows(row, sourceType, severity, impact);
  const confidenceReasons = buildConfidenceReasons(row, confidence, evidenceRows, missingInfo);
  const noActionCost = buildNoActionCost(sourceType, severity);
  const previousSummaryKey = aiLineKey(sanitizeEventDetailText(previousRow?.summary || previousRow?.details || previousRow?.title || ""));
  const currentSummaryKey = aiLineKey(summary || title || operationalSummary);
  const previousSeverity = Number(previousRow?.severity || 0);
  const hasCoreChange = !previousRow || previousSummaryKey !== currentSummaryKey || previousSeverity !== severity;
  const sectionDelta = {
    summary: hasCoreChange,
    political: hasCoreChange || sourceType !== String(previousRow?.source_type || "").toLowerCase(),
    impact: hasCoreChange || Math.abs((impact?.negativeHits || 0) - (impact?.positiveHits || 0)) > 0,
    decision: !previousRow || previousSeverity !== severity,
    triggers: hasCoreChange,
    confidence: !previousRow || Math.abs(confidence - clampInt(42 + Number(previousRow?.relevance_score || 0) * 28 + previousSeverity * 6, 35, 96)) >= 4,
    evidence: !previousRow || evidenceRows.length !== 0,
  };

  return {
    verdict: aiVerdictBySeverity(severity),
    confidence,
    confidenceLabel: confidenceBucketLabel(confidence),
    operationalSummary,
    evidence,
    evidenceRows,
    actions,
    triggers,
    missingInfo,
    impact,
    scopeLabel,
    whyItMatters,
    actionNow,
    actionNext,
    actionFollow,
    scenario6h,
    scenario24h,
    decisionOptions,
    recommendedDecisionId,
    thresholds,
    contradictions,
    impactVector,
    whatsNew,
    politicalReading,
    uaeImpactRows,
    gulfImpactRows,
    confidenceReasons,
    noActionCost,
    sectionDelta,
  };
}

function predictionWindowLabel(row) {
  const rawHours = Number(row?.window_hours);
  if (Number.isFinite(rawHours) && rawHours >= 0) {
    if (rawHours === 0) return "كامل الفترة";
    if (rawHours % 24 === 0) {
      const days = Math.max(1, Math.round(rawHours / 24));
      if (days === 1) return "آخر 24 ساعة";
      return `آخر ${days} أيام`;
    }
    return `آخر ${rawHours} ساعة`;
  }
  const fallback = normalizeLegacyText(row?.window_label || row?.window || "");
  if (!fallback || isLikelyMojibake(fallback) || fallback.length > 40) return "نافذة التقييم";
  return fallback || "نافذة التقييم";
}

function isLegacyHistoryRow(row) {
  const joined = [row?.title, row?.prompt, row?.content].map((x) => String(x || "")).join(" ");
  return /war_focus/i.test(joined);
}

function byCreatedAtDesc(a, b) {
  const aTs = parsePossiblyDate(a?.created_at || 0)?.getTime() ?? 0;
  const bTs = parsePossiblyDate(b?.created_at || 0)?.getTime() ?? 0;
  const aSafe = Number.isNaN(aTs) ? 0 : aTs;
  const bSafe = Number.isNaN(bTs) ? 0 : bTs;
  return bSafe - aSafe;
}

function byDateDesc(aDateValue, bDateValue) {
  const aTs = parsePossiblyDate(aDateValue || 0)?.getTime() ?? 0;
  const bTs = parsePossiblyDate(bDateValue || 0)?.getTime() ?? 0;
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
    const ts = parsePossiblyDate(row.event_time)?.getTime() ?? Number.NaN;
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
  const [jsonCargoStatus, setJsonCargoStatus] = useState({
    configured: false,
    state: "unknown",
    message: "Checking...",
    detail: null,
    status_code: null,
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
  const [newsWindowHours, setNewsWindowHours] = useState(String(DEFAULT_NEWS_WINDOW_HOURS));

  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [sourcePage, setSourcePage] = useState(1);
  const [sourceForm, setSourceForm] = useState(initialSourceForm);

  const [leftTab, setLeftTab] = useState("feed");
  const [feedPage, setFeedPage] = useState(1);
  const [alertsPage, setAlertsPage] = useState(1);
  const [focusedEventId, setFocusedEventId] = useState(null);
  const [focusedAlertId, setFocusedAlertId] = useState(null);
  const [selectedEventIds, setSelectedEventIds] = useState([]);
  const [selectedAlertIds, setSelectedAlertIds] = useState([]);
  const [selectedVideoSourceId, setSelectedVideoSourceId] = useState(skyVideoSources[0]?.id || "");
  const [videoEmbedIndexBySource, setVideoEmbedIndexBySource] = useState({});
  const [versionTab, setVersionTab] = useState("v2");
  const [aiTab, setAiTab] = useState("chat");
  const [aiViewMode, setAiViewMode] = useState("exec");
  const [predictionViewMode, setPredictionViewMode] = useState("exec");
  const [v2Lane, setV2Lane] = useState("all");
  const [v2UnreadOnly, setV2UnreadOnly] = useState(false);
  const [v2TrustedOnly, setV2TrustedOnly] = useState(true);
  const [v2FocusedEventId, setV2FocusedEventId] = useState(null);
  const [v2SelectedEventIds, setV2SelectedEventIds] = useState([]);
  const [v2OpsWindowHours, setV2OpsWindowHours] = useState(6);
  const [v2OpsLayers, setV2OpsLayers] = useState({ air: true, marine: true, threats: true });
  const [v2OpsFocusPointId, setV2OpsFocusPointId] = useState(null);
  const [v2OpsHoveredPointId, setV2OpsHoveredPointId] = useState(null);
  const [v2ThreatCountry, setV2ThreatCountry] = useState(threatCountryDefs[0]?.country || "UAE");
  const [predictionTickets, setPredictionTickets] = useState([]);
  const [predictionUpdates, setPredictionUpdates] = useState([]);
  const [seenPredictionUpdateIds, setSeenPredictionUpdateIds] = useState([]);
  const [workspaceEvidenceRows, setWorkspaceEvidenceRows] = useState({});
  const [predictionWorkspaces, setPredictionWorkspaces] = useState(() => [makePredictionWorkspace("ws-1", 1)]);
  const [activePredictionWorkspaceId, setActivePredictionWorkspaceId] = useState("ws-1");
  const [predictionLeaderboard, setPredictionLeaderboard] = useState([]);
  const [predictionReviewConfig, setPredictionReviewConfig] = useState({
    enabled: false,
    review_seconds: 600,
    min_interval_minutes: 10,
  });
  const [savingPredictionReviewConfig, setSavingPredictionReviewConfig] = useState(false);
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
  const [v2SectionOpen, setV2SectionOpen] = useState({
    predictions: true,
    opsBoard: true,
    narrative: true,
    freshness: true,
    focus: true,
    storyStream: true,
  });
  const v2FocusPanelRef = useRef(null);
  const v2OpsBoardRef = useRef(null);
  const v2OpsMapContainerRef = useRef(null);
  const v2OpsLeafletMapRef = useRef(null);
  const v2OpsLeafletLayerRef = useRef(null);

  const loadAll = useCallback(async () => {
    try {
      const [
        eventsResp,
        alertsResp,
        sourcesResp,
        messagesResp,
        insightsResp,
        reportsResp,
        privacyResp,
        predictionsResp,
        leaderboardResp,
        predictionReviewConfigResp,
        jsonCargoStatusResp,
      ] =
        await Promise.all([
        apiGet("/events?limit=4000"),
        apiGet("/alerts?limit=200"),
        apiGet("/sources"),
        apiGet("/ai/messages?limit=120"),
        apiGet("/ai/insights?limit=80"),
        apiGet("/ai/reports?limit=40"),
        apiGet("/ai/privacy"),
        apiGet("/ai/predictions?limit=120").catch(() => []),
        apiGet("/ai/predictions/leaderboard").catch(() => []),
        apiGet("/ai/predictions/review-config").catch(() => null),
        apiGet("/sources/jsoncargo/status").catch(() => null),
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
      if (predictionReviewConfigResp && Number.isFinite(Number(predictionReviewConfigResp.review_seconds))) {
        setPredictionReviewConfig({
          enabled: Boolean(predictionReviewConfigResp.enabled),
          review_seconds: Number(predictionReviewConfigResp.review_seconds),
          min_interval_minutes: Number(predictionReviewConfigResp.min_interval_minutes || 10),
        });
      }
      if (jsonCargoStatusResp && typeof jsonCargoStatusResp === "object") {
        setJsonCargoStatus({
          configured: Boolean(jsonCargoStatusResp.configured),
          state: cleanText(jsonCargoStatusResp.state || "unknown").toLowerCase() || "unknown",
          message: cleanText(jsonCargoStatusResp.message || "Unavailable"),
          detail: cleanText(jsonCargoStatusResp.detail || ""),
          status_code: Number.isFinite(Number(jsonCargoStatusResp.status_code)) ? Number(jsonCargoStatusResp.status_code) : null,
        });
      }
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
    // Flight telemetry is handled in the operational map section, not the live news feed list.
    rows = rows.filter((r) => r.source_type !== "flight");
    if (sourceFilter !== "all") rows = rows.filter((r) => r.source_type === sourceFilter);
    if (severityFilter !== "all") rows = rows.filter((r) => r.severity === Number(severityFilter));
    if (!includePeople) rows = rows.filter((r) => r.source_type !== "social");
    rows = rows.filter((r) => isLiveFreshNews(r, Number(newsWindowHours || 24)));
    return rows;
  }, [sourceScopedEvents, sourceFilter, severityFilter, includePeople, newsWindowHours]);

  useEffect(() => {
    if (sourceFilter === "flight") setSourceFilter("all");
  }, [sourceFilter]);

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
  const sourceTotalPages = useMemo(() => Math.max(1, Math.ceil(sources.length / SOURCE_DRAWER_PAGE_SIZE)), [sources.length]);

  const visibleFeedEvents = useMemo(() => {
    const start = (feedPage - 1) * LIST_PAGE_SIZE;
    return sortedFilteredEvents.slice(start, start + LIST_PAGE_SIZE);
  }, [feedPage, sortedFilteredEvents]);

  const visibleAlerts = useMemo(() => {
    const start = (alertsPage - 1) * LIST_PAGE_SIZE;
    return sortedAlerts.slice(start, start + LIST_PAGE_SIZE);
  }, [alertsPage, sortedAlerts]);
  const visibleSources = useMemo(() => {
    const start = (sourcePage - 1) * SOURCE_DRAWER_PAGE_SIZE;
    return sources.slice(start, start + SOURCE_DRAWER_PAGE_SIZE);
  }, [sourcePage, sources]);

  const feedPageNumbers = useMemo(() => paginationWindow(feedPage, feedTotalPages), [feedPage, feedTotalPages]);
  const alertsPageNumbers = useMemo(() => paginationWindow(alertsPage, alertsTotalPages), [alertsPage, alertsTotalPages]);
  const sourcePageNumbers = useMemo(() => paginationWindow(sourcePage, sourceTotalPages), [sourcePage, sourceTotalPages]);
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
  const sourceRange = useMemo(() => {
    if (sources.length === 0) return { from: 0, to: 0 };
    const from = (sourcePage - 1) * SOURCE_DRAWER_PAGE_SIZE + 1;
    const to = Math.min(sourcePage * SOURCE_DRAWER_PAGE_SIZE, sources.length);
    return { from, to };
  }, [sourcePage, sources.length]);

  const eventsById = useMemo(() => {
    const map = new Map();
    for (const row of events) map.set(row.id, row);
    return map;
  }, [events]);

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
    setSourcePage((prev) => Math.min(Math.max(1, prev), sourceTotalPages));
  }, [sourceTotalPages]);

  useEffect(() => {
    if (sourceDrawerOpen) setSourcePage(1);
  }, [sourceDrawerOpen]);

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
  const safeV2OpsLayers = useMemo(() => {
    const raw = v2OpsLayers && typeof v2OpsLayers === "object" ? v2OpsLayers : {};
    return {
      air: raw.air !== false,
      marine: raw.marine !== false,
      threats: raw.threats !== false,
    };
  }, [v2OpsLayers]);

  function buildWorkspaceEventsPath(workspace, limit = 900) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    const range = resolveAnalysisDateRange(workspace);
    if (range.fromIso) params.set("event_time_from", range.fromIso);
    return `/events?${params.toString()}`;
  }

  useEffect(() => {
    if (!activePredictionWorkspace) return;
    const workspaceId = activePredictionWorkspace.id;
    const range = resolveAnalysisDateRange(activePredictionWorkspace);
    if (!range.hasRange) {
      setWorkspaceEvidenceRows((prev) => {
        if (!(workspaceId in prev)) return prev;
        const next = { ...prev };
        delete next[workspaceId];
        return next;
      });
      return;
    }
    const queryKey = `${range.fromIso}|${String(activePredictionWorkspace.country || "").trim()}`;
    let cancelled = false;
    setWorkspaceEvidenceRows((prev) => ({
      ...prev,
      [workspaceId]: {
        rows: Array.isArray(prev[workspaceId]?.rows) ? prev[workspaceId].rows : [],
        loading: true,
        queryKey,
      },
    }));
    async function run() {
      try {
        const rows = await apiGet(buildWorkspaceEventsPath(activePredictionWorkspace));
        if (cancelled) return;
        setWorkspaceEvidenceRows((prev) => ({
          ...prev,
          [workspaceId]: {
            rows: Array.isArray(rows) ? rows : [],
            loading: false,
            queryKey,
          },
        }));
      } catch {
        if (cancelled) return;
        setWorkspaceEvidenceRows((prev) => ({
          ...prev,
          [workspaceId]: {
            rows: [],
            loading: false,
            queryKey,
          },
        }));
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [
    activePredictionWorkspace?.id,
    activePredictionWorkspace?.analysisDateFrom,
    activePredictionWorkspace?.country,
  ]);

  const activeWorkspaceEvidence = useMemo(() => {
    if (!activePredictionWorkspace) return [];
    const range = resolveAnalysisDateRange(activePredictionWorkspace);
    const cached = workspaceEvidenceRows[activePredictionWorkspace.id];
    if (range.hasRange) {
      const rows = Array.isArray(cached?.rows) ? cached.rows : [];
      const localAll = events.filter((row) => eventInsideRange(row, range));
      if (rows.length === 0) return localAll;
      const merged = new Map();
      for (const row of localAll) {
        if (!row?.id) continue;
        merged.set(row.id, row);
      }
      for (const row of rows) {
        if (!row?.id) continue;
        if (!eventInsideRange(row, range)) continue;
        merged.set(row.id, row);
      }
      return [...merged.values()].sort((a, b) => byDateDesc(eventDisplayTime(a), eventDisplayTime(b)));
    }
    return events.filter((row) => eventInsideRange(row, range));
  }, [activePredictionWorkspace, events, workspaceEvidenceRows]);

  const activeWorkspaceFatalityStats = useMemo(
    () => deriveFatalityStats(activeWorkspaceEvidence, activePredictionWorkspace),
    [activeWorkspaceEvidence, activePredictionWorkspace]
  );

  const activeWorkspaceEvidenceById = useMemo(() => {
    const map = new Map();
    for (const row of activeWorkspaceEvidence || []) {
      if (!row?.id) continue;
      map.set(row.id, row);
    }
    return map;
  }, [activeWorkspaceEvidence]);

  async function resolveWorkspaceAnalysisEventIds(workspace, fallbackIds) {
    const seed = Array.isArray(fallbackIds) ? fallbackIds.filter((id) => Number.isInteger(id) && id > 0) : [];
    if (!workspace) return [...new Set(seed)];
    const range = resolveAnalysisDateRange(workspace);
    if (!range.hasRange) return [...new Set(seed)];
    const cachedRows = Array.isArray(workspaceEvidenceRows[workspace.id]?.rows) ? workspaceEvidenceRows[workspace.id].rows : null;
    let rows = cachedRows && cachedRows.length > 0 ? cachedRows : null;
    if (!rows) {
      try {
        rows = await apiGet(buildWorkspaceEventsPath(workspace));
      } catch {
        rows = [];
      }
    }
    const extra = Array.isArray(rows) ? rows.map((row) => row.id).filter((id) => Number.isInteger(id) && id > 0) : [];
    return [...new Set([...seed, ...extra])];
  }

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
      analysisDateFrom: "",
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

  const seenEventIdSet = useMemo(() => new Set(seenEventIds), [seenEventIds]);
  const seenPredictionUpdateIdSet = useMemo(() => new Set(seenPredictionUpdateIds), [seenPredictionUpdateIds]);

  const isUnseenEvent = useCallback((row) => (row?.id ? !seenEventIdSet.has(row.id) : false), [seenEventIdSet]);
  const isUnseenPredictionUpdate = useCallback(
    (row) => (row?.id && String(row?.kind || "").toLowerCase() === "auto_review" ? !seenPredictionUpdateIdSet.has(row.id) : false),
    [seenPredictionUpdateIdSet]
  );

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
  const activeAiAssessment = useMemo(() => buildAiAssessmentView(activeEvent, sortedFilteredEvents), [activeEvent, sortedFilteredEvents]);
  const popupAiAssessment = useMemo(() => buildAiAssessmentView(popupEvent, sortedFilteredEvents), [popupEvent, sortedFilteredEvents]);
  const renderSectionDelta = (changed) => (
    <span className={`ai-delta-badge ${changed ? "changed" : "stable"}`}>{changed ? "جديد" : "بدون تغيير"}</span>
  );

  const renderAiAssessmentBlocks = (assessment, prefix, mode = aiViewMode) => {
    const execMode = mode === "exec";
    return (
      <div className="ai-assessment-view">
        <div className="ai-assessment-kpis">
          <span className="fact-pill">
            <strong>الحكم:</strong> {assessment.verdict}
          </span>
          <span className="fact-pill">
            <strong>الثقة:</strong> {assessment.confidence}% ({assessment.confidenceLabel})
          </span>
          <span className="fact-pill">
            <strong>النطاق:</strong> {displayText(assessment.scopeLabel)}
          </span>
        </div>

        <div className="ai-assessment-group">
          <h5>
            ما الجديد منذ آخر تحديث
            {renderSectionDelta(Boolean(assessment.sectionDelta?.summary))}
          </h5>
          <p>{displayText(assessment.whatsNew) || "لا يوجد تحديث واضح."}</p>
        </div>

        <div className="ai-assessment-group">
          <h5>
            التحليل السياسي المختص
            {renderSectionDelta(Boolean(assessment.sectionDelta?.political))}
          </h5>
          <ul>
            {(assessment.politicalReading || []).slice(0, execMode ? 2 : 3).map((line, index) => (
              <li key={`${prefix}-political-${index}`}>{displayText(line)}</li>
            ))}
            <li>{displayText(assessment.whyItMatters)}</li>
          </ul>
        </div>

        {assessment.uaeImpactRows?.length ? (
          <div className="ai-assessment-group">
            <h5>
              أثر الخبر على الإمارات
              {renderSectionDelta(Boolean(assessment.sectionDelta?.impact))}
            </h5>
            <ul>
              {assessment.uaeImpactRows.slice(0, execMode ? 3 : 5).map((item, index) => (
                <li key={`${prefix}-uae-impact-${index}`}>
                  <strong>{displayText(item.axis)}:</strong> {item.score}% ({impactLevelLabel(item.score)})
                  {!execMode && item.why ? <small className="ai-assessment-source">{displayText(item.why)}</small> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {assessment.gulfImpactRows?.length ? (
          <div className="ai-assessment-group">
            <h5>أثر الخبر على الخليج</h5>
            <ul>
              {assessment.gulfImpactRows.slice(0, execMode ? 2 : 3).map((item, index) => (
                <li key={`${prefix}-gulf-impact-${index}`}>
                  <strong>{displayText(item.axis)}:</strong> {item.score}% ({impactLevelLabel(item.score)})
                  {!execMode && item.why ? <small className="ai-assessment-source">{displayText(item.why)}</small> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="ai-assessment-group">
          <h5>
            القرار الموصى وخطة التنفيذ
            {renderSectionDelta(Boolean(assessment.sectionDelta?.decision))}
          </h5>
          <ul>
            {(assessment.decisionOptions || [])
              .filter((option) => option.id === assessment.recommendedDecisionId)
              .slice(0, 1)
              .map((option) => (
                <li key={`${prefix}-recommended-option`}>
                  <strong>
                    {option.id}) {displayText(option.title)} (موصى به)
                  </strong>
                  <small className="ai-assessment-source">{displayText(option.detail)}</small>
                </li>
              ))}
            <li>
              <strong>الآن (0-2 ساعة):</strong> {displayText(assessment.actionNow)}
            </li>
            {!execMode ? (
              <>
                <li>
                  <strong>التالي (2-12 ساعة):</strong> {displayText(assessment.actionNext)}
                </li>
                <li>
                  <strong>متابعة (12-24 ساعة):</strong> {displayText(assessment.actionFollow)}
                </li>
              </>
            ) : null}
          </ul>
        </div>

        <div className="ai-assessment-group">
          <h5>تكلفة عدم الإجراء</h5>
          <ul>
            {assessment.noActionCost?.in6h ? (
              <li>
                <strong>خلال 6 ساعات:</strong> {displayText(assessment.noActionCost.in6h)}
              </li>
            ) : null}
            {assessment.noActionCost?.in24h ? (
              <li>
                <strong>خلال 24 ساعة:</strong> {displayText(assessment.noActionCost.in24h)}
              </li>
            ) : null}
          </ul>
        </div>

        <div className="ai-assessment-group">
          <h5>
            ما الذي يغيّر التقييم
            {renderSectionDelta(Boolean(assessment.sectionDelta?.triggers))}
          </h5>
          <ul>
            {[...(assessment.triggers || []), ...(assessment.thresholds || [])].slice(0, execMode ? 3 : 6).map((item, index) => (
              <li key={`${prefix}-trigger-threshold-${index}`}>{displayText(item)}</li>
            ))}
          </ul>
        </div>

        <div className="ai-assessment-group">
          <h5>
            مستوى الثقة ولماذا
            {renderSectionDelta(Boolean(assessment.sectionDelta?.confidence))}
          </h5>
          <ul>
            {(assessment.confidenceReasons || []).slice(0, execMode ? 2 : 4).map((item, index) => (
              <li key={`${prefix}-confidence-reason-${index}`}>{displayText(item)}</li>
            ))}
          </ul>
        </div>

        {!execMode ? (
          <>
            <details className="ai-assessment-collapse">
              <summary>
                متجه الأثر الحالي
                {renderSectionDelta(Boolean(assessment.sectionDelta?.impact))}
              </summary>
              {assessment.impactVector?.length ? (
                <ul>
                  {assessment.impactVector.map((item, index) => (
                    <li key={`${prefix}-impact-vector-${index}`}>
                      <strong>{displayText(item.label)}:</strong> {item.value}%
                      {item.note ? <small className="ai-assessment-source">{displayText(item.note)}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>لا توجد مؤشرات متجه إضافية.</p>
              )}
            </details>

            <details className="ai-assessment-collapse">
              <summary>
                الأدلة المختصرة
                {renderSectionDelta(Boolean(assessment.sectionDelta?.evidence))}
              </summary>
              {assessment.evidenceRows?.length ? (
                <ul>
                  {assessment.evidenceRows.map((item, index) => (
                    <li key={`${prefix}-evidence-${index}`}>
                      <div>{displayText(item.text)}</div>
                      {item.source ? <small className="ai-assessment-source">المصدر المرجعي: {displayText(item.source)}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>لا توجد أدلة إضافية.</p>
              )}
            </details>

            {assessment.contradictions?.length ? (
              <details className="ai-assessment-collapse">
                <summary>فجوات أو تعارضات تحتاج متابعة</summary>
                <ul>
                  {assessment.contradictions.map((item, index) => (
                    <li key={`${prefix}-contradictions-${index}`}>{displayText(item)}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

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

  const v2OpsRegionalEvents = useMemo(() => {
    const regionalKeywords = [
      "uae",
      "united arab emirates",
      "dubai",
      "abu dhabi",
      "qatar",
      "kuwait",
      "bahrain",
      "saudi",
      "oman",
      "jordan",
      "gulf",
      "hormuz",
      "الإمارات",
      "الامارات",
      "قطر",
      "الكويت",
      "البحرين",
      "السعودية",
      "عمان",
      "الأردن",
      "الخليج",
      "هرمز",
    ];
    const marineWatchKeywords = [
      "marine",
      "maritime",
      "ship",
      "vessel",
      "tanker",
      "lng",
      "imo",
      "ملاحة",
      "بحري",
      "سفينة",
      "ناقلة",
      "ميناء",
      "البحر الأحمر",
      "البحر المتوسط",
      "البحر الأبيض المتوسط",
    ];
    const threatWatchKeywords = [
      "missile",
      "ballistic",
      "cruise",
      "drone",
      "uav",
      "intercept",
      "air defense",
      "صاروخ",
      "بالستي",
      "كروز",
      "مسيّرة",
      "مسيّرات",
      "درون",
      "اعتراض",
      "دفاع جوي",
    ];
    const windowMs = Math.max(1, Number(v2OpsWindowHours || 6)) * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    let rows = [...events];
    if (v2TrustedOnly) rows = rows.filter((row) => isTrustedEvent(row));
    rows = rows.filter((row) => {
      const ts = parsePossiblyDate(eventDisplayTime(row))?.getTime() ?? Number.NaN;
      if (!Number.isFinite(ts) || ts < cutoff) return false;
      if (row.source_type === "flight" || row.source_type === "marine") return true;
      const text = eventText(row);
      return (
        regionalKeywords.some((keyword) => text.includes(keyword)) ||
        marineWatchKeywords.some((keyword) => text.includes(keyword)) ||
        threatWatchKeywords.some((keyword) => text.includes(keyword))
      );
    });
    return rows.sort((a, b) => byDateDesc(eventDisplayTime(a), eventDisplayTime(b)));
  }, [events, v2TrustedOnly, v2OpsWindowHours]);

  const v2OpsOfficialEvidenceCount = useMemo(() => {
    return v2OpsRegionalEvents.filter((row) => isOfficialOpsEvidence(row)).length;
  }, [v2OpsRegionalEvents]);

  const selectedOpsCountryDef = useMemo(
    () => threatCountryDefs.find((row) => row.country === v2ThreatCountry) || threatCountryDefs[0] || null,
    [v2ThreatCountry]
  );

  const selectedOpsCountryMarkers = useMemo(
    () => (selectedOpsCountryDef?.markers || []).map((marker) => cleanText(marker).toLowerCase()).filter(Boolean),
    [selectedOpsCountryDef]
  );

  const v2FlightSnapshots = useMemo(() => {
    const rows = v2OpsRegionalEvents.filter((row) => row.source_type === "flight");
    const byFlight = new Map();
    for (const row of rows) {
      const detailsMap = new Map(parseDetailsTokens(row.details));
      const key = cleanText(
        detailsMap.get("callsign") ||
          detailsMap.get("flight_id") ||
          detailsMap.get("icao24") ||
          row.title ||
          `flight-${row.id}`
      ).toUpperCase();
      if (!key || byFlight.has(key)) continue;
      const speed = parseLooseNumber(
        detailsMap.get("speed_kt") || detailsMap.get("speed") || detailsMap.get("ground_speed") || detailsMap.get("velocity_mps")
      );
      const altitude = parseLooseNumber(detailsMap.get("baro_alt_m") || detailsMap.get("geo_alt_m") || detailsMap.get("altitude"));
      const onGround = parseLooseBoolean(detailsMap.get("on_ground"));
      const statusText = [eventText(row), cleanText(detailsMap.get("status"))].join(" ");
      const airborneLikely =
        onGround === false || (altitude != null && altitude > 300) || (speed != null && speed > 35) || /(airborne|en route|in air|في الجو)/.test(statusText);
      const landedLikely = onGround === true || /(landed|arrived|هبوط|وصلت)/.test(statusText);
      const takeoffLikely =
        /(takeoff|departed|إقلاع|أقلعت)/.test(statusText) || (airborneLikely && !landedLikely && (speed || 0) > 40 && (altitude || 0) > 200);
      const typeText = [detailsMap.get("aircraft_type"), row.title, row.summary, row.details].filter(Boolean).join(" ");
      const coords = sanitizeLatLon(
        row.latitude ?? parseLooseNumber(detailsMap.get("lat") || detailsMap.get("latitude")),
        row.longitude ?? parseLooseNumber(detailsMap.get("lon") || detailsMap.get("longitude") || detailsMap.get("lng"))
      );
      const currentCountry = coords ? inferCountryByCoords(coords.lat, coords.lon, 460) : "";
      const origIata = normalizeTransportValue(detailsMap.get("orig_iata") || detailsMap.get("origin_iata"));
      const destIata = normalizeTransportValue(detailsMap.get("dest_iata") || detailsMap.get("destination_iata"));
      const origIcao = normalizeTransportValue(detailsMap.get("orig_icao") || detailsMap.get("origin_icao"));
      const destIcao = normalizeTransportValue(detailsMap.get("dest_icao") || detailsMap.get("destination_icao"));
      const fromPort = normalizeTransportValue(detailsMap.get("from_port") || detailsMap.get("origin")) || origIata || origIcao;
      const toPort = normalizeTransportValue(detailsMap.get("to_port") || detailsMap.get("destination")) || destIata || destIcao;
      const fromCountryRaw = normalizeTransportValue(detailsMap.get("from_country") || detailsMap.get("origin_country"));
      const toCountryRaw = normalizeTransportValue(detailsMap.get("to_country") || detailsMap.get("destination_country"));
      const fromCountry = fromCountryRaw || inferCountryFromIcaoCode(origIcao) || (isUaeAirportCode(fromPort) ? "UAE" : "") || currentCountry;
      const toCountry = toCountryRaw || inferCountryFromIcaoCode(destIcao) || (isUaeAirportCode(toPort) ? "UAE" : "");
      const routeScopeText = cleanText(
        [
          fromCountry,
          toCountry,
          fromPort,
          toPort,
          currentCountry,
          normalizeTransportValue(detailsMap.get("country")),
          row.location,
        ]
          .filter(Boolean)
          .join(" ")
      ).toLowerCase();
      const touchesSelectedCountryByRoute = selectedOpsCountryMarkers.some((marker) => marker && routeScopeText.includes(marker));
      const hasRouteHints = [fromCountry, toCountry, fromPort, toPort].some(Boolean);
      const touchesSelectedCountryByPosition = !hasRouteHints && isInsideCountryOpsRadius(row, selectedOpsCountryDef, 450);
      const touchesSelectedCountry = touchesSelectedCountryByRoute || touchesSelectedCountryByPosition;
      if (!touchesSelectedCountry) continue;
      byFlight.set(key, {
        key,
        row,
        speed,
        altitude,
        onGround,
        airborneLikely,
        landedLikely,
        takeoffLikely,
        fromCountry,
        toCountry,
        fromPort,
        toPort,
        origIata,
        destIata,
        origIcao,
        destIcao,
        currentCountry,
        heading: parseLooseNumber(detailsMap.get("heading") || detailsMap.get("track")),
        aircraftType: normalizeTransportValue(detailsMap.get("aircraft_type")),
        flightType: classifyFlightType(typeText),
        assessment: toArabicOperationalAssessment(row.ai_assessment, row.severity),
      });
    }
    return [...byFlight.values()];
  }, [v2OpsRegionalEvents, selectedOpsCountryMarkers, selectedOpsCountryDef]);

  const v2MarineSensorSnapshots = useMemo(() => {
    const rows = v2OpsRegionalEvents.filter((row) => row.source_type === "marine");
    const byShip = new Map();
    for (const row of rows) {
      if (!rowMatchesCountryMarkersForOps(row, selectedOpsCountryMarkers)) continue;
      const detailsMap = new Map(parseDetailsTokens(row.details));
      const key = cleanText(
        detailsMap.get("mmsi") ||
          detailsMap.get("ship_name") ||
          detailsMap.get("vessel") ||
          normalizeStoryTitle(row.title) ||
          `ship-${row.id}`
      ).toUpperCase();
      if (!key || byShip.has(key)) continue;
      const speedKn = parseLooseNumber(detailsMap.get("speed_kn") || detailsMap.get("speed") || detailsMap.get("sog"));
      const status = cleanText(detailsMap.get("status") || row.summary || "");
      const text = [row.title, row.summary, row.details].filter(Boolean).join(" ");
      const lat = row.latitude ?? parseLooseNumber(detailsMap.get("lat") || detailsMap.get("latitude"));
      const lon = row.longitude ?? parseLooseNumber(detailsMap.get("lon") || detailsMap.get("longitude") || detailsMap.get("lng"));
      const fromCountry = normalizeTransportValue(detailsMap.get("from_country") || detailsMap.get("country"));
      const toCountry = normalizeTransportValue(detailsMap.get("to_country") || detailsMap.get("destination_country"));
      const fromPort = normalizeTransportValue(detailsMap.get("from_port") || detailsMap.get("home_port") || detailsMap.get("origin_port"));
      const toPort = normalizeTransportValue(detailsMap.get("to_port") || detailsMap.get("destination_port") || detailsMap.get("destination"));
      const movingLikely =
        (speedKn != null && speedKn > 0.5) || /(underway|moving|sailing|en route|متحرك|إبحار|في الطريق)/i.test(`${status} ${text}`);
      byShip.set(key, {
        key,
        row,
        speedKn,
        status,
        movingLikely,
        shipType: classifyShipType(text),
        cargoType: classifyCargoType(text),
        fromCountry,
        toCountry,
        fromPort,
        toPort,
        vesselTypeSpecific: normalizeTransportValue(detailsMap.get("vessel_type_specific") || detailsMap.get("type_specific")),
        lat,
        lon,
        sourceKind: "sensor",
        highLevel: toArabicOperationalAssessment(row.ai_assessment, row.severity),
      });
    }
    return [...byShip.values()];
  }, [v2OpsRegionalEvents, selectedOpsCountryMarkers]);

  const v2MarineIntelSnapshots = useMemo(() => {
    const rows = v2OpsRegionalEvents.filter((row) => isMarineIntelLike(row));
    const byStory = new Map();
    for (const row of rows) {
      if (!rowMatchesCountryMarkersForOps(row, selectedOpsCountryMarkers)) continue;
      const key = extractShipDisplayName(row).toUpperCase();
      if (!key || byStory.has(key)) continue;
      const text = [row.title, row.summary, row.details, row.ai_assessment].filter(Boolean).join(" ");
      const inferred = inferOpsGeoHint(text);
      const movingLikely = /(moving|sailing|en route|transit|passage|متحرك|إبحار|عبور|مرور)/i.test(text);
      byStory.set(key, {
        key,
        row,
        speedKn: null,
        status: "خبر بحري من مصدر إعلامي",
        movingLikely,
        shipType: classifyShipType(text),
        cargoType: classifyCargoType(text),
        fromCountry: "",
        toCountry: "",
        fromPort: "",
        toPort: "",
        vesselTypeSpecific: "",
        lat: row.latitude ?? inferred?.lat ?? null,
        lon: row.longitude ?? inferred?.lon ?? null,
        sourceKind: "intel",
        highLevel: toArabicOperationalAssessment(row.ai_assessment, row.severity),
      });
    }
    return [...byStory.values()].sort((a, b) => byDateDesc(eventDisplayTime(a.row), eventDisplayTime(b.row)));
  }, [v2OpsRegionalEvents, selectedOpsCountryMarkers]);

  const v2FlightIntelSnapshots = useMemo(() => {
    const rows = v2OpsRegionalEvents.filter((row) => isFlightIntelLike(row) && row.source_type !== "flight");
    const byStory = new Map();
    for (const row of rows) {
      if (!rowMatchesCountryMarkersForOps(row, selectedOpsCountryMarkers)) continue;
      const media = detectMediaFromEvent(row);
      if (!media.videoUrl && !media.imageUrl) continue;
      const storyKey = eventStoryDedupKey(row);
      if (!storyKey || byStory.has(storyKey)) continue;
      const detailsMap = new Map(parseDetailsTokens(row.details));
      const text = [row.title, row.summary, row.details, row.ai_assessment].filter(Boolean).join(" ");
      const inferred = inferOpsGeoHint(text);
      const lat = row.latitude ?? inferred?.lat ?? null;
      const lon = row.longitude ?? inferred?.lon ?? null;
      const currentCountry = inferCountryByCoords(lat, lon, 500);
      const fromCountry = normalizeTransportValue(detailsMap.get("from_country") || detailsMap.get("origin_country")) || currentCountry;
      const toCountry = normalizeTransportValue(detailsMap.get("to_country") || detailsMap.get("destination_country"));
      const fromPort = normalizeTransportValue(detailsMap.get("from_port") || detailsMap.get("origin"));
      const toPort = normalizeTransportValue(detailsMap.get("to_port") || detailsMap.get("destination"));
      byStory.set(storyKey, {
        key: normalizeStoryTitle(row.title) || `intel-flight-${row.id}`,
        row,
        speed: parseLooseNumber(detailsMap.get("speed_kt") || detailsMap.get("speed")),
        altitude: parseLooseNumber(detailsMap.get("altitude") || detailsMap.get("baro_alt_m")),
        fromCountry,
        toCountry,
        fromPort,
        toPort,
        currentCountry,
        flightType: classifyFlightType(text),
        aircraftType: normalizeTransportValue(detailsMap.get("aircraft_type")),
        assessment: toArabicOperationalAssessment(row.ai_assessment, row.severity),
        media,
        lat,
        lon,
        sourceKind: "intel",
      });
    }
    return [...byStory.values()].sort((a, b) => byDateDesc(eventDisplayTime(a.row), eventDisplayTime(b.row)));
  }, [v2OpsRegionalEvents, selectedOpsCountryMarkers]);

  const v2ThreatIntelSnapshots = useMemo(() => {
    const rows = v2OpsRegionalEvents.filter((row) => isThreatIntelLike(row));
    const byStory = new Map();
    for (const row of rows) {
      if (!rowMatchesCountryMarkersForOps(row, selectedOpsCountryMarkers)) continue;
      const media = detectMediaFromEvent(row);
      if (!media.videoUrl && !media.imageUrl) continue;
      const storyKey = eventStoryDedupKey(row);
      if (!storyKey || byStory.has(storyKey)) continue;
      const text = [row.title, row.summary, row.details, row.ai_assessment].filter(Boolean).join(" ");
      const inferred = inferOpsGeoHint(text);
      const lat = row.latitude ?? inferred?.lat ?? null;
      const lon = row.longitude ?? inferred?.lon ?? null;
      const signalKind = inferThreatSignalKind(text);
      byStory.set(storyKey, {
        key: normalizeStoryTitle(row.title) || `intel-threat-${row.id}`,
        row,
        lat,
        lon,
        signalKind,
        assessment: toArabicOperationalAssessment(row.ai_assessment, row.severity),
        media,
      });
    }
    return [...byStory.values()].sort((a, b) => byDateDesc(eventDisplayTime(a.row), eventDisplayTime(b.row)));
  }, [v2OpsRegionalEvents, selectedOpsCountryMarkers]);

  const v2FlightAllSnapshots = useMemo(() => {
    const byKey = new Map();
    for (const row of [...v2FlightSnapshots, ...v2FlightIntelSnapshots]) {
      const stableKey = cleanText(row?.key || row?.row?.id || "").toUpperCase() || `flight-${row?.row?.id || "na"}`;
      if (!stableKey || byKey.has(stableKey)) continue;
      byKey.set(stableKey, row);
    }
    return [...byKey.values()];
  }, [v2FlightSnapshots, v2FlightIntelSnapshots]);

  const v2ShipSnapshots = useMemo(() => {
    const byShip = new Map();
    for (const row of [...v2MarineSensorSnapshots, ...v2MarineIntelSnapshots]) {
      if (!row?.key || byShip.has(row.key)) continue;
      byShip.set(row.key, row);
    }
    return [...byShip.values()];
  }, [v2MarineSensorSnapshots, v2MarineIntelSnapshots]);

  const v2ThreatEvidenceEvents = useMemo(() => {
    const threatKeywords = [
      "missile",
      "ballistic",
      "cruise",
      "drone",
      "uav",
      "intercept",
      "air defense",
      "صاروخ",
      "بالستي",
      "كروز",
      "مسيّرة",
      "مسيّرات",
      "درون",
      "اعتراض",
      "دفاع جوي",
    ];
    return (events || [])
      .filter((row) => {
        if (row.source_type === "flight" || row.source_type === "marine") return false;
        if (v2TrustedOnly && !isTrustedEvent(row)) return false;
        const text = eventText(row);
        if (!threatKeywords.some((keyword) => text.includes(keyword))) return false;
        return threatCountryDefs.some((countryDef) =>
          countryDef.markers.some((marker) => text.includes(cleanText(marker).toLowerCase()))
        );
      })
      .sort((a, b) => {
        const aTs = parsePossiblyDate(eventDisplayTime(a))?.getTime() ?? 0;
        const bTs = parsePossiblyDate(eventDisplayTime(b))?.getTime() ?? 0;
        return aTs - bTs;
      });
  }, [events, v2TrustedOnly]);

  const v2ThreatRows = useMemo(() => {
    const rows = threatCountryDefs.map((countryDef) => {
      const signalCumulativeByStory = { ballistic: new Map(), cruise: new Map(), drones: new Map() };
      const signalIncrementByStory = { ballistic: new Map(), cruise: new Map(), drones: new Map() };
      const mentionOnlyByStory = {
        ballistic: new Set(),
        cruise: new Set(),
        drones: new Set(),
      };
      const storyMentions = new Set();
      for (const eventRow of v2ThreatEvidenceEvents) {
        const text = [eventRow.title, eventRow.summary, eventRow.details, eventRow.ai_assessment, eventRow.tags].filter(Boolean).join(" ");
        const lower = cleanText(text).toLowerCase();
        if (!countryDef.markers.some((marker) => lower.includes(marker.toLowerCase()))) continue;
        const storyKey = eventStoryDedupKey(eventRow);
        storyMentions.add(storyKey);
        for (const signal of threatSignalDefs) {
          const value = extractSignalMaxFromText(text, signal.patterns, {
            maxValue: THREAT_SIGNAL_MAX_VALUE,
            maxDigits: THREAT_SIGNAL_MAX_DIGITS,
          });
          if (value != null) {
            if (isCumulativeThreatStatement(text)) {
              const previous = signalCumulativeByStory[signal.key].get(storyKey) || 0;
              signalCumulativeByStory[signal.key].set(storyKey, Math.max(previous, value));
            } else {
              const previous = signalIncrementByStory[signal.key].get(storyKey) || 0;
              signalIncrementByStory[signal.key].set(storyKey, Math.max(previous, value));
            }
            mentionOnlyByStory[signal.key].delete(storyKey);
            continue;
          }
          if (hasSignalMention(text, signal.mentionPatterns)) {
            if (!signalCumulativeByStory[signal.key].has(storyKey) && !signalIncrementByStory[signal.key].has(storyKey)) {
              mentionOnlyByStory[signal.key].add(storyKey);
            }
          }
        }
      }
      // Cumulative board logic:
      // - Official "since start" snapshots contribute as a running baseline (max).
      // - Incident-level numeric stories contribute as additive increments.
      // - Mention-only stories contribute +1 when no explicit number exists.
      const cumulativePlusIncrements = (cumulativeMap, incrementMap, mentionSet) => {
        const baseline = [...cumulativeMap.values()].reduce((max, value) => Math.max(max, Number(value) || 0), 0);
        const increments = [...incrementMap.values()].reduce((sum, value) => sum + (Number(value) || 0), 0);
        return baseline + increments + mentionSet.size;
      };
      const totals = {
        ballistic: cumulativePlusIncrements(
          signalCumulativeByStory.ballistic,
          signalIncrementByStory.ballistic,
          mentionOnlyByStory.ballistic
        ),
        cruise: cumulativePlusIncrements(signalCumulativeByStory.cruise, signalIncrementByStory.cruise, mentionOnlyByStory.cruise),
        drones: cumulativePlusIncrements(signalCumulativeByStory.drones, signalIncrementByStory.drones, mentionOnlyByStory.drones),
      };
      const mentions = storyMentions.size;
      return {
        country: countryDef.country,
        country_ar: countryDef.country_ar,
        lat: countryDef.lat,
        lon: countryDef.lon,
        ballistic: totals.ballistic > 0 ? String(totals.ballistic) : mentions > 0 ? "مرصود بلا رقم" : "غير متاح",
        cruise: totals.cruise > 0 ? String(totals.cruise) : mentions > 0 ? "مرصود بلا رقم" : "غير متاح",
        drones: totals.drones > 0 ? String(totals.drones) : mentions > 0 ? "مرصود بلا رقم" : "غير متاح",
        mentions,
        signal_mentions: mentionOnlyByStory.ballistic.size + mentionOnlyByStory.cruise.size + mentionOnlyByStory.drones.size,
      };
    });
    const ordered = [...rows].sort((a, b) => b.mentions - a.mentions || a.country_ar.localeCompare(b.country_ar, "ar"));
    return ordered.map((row) => ({ ...row, selected: row.country === v2ThreatCountry }));
  }, [v2ThreatEvidenceEvents, v2ThreatCountry]);

  useEffect(() => {
    if (!v2ThreatRows.length) return;
    if (!v2ThreatRows.some((row) => row.country === v2ThreatCountry)) {
      setV2ThreatCountry(v2ThreatRows[0].country);
    }
  }, [v2ThreatRows, v2ThreatCountry]);

  const v2ThreatTotals = useMemo(() => {
    const toNum = (value) =>
      parseLocalizedInteger(normalizeThreatValue(value), {
        maxValue: THREAT_SIGNAL_MAX_VALUE,
        maxDigits: THREAT_SIGNAL_MAX_DIGITS,
      });
    let ballistic = 0;
    let cruise = 0;
    let drones = 0;
    for (const row of v2ThreatRows) {
      ballistic += toNum(row.ballistic) || 0;
      cruise += toNum(row.cruise) || 0;
      drones += toNum(row.drones) || 0;
    }
    return { ballistic, cruise, drones };
  }, [v2ThreatRows]);

  const v2OpsStats = useMemo(() => {
    const takeoffs = v2FlightAllSnapshots.filter((row) => row.takeoffLikely).length;
    const airborne = v2FlightAllSnapshots.filter((row) => row.airborneLikely).length;
    const landed = v2FlightAllSnapshots.filter((row) => row.landedLikely).length;
    const shipsMoving = v2ShipSnapshots.filter((row) => row.movingLikely).length;
    const sensorFlights = v2FlightSnapshots.filter((row) => row?.sourceKind !== "intel");
    const uaeFlights = sensorFlights.map((row) => {
      const fromUae =
        isUaeCountryValue(row.fromCountry) || isUaeAirportCode(row.fromPort || row.origIata) || isUaeIcaoCode(row.origIcao);
      const toUae = isUaeCountryValue(row.toCountry) || isUaeAirportCode(row.toPort || row.destIata) || isUaeIcaoCode(row.destIcao);
      return { ...row, fromUae, toUae };
    });
    const uaeIncoming = uaeFlights.filter((row) => row.toUae && !row.fromUae).length;
    const uaeOutgoing = uaeFlights.filter((row) => row.fromUae && !row.toUae).length;
    const uaeDomestic = uaeFlights.filter((row) => row.fromUae && row.toUae).length;
    const uaeTouching = uaeFlights.filter((row) => row.fromUae || row.toUae);
    return {
      takeoffs,
      airborne,
      landed,
      shipsMoving,
      marineIntelSignals: v2MarineIntelSnapshots.length,
      flightTypeCounts: summarizeCounts(v2FlightAllSnapshots.map((row) => row.flightType)),
      shipTypeCounts: summarizeCounts(v2ShipSnapshots.map((row) => row.shipType)),
      cargoTypeCounts: summarizeCounts(v2ShipSnapshots.map((row) => row.cargoType)),
      uaeIncoming,
      uaeOutgoing,
      uaeDomestic,
      uaeTouchingCount: uaeTouching.length,
      uaeFlightTypeCounts: summarizeCounts(uaeTouching.map((row) => row.flightType)),
    };
  }, [v2FlightAllSnapshots, v2FlightSnapshots, v2ShipSnapshots, v2MarineIntelSnapshots]);

  const v2OpsMapPoints = useMemo(() => {
    const points = [];
    if (safeV2OpsLayers.threats) {
      const threatRow = v2ThreatRows.find((row) => row.country === v2ThreatCountry) || v2ThreatRows[0];
      if (threatRow) {
        const coords = sanitizeLatLon(threatRow.lat, threatRow.lon);
        if (coords) {
        points.push({
          id: `threat-${threatRow.country}`,
          type: "threat",
          icon: opsTypeIcon("threat"),
          label: `تهديدات ${threatRow.country_ar}`,
          sub: `${normalizeThreatValue(threatRow.ballistic)} بالستي | ${normalizeThreatValue(threatRow.cruise)} كروز | ${normalizeThreatValue(
            threatRow.drones
          )} مسيّرات`,
          note: `قيم تراكمية من جميع الإشارات الموثوقة المحمّلة (${threatRow.mentions} إشارات مرتبطة بالدولة).`,
          lat: coords.lat,
          lon: coords.lon,
          rowId: null,
        });
        }
      }
    }
    if (safeV2OpsLayers.air) {
      for (const flight of v2FlightAllSnapshots.slice(0, 22)) {
        const row = flight.row;
        const coords = sanitizeLatLon(row.latitude ?? flight.lat, row.longitude ?? flight.lon);
        if (!coords) continue;
        const pointType = flight.sourceKind === "intel" ? "air-intel" : "air";
        points.push({
          id: `air-${row.id}`,
          type: pointType,
          icon: opsTypeIcon(pointType),
          label: `رحلة ${flight.key}`,
          sub: `${flight.flightType} | ${routeArrowSummary(flight.fromCountry, flight.toCountry)} | ${routeArrowSummary(
            flight.fromPort,
            flight.toPort
          )}`,
          note: `${flight.assessment}${flight.currentCountry ? ` | التمركز الحالي: ${flight.currentCountry}` : ""}`,
          lat: coords.lat,
          lon: coords.lon,
          rowId: row.id,
        });
      }
    }
    if (safeV2OpsLayers.marine) {
      for (const ship of v2ShipSnapshots) {
        const coords = sanitizeLatLon(ship.lat, ship.lon);
        if (!coords) continue;
        const pointType = ship.sourceKind === "intel" ? "marine-intel" : "marine";
        points.push({
          id: `${ship.sourceKind === "intel" ? "marine-intel" : "ship"}-${ship.row.id}`,
          type: pointType,
          icon: opsTypeIcon(pointType),
          label: `سفينة ${ship.key}`,
          sub: `${ship.shipType} | ${routeArrowSummary(ship.fromCountry, ship.toCountry)} | ${routeArrowSummary(
            ship.fromPort,
            ship.toPort
          )}`,
          note: ship.highLevel,
          lat: coords.lat,
          lon: coords.lon,
          rowId: ship.row.id,
        });
      }
    }
    if (safeV2OpsLayers.threats) {
      for (const intel of v2ThreatIntelSnapshots.slice(0, 18)) {
        const coords = sanitizeLatLon(intel.lat, intel.lon);
        if (!coords) continue;
        const icon = intel.signalKind === "drones" ? "🛸" : intel.signalKind === "cruise" ? "🎯" : "🚀";
        points.push({
          id: `threat-intel-${intel.row.id}`,
          type: "threat-intel",
          icon,
          label: "إشارة تهديد إعلامية",
          sub: `${displayText(intel.row.title).slice(0, 120)}`,
          note: intel.assessment,
          lat: coords.lat,
          lon: coords.lon,
          rowId: intel.row.id,
        });
      }
    }
    return points;
  }, [safeV2OpsLayers, v2ThreatCountry, v2ThreatRows, v2FlightAllSnapshots, v2ShipSnapshots, v2ThreatIntelSnapshots]);

  useEffect(() => {
    if (!v2OpsMapPoints.length) {
      if (v2OpsFocusPointId) setV2OpsFocusPointId(null);
      return;
    }
    if (!v2OpsFocusPointId || !v2OpsMapPoints.some((point) => point.id === v2OpsFocusPointId)) {
      setV2OpsFocusPointId(v2OpsMapPoints[0].id);
    }
  }, [v2OpsMapPoints, v2OpsFocusPointId]);

  useEffect(() => {
    if (!v2OpsHoveredPointId) return;
    if (!v2OpsMapPoints.some((point) => point.id === v2OpsHoveredPointId)) {
      setV2OpsHoveredPointId(null);
    }
  }, [v2OpsMapPoints, v2OpsHoveredPointId]);

  const v2OpsFocusPoint = useMemo(
    () => v2OpsMapPoints.find((point) => point.id === v2OpsFocusPointId) || v2OpsMapPoints[0] || null,
    [v2OpsMapPoints, v2OpsFocusPointId]
  );

  const v2OpsHoverPoint = useMemo(
    () => v2OpsMapPoints.find((point) => point.id === v2OpsHoveredPointId) || v2OpsFocusPoint || null,
    [v2OpsMapPoints, v2OpsHoveredPointId, v2OpsFocusPoint]
  );

  const v2OpsPointByRowId = useMemo(() => {
    const out = new Map();
    for (const point of v2OpsMapPoints) {
      if (!point.rowId || out.has(point.rowId)) continue;
      out.set(point.rowId, point);
    }
    return out;
  }, [v2OpsMapPoints]);

  const v2OpsActiveEvent = useMemo(() => {
    const rowId = v2OpsHoverPoint?.rowId || v2OpsFocusPoint?.rowId;
    if (!rowId) return null;
    return eventsById.get(rowId) || null;
  }, [v2OpsHoverPoint, v2OpsFocusPoint, eventsById]);

  const v2OpsActiveMedia = useMemo(() => detectMediaFromEvent(v2OpsActiveEvent), [v2OpsActiveEvent]);

  const v2FlightDisplayItems = useMemo(() => {
    const items = [];
    for (const flight of v2FlightAllSnapshots) {
      const point = v2OpsPointByRowId.get(flight.row.id) || null;
      const media = flight.media || detectMediaFromEvent(flight.row);
      items.push({ ...flight, point, media, sourceKind: flight.sourceKind || "sensor" });
    }
    return items;
  }, [v2FlightAllSnapshots, v2OpsPointByRowId]);

  const v2FlightMapMediaItems = useMemo(() => {
    const items = [];
    for (const flight of v2FlightDisplayItems) {
      if (!flight.point) continue;
      const media = flight.media;
      if (!media.videoUrl && !media.imageUrl) continue;
      items.push(flight);
    }
    return items;
  }, [v2FlightDisplayItems]);

  const v2ShipDisplayItems = useMemo(() => {
    const items = [];
    for (const ship of v2ShipSnapshots) {
      const point = v2OpsPointByRowId.get(ship.row.id) || null;
      const media = detectMediaFromEvent(ship.row);
      items.push({ ...ship, point, media });
    }
    return items;
  }, [v2ShipSnapshots, v2OpsPointByRowId]);

  const v2ShipMapMediaItems = useMemo(() => {
    const items = [];
    for (const ship of v2ShipDisplayItems) {
      if (!ship.point) continue;
      const media = ship.media;
      if (!media.videoUrl && !media.imageUrl) continue;
      items.push(ship);
    }
    return items;
  }, [v2ShipDisplayItems]);

  useEffect(() => {
    if (!v2SectionOpen.opsBoard || v2OpsMapPoints.length === 0) return;
    const container = v2OpsMapContainerRef.current;
    if (!container || v2OpsLeafletMapRef.current) return;
    const map = L.map(container, {
      center: [24.4539, 54.3773],
      zoom: 5,
      minZoom: 3,
      maxZoom: 13,
      worldCopyJump: true,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    v2OpsLeafletMapRef.current = map;
    v2OpsLeafletLayerRef.current = layer;
    // Ensure first paint after dynamic mount is correctly sized.
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      layer.clearLayers();
      map.remove();
      v2OpsLeafletLayerRef.current = null;
      v2OpsLeafletMapRef.current = null;
    };
  }, [v2SectionOpen.opsBoard, v2OpsMapPoints.length]);

  useEffect(() => {
    const map = v2OpsLeafletMapRef.current;
    const layer = v2OpsLeafletLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const point of v2OpsMapPoints) {
      const coords = sanitizeLatLon(point.lat, point.lon);
      if (!coords) continue;
      const markerClass = `v2-map-marker-dot ${point.type} ${v2OpsFocusPoint?.id === point.id ? "active" : ""}`;
      const marker = L.marker([coords.lat, coords.lon], {
        icon: L.divIcon({
          className: "v2-map-div-icon",
          html: `<span class="${markerClass}">${point.icon || opsTypeIcon(point.type)}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      });
      marker.on("mouseover", () => setV2OpsHoveredPointId(point.id));
      marker.on("mouseout", () => setV2OpsHoveredPointId(null));
      marker.on("click", () => {
        setV2OpsFocusPointId(point.id);
        setV2OpsHoveredPointId(point.id);
        if (point.rowId) focusV2Story(point.rowId, { scroll: false, flash: false });
        if (point.type === "threat") {
          const country = point.id.replace("threat-", "");
          if (country) setV2ThreatCountry(country);
        }
      });
      marker.addTo(layer);
    }
  }, [v2OpsMapPoints, v2OpsFocusPoint, v2SectionOpen.opsBoard]);

  useEffect(() => {
    const map = v2OpsLeafletMapRef.current;
    if (!map || !v2OpsFocusPoint) return;
    const coords = sanitizeLatLon(v2OpsFocusPoint.lat, v2OpsFocusPoint.lon);
    if (!coords) return;
    const currentZoom = map.getZoom();
    const targetZoom = Math.max(5, currentZoom);
    map.flyTo([coords.lat, coords.lon], targetZoom, { duration: 0.45 });
  }, [v2OpsFocusPoint]);

  useEffect(() => {
    const map = v2OpsLeafletMapRef.current;
    if (!map || !v2SectionOpen.opsBoard) return;
    const timer = setTimeout(() => map.invalidateSize(), 140);
    return () => clearTimeout(timer);
  }, [v2SectionOpen.opsBoard, v2OpsMapPoints.length]);

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
  const selectedPredictionEvidence = useMemo(() => {
    if (!selectedPredictionTicket) return [];
    const range = resolveAnalysisDateRange(activePredictionWorkspace);
    const markers = buildCountryMarkers(activePredictionWorkspace?.country);
    const topicText = cleanText(
      [
        selectedPredictionTicket?.focus_query,
        selectedPredictionTicket?.request_text,
        activePredictionWorkspace?.topic,
      ]
        .filter(Boolean)
        .join(" ")
    ).toLowerCase();
    const topicTokens = topicText
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4)
      .slice(0, 24);
    const relatedIds = parseNumericIdList(selectedPredictionTicket?.related_event_ids || "");
    const merged = new Map();
    const addRow = (row) => {
      if (!row?.id || merged.has(row.id)) return;
      merged.set(row.id, row);
    };
    for (const id of relatedIds) {
      addRow(eventsById.get(id));
    }
    for (const row of activeWorkspaceEvidence) {
      addRow(row);
    }
    const scoreRow = (row) => {
      let score = Number(row?.severity || 1) * 3;
      const text = eventText(row);
      const lane = eventLane(row);
      if (lane !== "geo") score += 1.2;
      const tokenHits = topicTokens.reduce((acc, token) => (token && text.includes(token) ? acc + 1 : acc), 0);
      score += Math.min(5, tokenHits * 0.7);
      const ageMins = minutesSince(eventDisplayTime(row));
      if (Number.isFinite(ageMins)) score += Math.max(0, 4 - ageMins / 120);
      return score;
    };
    return [...merged.values()]
      .filter((row) => eventInsideRange(row, range) && eventMatchesCountry(row, markers))
      .sort((a, b) => scoreRow(b) - scoreRow(a) || byDateDesc(eventDisplayTime(a), eventDisplayTime(b)))
      .slice(0, 24);
  }, [selectedPredictionTicket, activePredictionWorkspace, eventsById, activeWorkspaceEvidence]);

  const selectedMitigationContent = useMemo(
    () =>
      enrichMitigationSection(
        selectedPredictionSections.MITIGATION,
        activePredictionWorkspace,
        selectedPredictionTicket,
        selectedPredictionEvidence
      ),
    [selectedPredictionSections, activePredictionWorkspace, selectedPredictionTicket, selectedPredictionEvidence]
  );

  const selectedSpecialistAnalysisContent = useMemo(
    () =>
      buildSpecialistAnalysisBox({
        workspace: activePredictionWorkspace,
        ticket: selectedPredictionTicket,
        evidenceRows: selectedPredictionEvidence,
      }),
    [activePredictionWorkspace, selectedPredictionTicket, selectedPredictionEvidence]
  );
  const predictionOperationalCards = useMemo(() => {
    if (!selectedPredictionTicket) return [];
    return operationalSectionDefs.map((section) => {
      const baseRaw = selectedPredictionSections[section.key];
      const raw =
        section.key === "DAMAGES_LOSSES"
          ? enrichDamagesLossesSection(baseRaw, activePredictionWorkspace, activeWorkspaceFatalityStats)
          : section.key === "MITIGATION"
          ? selectedMitigationContent
          : baseRaw;
      const safeRaw = sanitizePredictionBoxContent(raw);
      const bullets = toBulletLines(displayText(safeRaw));
      const preview = bullets.slice(0, 2).join(" - ");
      const content = bullets.length > 0 ? bullets.map((line) => `• ${line}`).join("\n") : "غير متوفر بعد في هذه التذكرة.";
      return {
        key: section.key,
        title: section.title,
        preview,
        content,
      };
    });
  }, [
    selectedPredictionTicket,
    selectedPredictionSections,
    activePredictionWorkspace,
    activeWorkspaceFatalityStats,
    selectedMitigationContent,
  ]);
  const predictionExecSectionKeys = useMemo(() => new Set(["CURRENT_BASELINE", "DAMAGES_LOSSES", "MITIGATION", "SHORT_TERM_PREDICTION"]), []);
  const predictionVisibleCards = useMemo(() => {
    if (predictionViewMode !== "exec") return predictionOperationalCards;
    return predictionOperationalCards.filter((card) => predictionExecSectionKeys.has(card.key));
  }, [predictionViewMode, predictionOperationalCards, predictionExecSectionKeys]);

  const activeVideoSource = useMemo(
    () => skyVideoSources.find((row) => row.id === selectedVideoSourceId) || skyVideoSources[0],
    [selectedVideoSourceId]
  );
  const activeVideoEmbeds = useMemo(() => videoEmbedCandidates(activeVideoSource), [activeVideoSource]);
  const activeVideoEmbedIndex = useMemo(() => {
    const raw = Number(videoEmbedIndexBySource?.[activeVideoSource?.id] || 0);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
  }, [videoEmbedIndexBySource, activeVideoSource]);
  const activeVideoEmbedUrl = useMemo(() => {
    if (!activeVideoEmbeds.length) return activeVideoSource?.embedUrl || "";
    return activeVideoEmbeds[activeVideoEmbedIndex % activeVideoEmbeds.length];
  }, [activeVideoEmbeds, activeVideoEmbedIndex, activeVideoSource]);
  const cycleActiveVideoEmbed = useCallback(() => {
    const sourceId = activeVideoSource?.id;
    const total = activeVideoEmbeds.length;
    if (!sourceId || total <= 1) return;
    setVideoEmbedIndexBySource((prev) => {
      const current = Number(prev?.[sourceId] || 0);
      const next = Number.isFinite(current) ? (current + 1) % total : 1 % total;
      return { ...prev, [sourceId]: next };
    });
  }, [activeVideoSource, activeVideoEmbeds.length]);

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
  const jsonCargoState = cleanText(jsonCargoStatus.state || "unknown").toLowerCase();
  const jsonCargoQuotaExceeded = jsonCargoState === "quota_exceeded";
  const jsonCargoConnected = jsonCargoState === "ok";
  const jsonCargoStatusLabel = jsonCargoQuotaExceeded
    ? "Quota Exceeded"
    : jsonCargoConnected
      ? "Connected"
      : jsonCargoState === "not_configured"
        ? "Not Configured"
        : jsonCargoStatus.message || "Unavailable";
  const liveIngestionConnected = useMemo(() => {
    if (ingestionRunning) return true;
    if (!lastSync) return false;
    const timestamp = parsePossiblyDate(lastSync)?.getTime() ?? Number.NaN;
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

  function toggleV2Section(sectionKey) {
    setV2SectionOpen((prev) => ({ ...prev, [sectionKey]: !prev[sectionKey] }));
  }

  function toggleV2OpsLayer(layerKey) {
    setV2OpsLayers((prev) => {
      const safe = {
        air: true,
        marine: true,
        threats: true,
        ...(prev && typeof prev === "object" ? prev : {}),
      };
      if (!Object.prototype.hasOwnProperty.call(safe, layerKey)) return safe;
      const next = { ...safe, [layerKey]: !safe[layerKey] };
      // Keep at least one layer enabled to avoid empty-state map crashes.
      if (!next.air && !next.marine && !next.threats) {
        next[layerKey] = true;
      }
      return next;
    });
  }

  function focusV2OpsBoard() {
    setVersionTab("v2");
    setV2SectionOpen((prev) => ({ ...prev, opsBoard: true }));
    setTimeout(() => {
      v2OpsBoardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function markPredictionUpdateSeen(updateId) {
    if (!updateId) return;
    setSeenPredictionUpdateIds((prev) => (prev.includes(updateId) ? prev : [...prev, updateId]));
  }

  async function updatePredictionReviewConfigPatch(patch) {
    const next = {
      enabled: Boolean(predictionReviewConfig?.enabled),
      review_seconds: Number(predictionReviewConfig?.review_seconds || 600),
      min_interval_minutes: Number(predictionReviewConfig?.min_interval_minutes || 10),
      ...(patch && typeof patch === "object" ? patch : {}),
    };
    const seconds = Number(next.review_seconds || 0);
    if (!Number.isFinite(seconds) || seconds < 60) return;
    setSavingPredictionReviewConfig(true);
    try {
      const minutes = Math.max(1, Math.round(seconds / 60));
      const row = await apiPatch("/ai/predictions/review-config", {
        enabled: Boolean(next.enabled),
        review_seconds: seconds,
        min_interval_minutes: minutes,
      });
      setPredictionReviewConfig({
        enabled: Boolean(row?.enabled ?? next.enabled),
        review_seconds: Number(row?.review_seconds || seconds),
        min_interval_minutes: Number(row?.min_interval_minutes || minutes),
      });
      setError("");
    } catch (err) {
      setError(err.message || "فشل تحديث فترة المراجعة الآلية.");
    } finally {
      setSavingPredictionReviewConfig(false);
    }
  }

  async function updatePredictionReviewInterval(reviewSeconds) {
    const seconds = Number(reviewSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 60) return;
    await updatePredictionReviewConfigPatch({ review_seconds: seconds });
  }

  function markEventSeen(eventId) {
    if (!eventId) return;
    setSeenEventIds((prev) => (prev.includes(eventId) ? prev : [...prev, eventId]));
  }

  function focusV2Story(eventId, options = {}) {
    if (!eventId) return;
    const { scroll = true, flash = true } = options;
    setV2FocusedEventId(eventId);
    markEventSeen(eventId);
    setV2SelectedEventIds((prev) => (prev.includes(eventId) ? prev : [eventId, ...prev]));
    if (flash) {
      setV2FocusFlash(true);
      setTimeout(() => setV2FocusFlash(false), 850);
    }
    if (scroll) {
      setTimeout(() => {
        v2FocusPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    }
  }

  function focusV2OpsEvent(eventId) {
    if (!eventId) return;
    const point = v2OpsPointByRowId.get(eventId);
    if (point) {
      setV2OpsFocusPointId(point.id);
      setV2OpsHoveredPointId(point.id);
      if (point.type === "threat") {
        const country = point.id.replace("threat-", "");
        if (country) setV2ThreatCountry(country);
      }
    }
    focusV2Story(eventId, { scroll: false, flash: false });
  }

  function toggleV2Selected(eventId) {
    if (!eventId) return;
    setV2SelectedEventIds((prev) => (prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]));
  }

  async function analyzeV2Selected() {
    if (!activePredictionWorkspace) {
      setError("لا توجد مساحة تحليل نشطة.");
      return;
    }
    setSubmittingInsight(true);
    try {
      const baseIds = v2SelectedEventIds.length > 0 ? v2SelectedEventIds : v2Events.slice(0, 30).map((row) => row.id);
      const ids = await resolveWorkspaceAnalysisEventIds(activePredictionWorkspace, baseIds);
      if (ids.length === 0) {
        setError("لا توجد عناصر ضمن الفترة المحددة للتحليل.");
        return;
      }
      const analysisRows = ids
        .map((id) => eventsById.get(id) || activeWorkspaceEvidenceById.get(id))
        .filter(Boolean);
      const transportIntel = buildTransportIntelSummary(analysisRows, activePredictionWorkspace);
      const structuredPrompt = buildOperationalAnalysisTemplate({
        focus: activePredictionWorkspace.predictionFocus,
        country: activePredictionWorkspace.country,
        topic: activePredictionWorkspace.topic,
        userRequest: activePredictionWorkspace.predictionRequest,
        analysisDateFrom: activePredictionWorkspace.analysisDateFrom,
        fatalityStats: activeWorkspaceFatalityStats,
        transportIntel,
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
      const baseIds = v2SelectedEventIds.length > 0 ? v2SelectedEventIds : v2Events.slice(0, 40).map((row) => row.id);
      const ids = await resolveWorkspaceAnalysisEventIds(activePredictionWorkspace, baseIds);
      if (ids.length === 0) {
        setError("لا توجد أحداث ضمن الفترة المحددة لإنشاء التذكرة.");
        return;
      }
      const analysisRows = ids
        .map((id) => eventsById.get(id) || activeWorkspaceEvidenceById.get(id))
        .filter(Boolean);
      const transportIntel = buildTransportIntelSummary(analysisRows, activePredictionWorkspace);
      const structuredRequest = buildOperationalAnalysisTemplate({
        focus: activePredictionWorkspace.predictionFocus,
        country: activePredictionWorkspace.country,
        topic: activePredictionWorkspace.topic,
        userRequest: activePredictionWorkspace.predictionRequest,
        analysisDateFrom: activePredictionWorkspace.analysisDateFrom,
        fatalityStats: activeWorkspaceFatalityStats,
        transportIntel,
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
      const selectedRows = v2SelectedEventIds
        .map((id) => eventsById.get(id) || activeWorkspaceEvidenceById.get(id))
        .filter(Boolean);
      const transportIntel = buildTransportIntelSummary(selectedRows, activePredictionWorkspace);
      const transportNote = transportIntel ? `\n\n[TRANSPORT_INTEL]\n${transportIntel}` : "";
      await apiPost(`/ai/predictions/${ticketId}/update`, {
        note: `${prefix}${predictionNote.trim()}${transportNote}`.trim(),
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
    for (const preset of officialPresetSources) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await apiPost("/sources", preset);
      } catch {
        // ignore duplicates
      }
    }
    await loadAll();
  }

  async function addAllPresetSources() {
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
          <div
            className={`openai-status ${jsonCargoQuotaExceeded ? "warning" : ""}`}
            title={jsonCargoStatus.detail || jsonCargoStatus.message || "JSONCargo status"}
          >
            <span className={`status-dot ${jsonCargoConnected ? "online" : jsonCargoQuotaExceeded ? "warn" : "offline"}`} />
            <strong>JSONCargo</strong>
            <small>{jsonCargoStatusLabel}</small>
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
                  src={forceUnmutedEmbedUrl(activeVideoEmbedUrl)}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  onError={cycleActiveVideoEmbed}
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
                    onClick={() => {
                      setSelectedVideoSourceId(source.id);
                      setVideoEmbedIndexBySource((prev) => ({ ...prev, [source.id]: 0 }));
                    }}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
          </div>

            <div className="video-open-link">
              {activeVideoEmbeds.length > 1 ? (
                <button className="btn btn-small" type="button" onClick={cycleActiveVideoEmbed}>
                  تبديل رابط البث
                </button>
              ) : null}
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
              {sourceTypeOptions.filter((opt) => opt.value !== "flight").map((opt) => (
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
          <label>
            المدى الزمني
            <select value={newsWindowHours} onChange={(event) => setNewsWindowHours(event.target.value)}>
              <option value="1">آخر ساعة</option>
              <option value="3">آخر 3 ساعات</option>
              <option value="6">آخر 6 ساعات</option>
              <option value="12">آخر 12 ساعة</option>
              <option value="24">آخر 24 ساعة</option>
              <option value="48">آخر 48 ساعة</option>
              <option value="72">آخر 72 ساعة</option>
              <option value="0">الكل</option>
            </select>
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
              إضافة باقة المصادر الرسمية
            </button>
            <button className="btn btn-ghost" type="button" onClick={addAllPresetSources}>
              إضافة كل القوالب
            </button>
            <span className="details-meta">ملاحظة: مصادر OpenSky وJSONCargo تعمل عبر واجهات API وقد تتطلب ترخيصًا/مفتاحًا.</span>
            {presetSources.map((preset) => (
              <button key={preset.name} className="btn btn-small" type="button" onClick={() => addPresetSource(preset)}>
                {preset.name}
              </button>
            ))}
          </div>
          <div className="list-pagination top source-pagination">
            <span className="pagination-meta">
              عرض {sourceRange.from}-{sourceRange.to} من {sources.length}
            </span>
            <div className="page-numbers">
              <button className="btn btn-small" type="button" onClick={() => setSourcePage((p) => Math.max(1, p - 1))} disabled={sourcePage <= 1}>
                السابق
              </button>
              {sourcePageNumbers.map((page) => (
                <button
                  key={`source-page-${page}`}
                  className={`btn btn-small page-btn ${sourcePage === page ? "active" : ""}`}
                  type="button"
                  onClick={() => setSourcePage(page)}
                >
                  {page}
                </button>
              ))}
              <button
                className="btn btn-small"
                type="button"
                onClick={() => setSourcePage((p) => Math.min(sourceTotalPages, p + 1))}
                disabled={sourcePage >= sourceTotalPages}
              >
                التالي
              </button>
            </div>
          </div>
          <div className="source-list drawer-list">
            {visibleSources.map((source) => (
              <article className="source-item" key={source.id}>
                <div className="source-item-body">
                  <h3>{source.name}</h3>
                  <p className="source-item-meta">
                    <span>{sourceTypeLabel(source.source_type)}</span>
                    <span>Polling: {source.poll_interval_seconds}s</span>
                    <span>parser: {source.parser_hint || "auto"}</span>
                  </p>
                  <small className="source-endpoint" dir="ltr">
                    {source.endpoint}
                  </small>
                </div>
                <button className="btn btn-small" type="button" onClick={() => toggleSource(source.id, source.enabled)}>
                  {source.enabled ? "تعطيل" : "تفعيل"}
                </button>
              </article>
            ))}
          </div>
          <div className="list-pagination source-pagination">
            <span className="pagination-meta">
              صفحة {sourcePage} من {sourceTotalPages}
            </span>
            <div className="page-picker">
              <label>
                صفحة
                <select value={sourcePage} onChange={(event) => setSourcePage(Number(event.target.value))}>
                  {Array.from({ length: sourceTotalPages }, (_, index) => (
                    <option key={`source-page-picker-${index + 1}`} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
                  <h3>{displayText(sanitizeEventDetailText(activeEvent.title)) || displayText(activeEvent.title)}</h3>
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
                  </div>
                  <div className="detail-sections">
                    <article className="detail-block">
                      <h4>الملخص</h4>
                      <p>{displayText(sanitizeEventDetailText(activeEvent.summary || activeEvent.details)) || "لا يوجد ملخص."}</p>
                    </article>
                    <article className="detail-block">
                      <div className="ai-assessment-head">
                        <h4>تقييم الذكاء</h4>
                        <div className="quick-topics ai-assessment-mode-switch">
                          <button
                            className={`btn btn-small ${aiViewMode === "exec" ? "active" : ""}`}
                            type="button"
                            onClick={() => setAiViewMode("exec")}
                          >
                            عرض تنفيذي
                          </button>
                          <button
                            className={`btn btn-small ${aiViewMode === "analysis" ? "active" : ""}`}
                            type="button"
                            onClick={() => setAiViewMode("analysis")}
                          >
                            عرض تحليلي
                          </button>
                        </div>
                      </div>
                      {renderAiAssessmentBlocks(activeAiAssessment, "active")}
                    </article>
                    <article className="detail-block">
                      <h4>تفاصيل إضافية</h4>
                      <p>{displayText(sanitizeEventDetailText(summarizeSourceDetails(activeEvent))) || "لا توجد تفاصيل إضافية."}</p>
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
                                  content: displayText(msg.content),
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
                        <p>{displayText(msg.content)}</p>
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
              <button className="btn btn-small" type="button" onClick={focusV2OpsBoard}>
                لوحة الحركة الجديدة
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
              <div className="panel-head v2-section-head">
                <h3>القصة الحية</h3>
                <button className="btn btn-small btn-ghost section-collapse-btn" type="button" onClick={() => toggleV2Section("narrative")}>
                  {sectionToggleLabel(v2SectionOpen.narrative)}
                </button>
              </div>
              {v2SectionOpen.narrative ? (
                <>
                  <p>
                    <strong>ماذا حدث:</strong> {v2Narrative.happened}
                  </p>
                  <p>
                    <strong>لماذا مهم:</strong> {v2Narrative.why}
                  </p>
                  <p>
                    <strong>ماذا نراقب تالياً:</strong> {v2Narrative.next}
                  </p>
                </>
              ) : null}
            </article>

            <article className="panel v2-freshness">
              <div className="panel-head v2-section-head">
                <h3>رادار الحداثة</h3>
                <button className="btn btn-small btn-ghost section-collapse-btn" type="button" onClick={() => toggleV2Section("freshness")}>
                  {sectionToggleLabel(v2SectionOpen.freshness)}
                </button>
              </div>
              {v2SectionOpen.freshness ? (
                <>
                  <div className="v2-freshness-chips">
                    <span className="fresh-chip live">Live {v2Freshness.live}</span>
                    <span className="fresh-chip ten">10m {v2Freshness.ten}</span>
                    <span className="fresh-chip hour">1h {v2Freshness.oneHour}</span>
                    <span className="fresh-chip three">3h {v2Freshness.threeHours}</span>
                    <span className="fresh-chip stale">3h+ {v2Freshness.stale}</span>
                  </div>
                  <small>كل بطاقة تبيّن عمر الخبر الفعلي لحظة العرض.</small>
                </>
              ) : null}
            </article>

            <article ref={v2OpsBoardRef} className="panel v2-ops-board">
              <div className="panel-head v2-section-head">
                <h3>لوحة الحركة والاعتراضات الإقليمية</h3>
                <div className="v2-section-meta">
                  <span>{v2OpsRegionalEvents.length} سجل خلال النافذة</span>
                  <button className="btn btn-small btn-ghost section-collapse-btn" type="button" onClick={() => toggleV2Section("opsBoard")}>
                    {sectionToggleLabel(v2SectionOpen.opsBoard)}
                  </button>
                </div>
              </div>
              {v2SectionOpen.opsBoard ? (
                <>
                  <div className="v2-ops-toolbar">
                    <label className="v2-filter-label">
                      نافذة التشغيل
                      <select value={v2OpsWindowHours} onChange={(event) => setV2OpsWindowHours(Number(event.target.value || 6))}>
                        <option value={1}>آخر ساعة</option>
                        <option value={3}>آخر 3 ساعات</option>
                        <option value={6}>آخر 6 ساعات</option>
                        <option value={12}>آخر 12 ساعة</option>
                        <option value={24}>آخر 24 ساعة</option>
                        <option value={48}>آخر 48 ساعة</option>
                      </select>
                    </label>
                    <span className="v2-ops-meta">أدلة موثقة (وكالات/حسابات رسمية): {v2OpsOfficialEvidenceCount}</span>
                    <button className={`btn btn-small ${safeV2OpsLayers.air ? "active" : ""}`} type="button" onClick={() => toggleV2OpsLayer("air")}>
                      طبقة الطيران
                    </button>
                    <button className={`btn btn-small ${safeV2OpsLayers.marine ? "active" : ""}`} type="button" onClick={() => toggleV2OpsLayer("marine")}>
                      طبقة الملاحة
                    </button>
                    <button className={`btn btn-small ${safeV2OpsLayers.threats ? "active" : ""}`} type="button" onClick={() => toggleV2OpsLayer("threats")}>
                      طبقة التهديدات
                    </button>
                  </div>

                  <div className="v2-ops-kpis">
                    <article className="v2-ops-kpi">
                      <h4>إقلاع مرصود</h4>
                      <p>{v2OpsStats.takeoffs}</p>
                      <small className="details-meta">رحلات صُنّفت آليًا كإقلاع محتمل ضمن النافذة الزمنية الحالية.</small>
                    </article>
                    <article className="v2-ops-kpi">
                      <h4>رحلات في الجو</h4>
                      <p>{v2OpsStats.airborne}</p>
                      <small className="details-meta">رحلات تُظهر مؤشرات طيران نشط (ارتفاع/سرعة/حالة) في نفس النافذة.</small>
                    </article>
                    <article className="v2-ops-kpi v2-uae-flow-kpi">
                      <h4>UAE Flights (In / Out / Domestic)</h4>
                      <div className="v2-uae-flow-rows">
                        <div className="v2-uae-flow-row incoming">
                          <span className="v2-uae-flow-arrow">↓</span>
                          <span className="v2-uae-flow-label">Inbound to UAE</span>
                          <strong>{v2OpsStats.uaeIncoming || 0}</strong>
                        </div>
                        <div className="v2-uae-flow-row outgoing">
                          <span className="v2-uae-flow-arrow">↑</span>
                          <span className="v2-uae-flow-label">Outbound from UAE</span>
                          <strong>{v2OpsStats.uaeOutgoing || 0}</strong>
                        </div>
                        <div className="v2-uae-flow-row domestic">
                          <span className="v2-uae-flow-arrow">↔</span>
                          <span className="v2-uae-flow-label">Domestic UAE</span>
                          <strong>{v2OpsStats.uaeDomestic || 0}</strong>
                        </div>
                      </div>
                      <small className="details-meta">أحمر: قادم للإمارات | أخضر: مغادر من الإمارات | أزرق: رحلة داخلية بالإمارات.</small>
                    </article>
                    <article className="v2-ops-kpi">
                      <h4>سفن متحركة</h4>
                      <p>{v2OpsStats.shipsMoving}</p>
                      <small className="details-meta">سفن مرصودة كـمتحركة فعليًا من السرعة أو حالة الملاحة.</small>
                    </article>
                    <article className="v2-ops-kpi">
                      <h4>اعتراضات معروفة</h4>
                      <p>{v2ThreatTotals.ballistic + v2ThreatTotals.cruise + v2ThreatTotals.drones}</p>
                      <small className="details-meta">إجمالي إشارات (بالستي + كروز + مسيّرات) بعد إزالة التكرار والقيم غير المنطقية.</small>
                    </article>
                    <article className="v2-ops-kpi">
                      <h4>إشارات بحرية محللة</h4>
                      <p>{v2OpsStats.marineIntelSignals}</p>
                      <small className="details-meta">أخبار بحرية حية تم تحويلها إلى نقاط تشغيلية على الخريطة.</small>
                    </article>
                  </div>

                  <div className="v2-ops-layout">
                    <section className="detail-block v2-ops-map-card">
                      <h4>الخريطة التشغيلية التفاعلية</h4>
                      {v2OpsMapPoints.length > 0 ? (
                        <>
                          <div className="v2-ops-map-shell" onMouseLeave={() => setV2OpsHoveredPointId(null)}>
                            <div ref={v2OpsMapContainerRef} className="v2-ops-leaflet" />
                          </div>
                          {v2OpsHoverPoint ? (
                            <article className="v2-ops-hover-card">
                              <h5>
                                <span className="v2-ops-item-icon">{v2OpsHoverPoint.icon || opsTypeIcon(v2OpsHoverPoint.type)}</span>
                                {v2OpsHoverPoint.label}
                              </h5>
                              <p>{v2OpsHoverPoint.sub}</p>
                              <small>{v2OpsHoverPoint.note || "لا يوجد تفسير إضافي."}</small>
                              {v2OpsActiveEvent ? (
                                <small className="details-meta">
                                  {displayText(v2OpsActiveEvent.source_name)} | {formatTime(eventDisplayTime(v2OpsActiveEvent))}
                                </small>
                              ) : null}
                              {v2OpsActiveMedia.videoUrl ? (
                                <div className="v2-ops-media">
                                  {isDirectVideoUrl(v2OpsActiveMedia.videoUrl) ? (
                                    <video src={v2OpsActiveMedia.videoUrl} controls preload="metadata" />
                                  ) : (
                                    <iframe
                                      title={`ops-media-video-${v2OpsHoverPoint.id}`}
                                      src={v2OpsActiveMedia.videoUrl}
                                      loading="lazy"
                                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                      allowFullScreen
                                    />
                                  )}
                                </div>
                              ) : null}
                              {!v2OpsActiveMedia.videoUrl && v2OpsActiveMedia.imageUrl ? (
                                <div className="v2-ops-media">
                                  <img src={v2OpsActiveMedia.imageUrl} alt={v2OpsHoverPoint.label} loading="lazy" />
                                </div>
                              ) : null}
                              <div className="quick-topics">
                                {v2OpsHoverPoint.rowId ? (
                                  <button
                                    className="btn btn-small btn-ghost"
                                    type="button"
                                    onClick={() => focusV2Story(v2OpsHoverPoint.rowId, { scroll: false, flash: false })}
                                  >
                                    ربط بالقصة
                                  </button>
                                ) : null}
                                {v2OpsActiveEvent?.url ? (
                                  <a className="btn btn-small btn-ghost source-link-btn" href={v2OpsActiveEvent.url} target="_blank" rel="noreferrer">
                                    زيارة المصدر
                                  </a>
                                ) : null}
                              </div>
                            </article>
                          ) : null}
                        </>
                      ) : (
                        <p>لا توجد نقاط تشغيلية ضمن النافذة الحالية.</p>
                      )}
                    </section>

                    <section className="detail-block v2-threat-card">
                      <h4>مقارنة ديناميكية للدول (بالستي/كروز/مسيّرات)</h4>
                      <div className="v2-threat-table-wrap">
                        <table className="v2-threat-table">
                          <thead>
                            <tr>
                              <th>الدولة</th>
                              <th>بالستي</th>
                              <th>كروز</th>
                              <th>مسيّرات</th>
                            </tr>
                          </thead>
                          <tbody>
                            {v2ThreatRows.map((row) => (
                              <tr
                                key={row.country}
                                className={row.selected ? "active" : ""}
                                onClick={() => {
                                  setV2ThreatCountry(row.country);
                                  setV2OpsFocusPointId(`threat-${row.country}`);
                                }}
                              >
                                <td>{row.country_ar}</td>
                                <td>{normalizeThreatValue(row.ballistic)}</td>
                                <td>{normalizeThreatValue(row.cruise)}</td>
                                <td>{normalizeThreatValue(row.drones)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <small className="details-meta">
                        القيم تراكمية منذ أول حدث تهديدي محمّل في النظام (لا تنخفض مع مرور الوقت). يتم حذف تكرار نفس القصة، واعتماد صيغة: أساس تراكمي رسمي + زيادات أحداث جديدة + مرصود بلا رقم. اختيار دولة من الجدول يرشّح نقاط الطيران والسفن والتهديدات على الخريطة والقوائم بالأسفل.
                      </small>
                    </section>
                  </div>

                  <div className="v2-ops-streams">
                    <section className="detail-block v2-ops-stream">
                      <h4>رحلات الطيران (على الخريطة + وسائط)</h4>
                      <div className="v2-ops-chip-row">
                        {Object.entries(v2OpsStats.flightTypeCounts).map(([label, count]) => (
                          <span key={`flight-type-${label}`} className="fresh-chip ten">
                            {label}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="v2-ops-chip-row">
                        <span className="fresh-chip live">الإمارات قادمة: {v2OpsStats.uaeIncoming || 0}</span>
                        <span className="fresh-chip ten">الإمارات مغادرة: {v2OpsStats.uaeOutgoing || 0}</span>
                        <span className="fresh-chip hour">الإمارات داخلية: {v2OpsStats.uaeDomestic || 0}</span>
                        <span className="fresh-chip live">إجمالي رحلات مرتبطة بالإمارات: {v2OpsStats.uaeTouchingCount || 0}</span>
                      </div>
                      <div className="v2-ops-chip-row">
                        {Object.entries(v2OpsStats.uaeFlightTypeCounts || {}).map(([label, count]) => (
                          <span key={`uae-flight-type-${label}`} className="fresh-chip hour">
                            الإمارات | {label}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="v2-ops-items">
                        {v2FlightDisplayItems.slice(0, 18).map((flight) => (
                          <button key={`flight-snap-${flight.key}`} type="button" className="v2-ops-item-btn" onClick={() => focusV2OpsEvent(flight.row.id)}>
                            <strong><span className="v2-ops-item-icon">{flight.point?.icon || opsTypeIcon(flight.point?.type)}</span>{flight.key}</strong>
                            <small>
                              {flight.flightType} | الدول: {routeArrowSummary(flight.fromCountry, flight.toCountry)} | المطارات:{" "}
                              {routeArrowSummary(flight.fromPort, flight.toPort)}
                            </small>
                            <small>
                              سرعة: {flight.speed != null ? Math.round(flight.speed) : "غير متاحة"} عقدة | ارتفاع:{" "}
                              {flight.altitude != null ? Math.round(flight.altitude) : "غير متاح"} | التمركز: {flight.currentCountry || "غير محدد"} |{" "}
                              {formatRelativeTime(eventDisplayTime(flight.row))}
                            </small>
                            <small>
                              المصدر: {flight.sourceKind === "intel" ? "خبر جوي" : "تتبع FR24"} |{" "}
                              {flight.media.videoUrl ? "وسائط: فيديو" : flight.media.imageUrl ? "وسائط: صورة" : "وسائط: غير متاحة"} | مرسوم على الخريطة
                            </small>
                          </button>
                        ))}
                        {v2FlightDisplayItems.length === 0 ? (
                          <p>لا توجد رحلات مرتبطة بالدولة المختارة ({selectedOpsCountryDef?.country_ar || "غير محدد"}) ضمن النافذة الحالية.</p>
                        ) : null}
                      </div>
                    </section>

                    <section className="detail-block v2-ops-stream">
                      <h4>حركة السفن (استشعار مباشر + تحليل الأخبار) على الخريطة + وسائط</h4>
                      <div className="v2-ops-chip-row">
                        {Object.entries(v2OpsStats.cargoTypeCounts).map(([label, count]) => (
                          <span key={`cargo-type-${label}`} className="fresh-chip hour">
                            {label}: {count}
                          </span>
                        ))}
                      </div>
                      <div className="v2-ops-items">
                        {v2ShipDisplayItems.slice(0, 22).map((ship) => (
                          <button key={`ship-snap-${ship.key}`} type="button" className="v2-ops-item-btn" onClick={() => focusV2OpsEvent(ship.row.id)}>
                            <strong><span className="v2-ops-item-icon">{ship.point?.icon || opsTypeIcon(ship.point?.type)}</span>{ship.key}</strong>
                            <small>
                              {ship.shipType} | الشحنة: {ship.cargoType} | الدول: {routeArrowSummary(ship.fromCountry, ship.toCountry)}
                            </small>
                            <small>
                              الموانئ: {routeArrowSummary(ship.fromPort, ship.toPort)} | سرعة: {ship.speedKn != null ? ship.speedKn : "غير متاحة"} عقدة |{" "}
                              {formatRelativeTime(eventDisplayTime(ship.row))}
                            </small>
                            <small>
                              {ship.sourceKind === "intel" ? "مصدر: خبر محلل" : "مصدر: استشعار ملاحي مباشر"} | النوع التفصيلي:{" "}
                              {ship.vesselTypeSpecific || "غير محدد"} | {ship.highLevel}
                            </small>
                            <small>
                              {ship.media.videoUrl ? "وسائط: فيديو" : ship.media.imageUrl ? "وسائط: صورة" : "وسائط: غير متاحة"} | مرسوم على الخريطة
                            </small>
                          </button>
                        ))}
                        {v2ShipDisplayItems.length === 0 ? (
                          <p>لا توجد سفن مرتبطة بالدولة المختارة ({selectedOpsCountryDef?.country_ar || "غير محدد"}) ضمن النافذة الحالية.</p>
                        ) : null}
                      </div>
                    </section>
                  </div>
                </>
              ) : null}
            </article>

            <article className="panel v2-predictions-panel">
              <div className="panel-head v2-section-head">
                <h3>تذاكر التوقع الذكي</h3>
                <div className="v2-section-meta">
                  <span>
                    {filteredPredictionTickets.length} / {scopedPredictionTickets.length} تذكرة | {activePredictionWorkspace?.label || "مساحة"}
                  </span>
                  <button className="btn btn-small btn-ghost section-collapse-btn" type="button" onClick={() => toggleV2Section("predictions")}>
                    {sectionToggleLabel(v2SectionOpen.predictions)}
                  </button>
                </div>
              </div>
              {v2SectionOpen.predictions ? (
                <>
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
                <label className="v2-filter-label">
                  المراجعة الآلية
                  <select
                    value={predictionReviewConfig.enabled ? "on" : "off"}
                    onChange={(event) => {
                      void updatePredictionReviewConfigPatch({ enabled: event.target.value === "on" });
                    }}
                    disabled={savingPredictionReviewConfig}
                  >
                    <option value="off">متوقفة</option>
                    <option value="on">مفعلة</option>
                  </select>
                </label>
                <label className="v2-filter-label">
                  فاصل المراجعة الآلية
                  <select
                    value={Number(predictionReviewConfig.review_seconds || 600)}
                    onChange={(event) => {
                      void updatePredictionReviewInterval(Number(event.target.value || 600));
                    }}
                    disabled={savingPredictionReviewConfig}
                  >
                    {predictionReviewIntervalOptions.map((option) => (
                      <option key={`review-interval-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {savingPredictionReviewConfig ? <span className="muted">جارٍ تحديث إعدادات المراجعة...</span> : null}
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
                  تاريخ المعلومات من
                  <input
                    type="date"
                    value={activePredictionWorkspace?.analysisDateFrom || ""}
                    onChange={(event) => updateActivePredictionWorkspace({ analysisDateFrom: event.target.value })}
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
                <div className="details-meta">
                  {buildFatalityAutoLine(activePredictionWorkspace, activeWorkspaceFatalityStats)}
                  <br />
                  {buildInjuryAutoLine(activePredictionWorkspace, activeWorkspaceFatalityStats)}
                </div>
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
                        {displayText(ticket.focus_query)} | {predictionStatusLabel(ticket.status)} | {predictionOutcomeLabel(ticket.outcome)} |
                        الدرجة: {predictionScorePercent(ticket.confidence)}%
                      </small>
                      <small>
                        الاستحقاق: {predictionDueAt(ticket) ? formatTime(predictionDueAt(ticket).toISOString()) : "غير متاح"}
                      </small>
                      <small>آخر مراجعة: {formatTime(ticket.updated_at)}</small>
                    </article>
                  ))}
                  {filteredPredictionTickets.length === 0 ? <p>لا توجد تذاكر ضمن الفلاتر الحالية.</p> : null}
                </div>

                <div className="v2-prediction-details">
                  {selectedPredictionTicket ? (
                    <>
                      <h4>{displayText(selectedPredictionTicket.title)}</h4>
                      <div className="ai-assessment-head">
                        <div className="quick-topics ai-assessment-mode-switch">
                          <button
                            className={`btn btn-small ${predictionViewMode === "exec" ? "active" : ""}`}
                            type="button"
                            onClick={() => setPredictionViewMode("exec")}
                          >
                            عرض تنفيذي
                          </button>
                          <button
                            className={`btn btn-small ${predictionViewMode === "analysis" ? "active" : ""}`}
                            type="button"
                            onClick={() => setPredictionViewMode("analysis")}
                          >
                            عرض تحليلي
                          </button>
                        </div>
                      </div>
                      <p className="details-meta">
                        الدرجة: {predictionScorePercent(selectedPredictionTicket.confidence)}% | الأفق: {selectedPredictionTicket.horizon_hours}h |
                        الحالة: {predictionStatusLabel(selectedPredictionTicket.status)} | النتيجة: {predictionOutcomeLabel(selectedPredictionTicket.outcome)}
                      </p>
                      <p className="details-meta">
                        وقت الاستحقاق:{" "}
                        {predictionDueAt(selectedPredictionTicket) ? formatTime(predictionDueAt(selectedPredictionTicket).toISOString()) : "غير متاح"}
                      </p>
                      <p className="details-meta">آخر تحديث آلي/يدوي: {formatTime(selectedPredictionTicket.updated_at)}</p>
                      <button
                        type="button"
                        className="detail-block v2-operational-card"
                        onClick={() =>
                          setContentModal({
                            title: "التحليل التخصصي (حالي + تنبئي)",
                            content: displayText(sanitizePredictionBoxContent(selectedSpecialistAnalysisContent)),
                            createdAt: selectedPredictionTicket?.updated_at || selectedPredictionTicket?.created_at || null,
                          })
                        }
                      >
                        <h4>التحليل التخصصي (حالي + تنبئي)</h4>
                        <p>
                          {toBulletLines(displayText(sanitizePredictionBoxContent(selectedSpecialistAnalysisContent)))
                            .slice(0, predictionViewMode === "exec" ? 2 : 3)
                            .join(" - ") || "غير متوفر."}
                        </p>
                      </button>
                      <div className="v2-operational-grid">
                        {predictionVisibleCards.map((section) => {
                          return (
                            <button
                              key={section.key}
                              type="button"
                              className="detail-block v2-operational-card"
                              onClick={() =>
                                setContentModal({
                                  title: section.title,
                                  content: section.content,
                                  createdAt: selectedPredictionTicket?.updated_at || selectedPredictionTicket?.created_at || null,
                                })
                              }
                            >
                              <h4>{section.title}</h4>
                              <p>{section.preview || "غير متوفر بعد في هذه التذكرة."}</p>
                            </button>
                          );
                        })}
                      </div>
                      {predictionViewMode === "analysis" ? (
                        <details className="ai-assessment-collapse">
                          <summary>النص الكامل (منسق بالعربية)</summary>
                          <p>{displayText(sanitizePredictionBoxContent(cleanOperationalTaggedText(selectedPredictionTicket.prediction_text)))}</p>
                        </details>
                      ) : null}
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
                        {predictionUpdates.map((update) => {
                          const isNewAutoReview = isUnseenPredictionUpdate(update);
                          const safeContent = sanitizePredictionUpdateContent(update.content, update.kind);
                          const structuredPreview = toStructuredReadableBullets(displayText(safeContent));
                          const previewText =
                            structuredPreview
                              .slice(0, 2)
                              .map((item) => item.text)
                              .join(" • ") || displayText(safeContent);
                          return (
                            <button
                              key={update.id}
                              type="button"
                              className={`detail-block v2-click-block ${isNewAutoReview ? "prediction-update-new" : ""}`}
                              onClick={() => {
                                markPredictionUpdateSeen(update.id);
                                setContentModal({
                                  title: `تحديث التوقع: ${predictionUpdateKindLabel(update.kind)}${update.outcome ? ` | ${predictionOutcomeLabel(update.outcome)}` : ""}`,
                                  content: displayText(safeContent),
                                  createdAt: update.created_at,
                                });
                              }}
                            >
                              <div className="prediction-update-head">
                                <h4>
                                  {predictionUpdateKindLabel(update.kind)} {update.outcome ? `| ${predictionOutcomeLabel(update.outcome)}` : ""}
                                </h4>
                                {isNewAutoReview ? <span className="new-flag prediction-update-new-flag">جديد</span> : null}
                              </div>
                              <p>{previewText}</p>
                              <small>{formatTime(update.created_at)}</small>
                            </button>
                          );
                        })}
                        {predictionUpdates.length === 0 ? <p>لا يوجد سجل تحديثات بعد.</p> : null}
                      </div>
                    </>
                  ) : (
                    <p>اختر تذكرة لعرض تاريخ التوقع.</p>
                  )}
                </div>
              </div>

              <section className="v2-leaderboard v2-leaderboard-compact">
                <div className="panel-head">
                  <h4>مؤشر دقة النموذج (مختصر)</h4>
                  <span>{aiStatus.model || "Model"}</span>
                </div>
                <div className="v2-leaderboard-list">
                  {predictionLeaderboard.map((row) => (
                    <article key={`${row.model}-${row.window_hours}`} className="detail-block v2-leaderboard-item">
                      <h5>{displayText(predictionWindowLabel(row))}</h5>
                      <p>
                        الدقة: {Math.round((Number(row.accuracy || 0) * 10000) / 100)}%
                      </p>
                      <small>التذاكر المقيمة: {row.evaluated_tickets}</small>
                      <small>
                        صحيح: {row.correct_count} | جزئي: {row.partial_count} | خاطئ: {row.wrong_count}
                      </small>
                      <small>
                        التغير:{" "}
                        {Math.round((Number(row.trend_delta || 0) * 10000) / 100)}%
                      </small>
                    </article>
                  ))}
                  {predictionLeaderboard.length === 0 ? <p>لا توجد بيانات تقييم كافية بعد.</p> : null}
                </div>
              </section>
                </>
              ) : null}
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
                const items = toStructuredReadableBullets(contentModal.content);
                if (items.length > 1) {
                  return (
                    <ul className="content-modal-list">
                      {items.map((item, index) => (
                        <li key={`modal-item-${index}`}>
                          <div className="content-modal-point-text">{item.text}</div>
                          {item.source ? <small className="content-modal-point-source">المصدر: {item.source}</small> : null}
                        </li>
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
              <h2>{displayText(sanitizeEventDetailText(popupEvent.title)) || displayText(popupEvent.title)}</h2>
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
                <p>{displayText(sanitizeEventDetailText(popupEvent.summary || popupEvent.details)) || "لا يوجد ملخص."}</p>
              </article>
              <article className="detail-block">
                <h4>تقييم الذكاء</h4>
                {renderAiAssessmentBlocks(popupAiAssessment, "popup", "exec")}
              </article>
            </div>
            <div className="facts-grid">
              {popupFacts.map(([key, value], index) => (
                <span className="fact-pill" key={`popup-${key}-${index}`}>
                  <strong>{key}:</strong> {value}
                </span>
              ))}
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}

