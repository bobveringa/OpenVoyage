from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from api.main import api_router
from core.config import settings

app = FastAPI(
    title='OpenVoyage API',
    version='0.1.0',
)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=['*'],
        allow_headers=['*'],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)
