from functools import cached_property

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Gulf Situation AI Monitor"
    environment: str = "development"
    database_url: str = "sqlite:///./data/gulf_watch.db"
    poll_seconds: int = 120
    prediction_review_enabled: bool = False
    prediction_review_seconds: int = 600
    prediction_review_min_interval_minutes: int = 10
    news_max_age_hours: int = 24
    use_redis_worker: bool = False
    redis_url: str = "redis://localhost:6379/0"
    ingest_queue_name: str = "ingestion"

    api_key_enabled: bool = False
    app_api_key: str | None = None
    auth_required: bool = True
    auth_strategy: str = "hybrid"  # password | email_otp | mobile_auth | hybrid
    auth_password_enabled: bool = True
    auth_email_otp_enabled: bool = True
    auth_mobile_enabled: bool = False
    auth_access_token_minutes: int = 30
    auth_refresh_token_days: int = 14
    auth_jwt_secret: str = "change-this-jwt-secret"
    auth_jwt_alg: str = "HS256"
    auth_otp_minutes: int = 10
    password_reset_token_minutes: int = 30
    password_reset_url_template: str | None = None
    otp_expiry_minutes: int | None = None
    otp_resend_cooldown_seconds: int = 60
    totp_issuer_name: str | None = None
    totp_step_seconds: int = 30
    totp_digits: int = 6
    totp_max_failed_attempts: int = 5
    totp_lock_seconds: int = 60
    auth_max_failed_attempts: int = 6
    auth_lock_minutes: int = 15
    session_idle_timeout_minutes: int = 120
    active_user_window_days: int = 30
    default_api_usage_unit_cost: float = 0.0
    openai_input_cost_per_1m_tokens: float = 0.0
    openai_output_cost_per_1m_tokens: float = 0.0
    x_api_call_cost: float = 0.0
    default_tenant_name: str = "Default Workspace"
    default_tenant_slug: str = "default-workspace"
    super_admin_name: str = "Platform Super Admin"
    super_admin_email: str = "admin@example.com"
    super_admin_password: str = "ChangeMe123!"
    email_otp_sender: str | None = None
    ses_from_email: str | None = None
    ses_from_name: str | None = None
    email_provider: str = "console"  # console | sendgrid | aws_ses | smtp
    sendgrid_api_key: str | None = None
    aws_region: str | None = None
    aws_ses_region: str | None = None
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    aws_ses_configuration_set: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 20

    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    ai_privacy_mode: bool = True
    ocr_enabled: bool = True
    ocr_only_threat_signals: bool = False
    ocr_max_images_per_event: int = 1
    ocr_max_chars: int = 900
    ocr_vision_model: str | None = None
    reports_dir: str = "./data/reports"

    trusted_domains: str = (
        "cnn.com,edition.cnn.com,alarabiya.net,gulfnews.com,wam.ae,24.ae,sharjah24.ae,alroeya.com,"
        "emaratalyoum.com,albayan.ae,alkhaleej.ae,alittihad.ae,khaleejtimes.com,emirates247.com,thenationalnews.com,"
        "news.sky.com,skynews.com,skynewsarabia.com,"
        "bbc.com,france24.com,arabic.rt.com,rt.com,independentarabia.com,"
        "reliefweb.int,gdacs.org,cisa.gov,"
        "opensky-network.org,api.jsoncargo.com,jsoncargo.com,marinetraffic.com,flightradar24.com,"
        "youtube.com,www.youtube.com,youtu.be,x.com,twitter.com"
    )

    fr24_api_key: str | None = None
    fr24_auth_header: str = "x-apikey"
    fr24_auth_scheme: str | None = None
    fr24_accept_version: str | None = None
    fr24_api_key_param: str | None = None

    marinetraffic_api_key: str | None = None
    marinetraffic_auth_header: str | None = None
    marinetraffic_api_key_param: str = "api_key"
    jsoncargo_api_key: str | None = None
    jsoncargo_auth_header: str = "x-api-key"
    jsoncargo_api_key_param: str | None = None

    newsdata_api_key: str | None = None
    gnews_api_key: str | None = None
    newsapi_api_key: str | None = None
    aviationstack_api_key: str | None = None
    aviationstack_base_url: str = "https://api.aviationstack.com/v1"
    aviationstack_request_limit: int = 60
    comtrade_api_key: str | None = None
    comtrade_base_url: str = "https://comtradeapi.worldbank.org"
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
    default_marine_parser_hint: str = "jsoncargo"
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
    default_uae_casualty_feed: str | None = (
        "https://news.google.com/rss/search?q="
        "(site:ncema.gov.ae%20OR%20site:mod.gov.ae%20OR%20site:moi.gov.ae%20OR%20site:wam.ae%20OR%20site:thenationalnews.com%20OR%20site:khaleejtimes.com%20OR%20site:gulfnews.com)"
        "%20(UAE%20OR%20%D8%A7%D9%84%D8%A5%D9%85%D8%A7%D8%B1%D8%A7%D8%AA)"
        "%20(Iran%20OR%20%D8%A5%D9%8A%D8%B1%D8%A7%D9%86)"
        "%20(deaths%20OR%20killed%20OR%20fatalities%20OR%20%D9%88%D9%81%D8%A7%D8%A9%20OR%20%D9%82%D8%AA%D9%84%D9%89%20OR%20%D8%B6%D8%AD%D8%A7%D9%8A%D8%A7%20OR%20injured%20OR%20%D8%A5%D8%B5%D8%A7%D8%A8%D8%A7%D8%AA)"
        "&hl=en-US&gl=US&ceid=US:en"
    )

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

    @cached_property
    def effective_auth_otp_minutes(self) -> int:
        raw = self.otp_expiry_minutes if self.otp_expiry_minutes is not None else self.auth_otp_minutes
        return max(1, int(raw))

    @cached_property
    def effective_password_reset_token_minutes(self) -> int:
        return max(5, int(self.password_reset_token_minutes or 30))

    @cached_property
    def effective_aws_ses_region(self) -> str | None:
        value = (self.aws_ses_region or self.aws_region or "").strip()
        return value or None

    @cached_property
    def effective_email_sender(self) -> str | None:
        email = (self.email_otp_sender or self.ses_from_email or "").strip()
        if not email:
            return None
        name = (self.ses_from_name or "").strip()
        if not name:
            return email
        if "<" in email and ">" in email:
            return email
        return f"{name} <{email}>"

    @cached_property
    def effective_totp_issuer_name(self) -> str:
        issuer = (self.totp_issuer_name or self.app_name or "OSINT Monitor").strip()
        return issuer or "OSINT Monitor"

    @cached_property
    def effective_password_reset_url_template(self) -> str:
        value = (self.password_reset_url_template or "").strip()
        if value:
            return value
        return "http://localhost:5174/?auth=reset&token={token}"


settings = Settings()
