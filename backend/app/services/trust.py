from urllib.parse import urlparse

from app.config import settings


def _normalize_domain(url_or_domain: str | None) -> str:
    if not url_or_domain:
        return ""
    raw = url_or_domain.strip().lower()
    if "://" in raw:
        parsed = urlparse(raw)
        host = parsed.netloc.lower()
    else:
        host = raw
    if host.startswith("www."):
        host = host[4:]
    return host


def is_trusted_domain(url_or_domain: str | None) -> bool:
    host = _normalize_domain(url_or_domain)
    if not host:
        return False
    for trusted in settings.trusted_domains_set:
        trusted_host = _normalize_domain(trusted)
        if host == trusted_host or host.endswith(f".{trusted_host}"):
            return True
    return False


def is_trusted_event(source_type: str, source_name: str | None, url: str | None) -> bool:
    if is_trusted_domain(url):
        return True
    name = (source_name or "").lower()
    # Treat platform feeds we integrate directly as trusted unless overridden by URL checks above.
    if source_type in {"flight", "marine", "cyber", "incident"}:
        return True
    trusted_name_markers = {
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
        "flightradar",
    }
    return any(marker in name for marker in trusted_name_markers)
