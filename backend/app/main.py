from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.staticfiles import StaticFiles

from api.main import api_router
from api.routers import health
from core.config import settings
from jobs.runtime import JobRuntime


@asynccontextmanager
async def lifespan(app: FastAPI):
    runtime = JobRuntime()
    app.state.job_runtime = runtime
    runtime.start()
    try:
        yield
    finally:
        runtime.stop()


app = FastAPI(
    title='OpenVoyage API',
    version='0.1.0',
    lifespan=lifespan,
)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
        # Date is not a CORS-safelisted response header, so without this the
        # native app (served from http://localhost, talking cross-origin to
        # the API) reads null for it and its pre-start clock-skew check
        # silently passes no matter how wrong the device clock is. Samples
        # recorded with a skewed clock fall outside [started_at, now) and the
        # server discards them without complaint, so the check has to work.
        expose_headers=['Date'],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(health.router)


def configure_frontend(app: FastAPI) -> None:
    """Serve the compiled SPA when it is packaged with the API."""
    if not settings.FRONTEND_DIST_DIRECTORY:
        return

    frontend_directory = Path(settings.FRONTEND_DIST_DIRECTORY).resolve()
    index_file = frontend_directory / 'index.html'
    if not index_file.is_file():
        raise RuntimeError(
            f'Frontend build not found at {frontend_directory}. '
            'Build the frontend or remove FRONTEND_DIST_DIRECTORY.'
        )

    assets_directory = frontend_directory / 'assets'
    if assets_directory.is_dir():
        app.mount(
            '/assets',
            StaticFiles(directory=assets_directory),
            name='frontend-assets',
        )

    @app.get('/{full_path:path}', include_in_schema=False)
    async def serve_frontend(full_path: str):
        requested_file = (frontend_directory / full_path).resolve()
        if requested_file.is_relative_to(frontend_directory) and requested_file.is_file():
            return FileResponse(requested_file)
        return FileResponse(index_file)


configure_frontend(app)
