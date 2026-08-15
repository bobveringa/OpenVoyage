import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from starlette import status

from api.deps import AdminUserServiceDep, CurrentAdmin, PaginationDep, SessionDep
from core import security
from models.api.admin import (
    AdminUserCreateRequest,
    AdminUserDeleteResponse,
    AdminUserPasswordSetRequest,
    AdminUserResponse,
    AdminUsersListResponse,
    AdminUserUpdateRequest,
    SetupCreateRequest,
    SetupCreateResponse,
    SetupStatusResponse,
)
from models.database.user import User, UserProfile, UserRole
from services.admin_user_service import (
    AdminUserAlreadyExistsError,
    AdminUserNotFoundError,
    AdminUserProtectedActionError,
)

router = APIRouter(prefix='/admin', tags=['admin'])


def _raise_admin_user_error(exc: Exception) -> None:
    if isinstance(exc, AdminUserNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    if isinstance(exc, (AdminUserAlreadyExistsError, AdminUserProtectedActionError)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    raise exc


@router.get('/setup', response_model=SetupStatusResponse)
def get_setup_status(
    session: SessionDep,
) -> SetupStatusResponse:
    """Report whether this instance still needs its initial administrator."""
    existing_user = session.execute(select(User.id).limit(1)).first()
    return SetupStatusResponse(setup_required=existing_user is None)


@router.post(
    '/setup',
    response_model=SetupCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_setup_admin(
    session: SessionDep, payload: SetupCreateRequest
) -> SetupCreateResponse:
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

    return SetupCreateResponse(
        id=user.id,
        email=user.email,
    )


@router.post(
    '/users',
    response_model=AdminUserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_admin_user(
    payload: AdminUserCreateRequest,
    user_service: AdminUserServiceDep,
    _admin: CurrentAdmin,
) -> AdminUserResponse:
    try:
        user = user_service.create_user(payload)
    except AdminUserAlreadyExistsError as exc:
        _raise_admin_user_error(exc)
    return AdminUserResponse.from_model(user)


@router.get('/users', response_model=AdminUsersListResponse)
def list_admin_users(
    user_service: AdminUserServiceDep,
    _admin: CurrentAdmin,
    pagination: PaginationDep,
    query: Annotated[str | None, Query(min_length=1, max_length=320)] = None,
    role: UserRole | None = None,
) -> AdminUsersListResponse:
    users, total = user_service.list_users(
        offset=pagination.offset,
        limit=pagination.page_size,
        query=query,
        role=role,
    )
    return AdminUsersListResponse(
        users=[AdminUserResponse.from_model(user) for user in users],
        total=total,
        page=pagination.page,
        page_size=pagination.page_size,
    )


@router.get('/users/{user_id}', response_model=AdminUserResponse)
def get_admin_user(
    user_id: uuid.UUID,
    user_service: AdminUserServiceDep,
    _admin: CurrentAdmin,
) -> AdminUserResponse:
    try:
        user = user_service.get_user(user_id)
    except AdminUserNotFoundError as exc:
        _raise_admin_user_error(exc)
    return AdminUserResponse.from_model(user)


@router.patch('/users/{user_id}', response_model=AdminUserResponse)
def update_admin_user(
    user_id: uuid.UUID,
    payload: AdminUserUpdateRequest,
    user_service: AdminUserServiceDep,
    admin: CurrentAdmin,
) -> AdminUserResponse:
    try:
        user = user_service.update_user(
            user_id=user_id,
            actor_id=admin.id,
            payload=payload,
        )
    except (
        AdminUserAlreadyExistsError,
        AdminUserNotFoundError,
        AdminUserProtectedActionError,
    ) as exc:
        _raise_admin_user_error(exc)
    return AdminUserResponse.from_model(user)


@router.put(
    '/users/{user_id}/password',
    status_code=status.HTTP_204_NO_CONTENT,
)
def set_admin_user_password(
    user_id: uuid.UUID,
    payload: AdminUserPasswordSetRequest,
    user_service: AdminUserServiceDep,
    admin: CurrentAdmin,
) -> None:
    try:
        user_service.set_password(
            user_id=user_id,
            actor_id=admin.id,
            payload=payload,
        )
    except (AdminUserNotFoundError, AdminUserProtectedActionError) as exc:
        _raise_admin_user_error(exc)


@router.delete('/users/{user_id}', response_model=AdminUserDeleteResponse)
def delete_admin_user(
    user_id: uuid.UUID,
    user_service: AdminUserServiceDep,
    admin: CurrentAdmin,
) -> AdminUserDeleteResponse:
    try:
        user_service.delete_user(user_id=user_id, actor_id=admin.id)
    except (AdminUserNotFoundError, AdminUserProtectedActionError) as exc:
        _raise_admin_user_error(exc)
    return AdminUserDeleteResponse(id=user_id)
