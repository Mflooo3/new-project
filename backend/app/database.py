from collections.abc import Generator

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine

from app.config import settings


def _engine_kwargs() -> dict:
    if settings.database_url.startswith("sqlite"):
        return {"connect_args": {"check_same_thread": False}}
    return {}


engine = create_engine(settings.database_url, echo=False, **_engine_kwargs())


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _run_lightweight_migrations()


def _table_columns(conn, table_name: str) -> set[str]:
    if engine.dialect.name == "sqlite":
        rows = conn.execute(text(f"PRAGMA table_info('{table_name}')")).fetchall()
        return {str(row[1]).lower() for row in rows}
    rows = conn.execute(
        text(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = :table_name
            """
        ),
        {"table_name": table_name},
    ).fetchall()
    return {str(row[0]).lower() for row in rows}


def _ensure_column(conn, table_name: str, column_name: str, ddl_tail: str) -> None:
    columns = _table_columns(conn, table_name)
    if column_name.lower() in columns:
        return
    conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl_tail}"))


def _run_lightweight_migrations() -> None:
    with engine.begin() as conn:
        _ensure_column(conn, "appuser", "failed_login_attempts", "INTEGER DEFAULT 0")
        _ensure_column(conn, "appuser", "locked_until", "TIMESTAMP")
        _ensure_column(conn, "appuser", "totp_enabled", "BOOLEAN DEFAULT FALSE")
        _ensure_column(conn, "appuser", "totp_secret", "TEXT")
        _ensure_column(conn, "appuser", "totp_pending_secret", "TEXT")
        _ensure_column(conn, "appuser", "totp_enabled_at", "TIMESTAMP")
        _ensure_column(conn, "appuser", "totp_last_used", "TIMESTAMP")
        _ensure_column(conn, "appuser", "totp_failed_attempts", "INTEGER DEFAULT 0")
        _ensure_column(conn, "appuser", "totp_locked_until", "TIMESTAMP")
        _ensure_column(conn, "appuser", "last_active_at", "TIMESTAMP")
        _ensure_column(conn, "appuser", "login_count", "INTEGER DEFAULT 0")
        _ensure_column(conn, "appuser", "page_access", "TEXT DEFAULT 'v1'")
        _ensure_column(conn, "usersession", "session_id", "TEXT")
        conn.execute(
            text(
                """
                UPDATE appuser
                SET page_access = CASE
                    WHEN LOWER(COALESCE(access_version, 'v1')) = 'v2' THEN 'v1,v2,xintel'
                    ELSE 'v1'
                END
                WHERE page_access IS NULL OR TRIM(page_access) = ''
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE usersession
                SET session_id = COALESCE(session_id, '')
                WHERE session_id IS NULL
                """
            )
        )
        conn.execute(
            text(
                """
                UPDATE appuser
                SET totp_enabled = COALESCE(totp_enabled, FALSE),
                    totp_failed_attempts = COALESCE(totp_failed_attempts, 0)
                """
            )
        )
        _ensure_column(conn, "source", "tenant_id", "INTEGER")
        _ensure_column(conn, "event", "tenant_id", "INTEGER")
        _ensure_column(conn, "alert", "tenant_id", "INTEGER")
        _ensure_column(conn, "aichatmessage", "tenant_id", "INTEGER")
        _ensure_column(conn, "aichatmessage", "user_id", "INTEGER")
        _ensure_column(conn, "aiinsight", "tenant_id", "INTEGER")
        _ensure_column(conn, "aiinsight", "user_id", "INTEGER")
        _ensure_column(conn, "aipredictionticket", "tenant_id", "INTEGER")
        _ensure_column(conn, "aipredictionticket", "user_id", "INTEGER")
        _ensure_column(conn, "aipredictionupdate", "tenant_id", "INTEGER")
        _ensure_column(conn, "aipredictionupdate", "user_id", "INTEGER")


def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
