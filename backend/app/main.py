from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app.api.routes import public_router, router
from app.config import settings
from app.database import engine, init_db
from app.services.bootstrap import seed_default_sources
from app.services.scheduler import start_scheduler, stop_scheduler

app = FastAPI(title=settings.app_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public_router)
app.include_router(router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    with Session(engine) as session:
        seed_default_sources(session)
    start_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_scheduler()
