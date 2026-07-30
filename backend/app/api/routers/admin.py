import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from starlette import status

from api.deps import CurrentAdmin, PlaceServiceDep, SessionDep
from core import security
from models.api.admin import (
    FirstUserCreateRequest,
    FirstUserCreateResponse,
    PlaceImportRequest,
    PlaceImportResponse,
)
from models.database.user import User, UserProfile, UserRole
from services.place_service import GeoNamesDataset

router = APIRouter(prefix='/admin', tags=['admin'])


@router.post(
    '/first-user',
    response_model=FirstUserCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_first_user(
    session: SessionDep, payload: FirstUserCreateRequest
) -> FirstUserCreateResponse:
    existing_user = session.execute(select(User.id).limit(1)).first()
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail='First user already exists',
        )

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=payload.email.lower(),
        password_hash=security.get_password_hash(payload.password),
        role=UserRole.ADMIN,
    )
    profile = UserProfile(
        user=user,
        username=payload.username,
        first_name=payload.first_name,
        last_name=payload.last_name,
    )

    session.add(user)
    session.add(profile)
    session.commit()
    session.refresh(user)

    return FirstUserCreateResponse(
        id=user.id,
        email=user.email,
    )


@router.post('/places/import', response_model=PlaceImportResponse)
def import_places(
    payload: PlaceImportRequest,
    place_service: PlaceServiceDep,
    _admin: CurrentAdmin,
) -> PlaceImportResponse:
    result = place_service.import_geonames_dataset(
        dataset=GeoNamesDataset(payload.dataset),
        replace_existing=payload.replace_existing,
    )
    return PlaceImportResponse(
        deleted=result.deleted,
        dataset=result.dataset.value,
        processed=result.processed,
    )
