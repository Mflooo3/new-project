from fastapi import Header, HTTPException, Query, status

from app.config import settings


def require_api_key(
    x_api_key: str | None = Header(default=None),
    api_key: str | None = Query(default=None),
) -> None:
    if not settings.api_key_enabled:
        return

    expected = settings.app_api_key
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API key auth is enabled but APP_API_KEY is not configured",
        )

    provided = x_api_key or api_key
    if provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
