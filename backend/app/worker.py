from rq import Worker

from app.services.queue import get_ingestion_queue, get_redis_connection


def main() -> None:
    connection = get_redis_connection()
    queue = get_ingestion_queue(connection=connection)
    worker = Worker(queues=[queue], connection=connection)
    worker.work()


if __name__ == "__main__":
    main()
