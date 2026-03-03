from sqlmodel import Session

from app.database import engine
from app.services.ingestion import IngestionService


def run_ingestion_job(force: bool = False) -> dict[str, int]:
    with Session(engine) as session:
        return IngestionService(session=session).run_once(force=force)
