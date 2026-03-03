from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Gulf Situation AI Monitor"
    environment: str = "development"
    database_url: str = "sqlite:///./data/gulf_watch.db"
    poll_seconds: int = 120
    news_max_age_hours: int = 24
    use_redis_worker: bool = False
    redis_url: str = "redis://localhost:6379/0"
    ingest_queue_name: str = "ingestion"

    api_key_enabled: bool = False
    app_api_key: str | None = None

    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    ai_privacy_mode: bool = True
    reports_dir: str = "./data/reports"

    trusted_domains: str = (
        "cnn.com,edition.cnn.com,alarabiya.net,gulfnews.com,wam.ae,24.ae,sharjah24.ae,alroeya.com,"
        "emaratalyoum.com,albayan.ae,alkhaleej.ae,alittihad.ae,"
        "news.sky.com,skynews.com,skynewsarabia.com,"
        "bbc.com,france24.com,arabic.rt.com,rt.com,independentarabia.com,"
        "reliefweb.int,gdacs.org,cisa.gov,"
        "opensky-network.org,marinetraffic.com,flightradar24.com,reddit.com"
    )

    fr24_api_key: str | None = None
    fr24_auth_header: str = "x-apikey"
    fr24_api_key_param: str | None = None

    marinetraffic_api_key: str | None = None
    marinetraffic_auth_header: str | None = None
    marinetraffic_api_key_param: str = "api_key"

    newsdata_api_key: str | None = None
    gnews_api_key: str | None = None
    newsapi_api_key: str | None = None
    apify_token: str | None = None
    x_api_key: str | None = None
    x_api_bearer_token: str | None = None
    x_api_base_url: str = "https://api.x.com/2"

    gulf_keywords: str = (
        "gulf,hormuz,uae,saudi,bahrain,kuwait,qatar,oman,iran,iraq,yemen,"
        "dubai,abu dhabi,doha,riyadh,muscat,manama,basra,"
        "الخليج,مضيق هرمز,الإمارات,السعودية,البحرين,الكويت,قطر,عمان,إيران,العراق,اليمن,"
        "دبي,أبوظبي,الدوحة,الرياض,مسقط,المنامة,البصرة"
    )
    gulf_min_lat: float = Field(default=16.0)
    gulf_max_lat: float = Field(default=32.0)
    gulf_min_lon: float = Field(default=45.0)
    gulf_max_lon: float = Field(default=60.0)

    default_news_rss: str | None = "https://reliefweb.int/updates?format=rss"
    default_news_parser_hint: str = "rss"
    default_incident_feed: str | None = None
    default_incident_parser_hint: str = "rss"
    default_flight_feed: str | None = None
    default_flight_parser_hint: str = "opensky"
    default_marine_feed: str | None = None
    default_marine_parser_hint: str = "marinetraffic"
    default_cyber_feed: str | None = None
    default_cyber_parser_hint: str = "cyber_rss"
    default_social_feed: str | None = None
    default_social_parser_hint: str = "social_reddit_json"
    default_x_recent_feed: str | None = None
    default_x_recent_parser_hint: str = "x_recent"
    default_cnn_gulf_feed: str | None = None
    default_alarabiya_gulf_feed: str | None = None
    default_gulfnews_feed: str | None = None
    default_bbc_arabic_feed: str | None = "https://www.bbc.com/arabic/index.xml"
    default_france24_ar_feed: str | None = "https://www.france24.com/ar/rss"
    default_rt_arabic_feed: str | None = "https://arabic.rt.com/rss/"
    default_independentarabia_feed: str | None = "https://www.independentarabia.com/rss.xml"
    default_skynews_feed: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @cached_property
    def keywords(self) -> set[str]:
        return {item.strip().lower() for item in self.gulf_keywords.split(",") if item.strip()}

    @cached_property
    def trusted_domains_set(self) -> set[str]:
        return {item.strip().lower() for item in self.trusted_domains.split(",") if item.strip()}


settings = Settings()
