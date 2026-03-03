from typing import Any

from redis import Redis
from rq import Queue
from rq.exceptions import NoSuchJobError
from rq.job import Job

from app.config import settings


def get_redis_connection() -> Redis:
    return Redis.from_url(settings.redis_url)


def get_ingestion_queue(connection: Redis | None = None) -> Queue:
    return Queue(name=settings.ingest_queue_name, connection=connection or get_redis_connection())


def enqueue_ingestion_job(force: bool = False) -> Job:
    queue = get_ingestion_queue()
    return queue.enqueue(
        "app.services.tasks.run_ingestion_job",
        force=force,
        job_timeout=1200,
        result_ttl=3600,
        failure_ttl=3600,
    )


def fetch_job(job_id: str) -> Job | None:
    try:
        return Job.fetch(job_id, connection=get_redis_connection())
    except NoSuchJobError:
        return None


def job_payload(job: Job) -> dict[str, Any]:
    status = job.get_status(refresh=True)
    result = job.result if isinstance(job.result, dict) else None
    error = None
    if job.exc_info:
        lines = [line for line in job.exc_info.strip().splitlines() if line.strip()]
        error = lines[-1] if lines else "job failed"
    return {
        "job_id": job.id,
        "status": status,
        "result": result,
        "error": error,
    }
