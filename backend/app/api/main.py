from fastapi import APIRouter

from api.routers import admin, itinerary, login, media, places, posts, trips, users

api_router = APIRouter()

api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(admin.router)
api_router.include_router(media.router)
api_router.include_router(places.router)
api_router.include_router(trips.router)
api_router.include_router(itinerary.router)
api_router.include_router(posts.router)
