import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.case_library import router as case_library_router
from app.api.content_generator import router as content_generator_router
from app.api.market_insight import router as market_insight_router
from app.api.notifications import router as notifications_router
from app.api.organizations import router as organizations_router
from app.api.portfolio import router as portfolio_router
from app.api.publishing import router as publishing_router
from app.auth.seed import ensure_demo_user
from app.auth.storage import init_users_db
from app.config import (
    APP_NAME,
    DEBUG,
    ENABLE_DEMO_USER,
    FRONTEND_ORIGINS,
    LEAD_TRACKING_SYNC_ENABLED,
    PUBLISHING_POLL_SECONDS,
    PUBLISHING_SCHEDULER_ENABLED,
)
from app.engines.case_library.import_tasks import init_import_tasks_db
from app.engines.case_library.storage import init_db as init_case_library_db
from app.engines.content_generator.storage import init_db as init_content_generator_db
from app.engines.market_insight.storage import init_db as init_market_insight_db
from app.engines.portfolio.storage import init_db as init_portfolio_db
from app.engines.publishing.lead_tracking import LeadTrackingCommentScheduler
from app.engines.publishing.publication_executor import PublicationExecutor
from app.engines.publishing.storage import init_db as init_publishing_db
from app.media_storage import media_response, validate_media_storage
from app.notifications.storage import init_notifications_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    tasks: list[asyncio.Task[None]] = []
    stops: list[asyncio.Event] = []
    _app.state.publication_scheduler_task = None
    _app.state.lead_tracking_scheduler_task = None
    if not PUBLISHING_SCHEDULER_ENABLED:
        logging.getLogger(__name__).info("Publication scheduler disabled; set PUBLISHING_SCHEDULER_ENABLED=true to enable")
    else:
        stop = asyncio.Event()
        stops.append(stop)
        from app.engines.publishing.platform_publisher import PlatformPublisher

        executor = PublicationExecutor(PlatformPublisher())
        task = asyncio.create_task(executor.serve(stop, interval=PUBLISHING_POLL_SECONDS))
        tasks.append(task)
        _app.state.publication_scheduler_task = task
    if not LEAD_TRACKING_SYNC_ENABLED:
        logging.getLogger(__name__).info(
            "Lead tracking sync disabled; set LEAD_TRACKING_SYNC_ENABLED=true to enable",
        )
    else:
        stop = asyncio.Event()
        stops.append(stop)
        task = asyncio.create_task(LeadTrackingCommentScheduler().serve(stop))
        tasks.append(task)
        _app.state.lead_tracking_scheduler_task = task

    def report_failure(finished: asyncio.Task[None]) -> None:
        if not finished.cancelled() and finished.exception() is not None:
            logging.getLogger(__name__).error(
                "Publication scheduler stopped unexpectedly (%s)", type(finished.exception()).__name__,
            )

    for task in tasks:
        task.add_done_callback(report_failure)
    try:
        yield
    finally:
        for stop in stops:
            stop.set()
        for task in tasks:
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=30)
            except TimeoutError:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
        _app.state.publication_scheduler_task = None
        _app.state.lead_tracking_scheduler_task = None


app = FastAPI(
    title=APP_NAME,
    lifespan=lifespan,
    docs_url="/docs" if DEBUG else None,
    redoc_url="/redoc" if DEBUG else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_origin_regex=r"^(chrome-extension|moz-extension)://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

validate_media_storage()
init_users_db()
init_notifications_db()
init_publishing_db()
init_case_library_db()
init_import_tasks_db()
init_content_generator_db()
init_portfolio_db()
init_market_insight_db()
if ENABLE_DEMO_USER:
    ensure_demo_user()

@app.get("/media/{key:path}", include_in_schema=False)
async def serve_media(key: str):
    return media_response(key, public=True)

app.include_router(market_insight_router)
app.include_router(auth_router)
app.include_router(case_library_router)
app.include_router(content_generator_router)
app.include_router(portfolio_router)
app.include_router(publishing_router)
app.include_router(organizations_router)
app.include_router(notifications_router)


@app.get("/")
async def root():
    scheduler = getattr(app.state, "publication_scheduler_task", None)
    lead_scheduler = getattr(app.state, "lead_tracking_scheduler_task", None)
    return {
        "app": APP_NAME, "status": "running",
        "publishing_scheduler_enabled": PUBLISHING_SCHEDULER_ENABLED,
        "publishing_scheduler_running": scheduler is not None and not scheduler.done(),
        "lead_tracking_sync_enabled": LEAD_TRACKING_SYNC_ENABLED,
        "lead_tracking_scheduler_running": (
            lead_scheduler is not None and not lead_scheduler.done()
        ),
    }
