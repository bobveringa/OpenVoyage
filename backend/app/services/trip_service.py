import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from models.api.pagination import SortDirection
from models.api.trips import TripCreateRequest, TripSortField
from models.database.media import Media
from models.database.trips import Trip, TripMember, TripRole, TripVisibility
from models.database.user import User


class TripNotFoundError(Exception):
    """Raised when a trip cannot be found."""


class MediaNotFoundError(Exception):
    """Raised when requested cover media cannot be found."""


class CoverMediaOwnershipError(Exception):
    """Raised when a user tries to use media they do not own."""


class CoverMediaAlreadyUsedError(Exception):
    """Raised when media is already used as a trip cover."""


class TripPermissionError(Exception):
    """Raised when a trip member does not have enough privileges."""


class TripMemberNotFoundError(Exception):
    """Raised when a trip membership cannot be found."""


class TripMemberAlreadyExistsError(Exception):
    """Raised when a trip membership already exists."""


class LastTripOwnerError(Exception):
    """Raised when an action would remove the final trip owner."""


class UserNotFoundError(Exception):
    """Raised when a user cannot be found."""


class TripService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_trip(
        self,
        payload: TripCreateRequest,
        current_user_id: uuid.UUID,
    ) -> Trip:
        media = self.db.get(Media, payload.media_id)
        if media is None:
            raise MediaNotFoundError(f'Media not found: {payload.media_id}')

        if media.created_by != current_user_id:
            raise CoverMediaOwnershipError(
                'The selected media is not owned by the user'
            )

        existing_trip_id = self.db.execute(
            select(Trip.id).where(Trip.cover_media_id == payload.media_id)
        ).scalar_one_or_none()
        if existing_trip_id is not None:
            raise CoverMediaAlreadyUsedError(
                f'Media is already used as a trip cover: {payload.media_id}'
            )

        trip = Trip(
            name=payload.name,
            description=payload.description,
            visibility=payload.visibility,
            cover_media_id=payload.media_id,
        )
        self.db.add(trip)
        self.db.flush()

        self.db.add(
            TripMember(
                trip_id=trip.id,
                user_id=current_user_id,
                role=TripRole.OWNER,
            )
        )
        self.db.commit()
        self.db.refresh(trip)
        return trip

    def get_trip(self, trip_id: uuid.UUID, current_user_id: uuid.UUID | None) -> Trip:
        statement = (
            select(Trip).options(joinedload(Trip.cover_media)).where(Trip.id == trip_id)
        )
        trip = self.db.execute(statement).scalar_one_or_none()
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if trip.visibility == TripVisibility.PUBLIC:
            return trip
        if current_user_id is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        membership = self.db.execute(
            select(TripMember).where(
                TripMember.trip_id == trip_id,
                TripMember.user_id == current_user_id,
            )
        ).scalar_one_or_none()
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return trip

    def list_trips_for_user(
        self,
        current_user_id: uuid.UUID,
        *,
        offset: int,
        limit: int,
        sort_by: TripSortField,
        sort_order: SortDirection,
    ) -> tuple[list[Trip], int]:
        sort_columns = {
            TripSortField.CREATED_AT: Trip.created_at,
            TripSortField.UPDATED_AT: Trip.updated_at,
            TripSortField.NAME: Trip.name,
        }
        sort_column = sort_columns[sort_by]
        sort_expression = (
            sort_column.asc() if sort_order == SortDirection.ASC else sort_column.desc()
        )

        total_statement = (
            select(func.count())
            .select_from(Trip)
            .join(TripMember)
            .where(TripMember.user_id == current_user_id)
        )
        statement = (
            select(Trip)
            .join(TripMember)
            .options(joinedload(Trip.cover_media))
            .where(TripMember.user_id == current_user_id)
            .order_by(sort_expression, Trip.id.asc())
            .offset(offset)
            .limit(limit)
        )
        trips = list(self.db.execute(statement).scalars().all())
        total = self.db.execute(total_statement).scalar_one()
        return trips, total

    def list_trip_members(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> list[TripMember]:
        self._require_trip_access(trip_id=trip_id, current_user_id=current_user_id)

        statement = (
            select(TripMember)
            .join(TripMember.user)
            .options(joinedload(TripMember.user).joinedload(User.profile))
            .where(TripMember.trip_id == trip_id)
            .order_by(User.email.asc(), TripMember.user_id.asc())
        )
        return list(self.db.execute(statement).scalars().all())

    def add_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
        role: TripRole,
    ) -> TripMember:
        self._require_trip_owner(trip_id=trip_id, user_id=current_user_id)

        target_user = self.db.get(User, target_user_id)
        if target_user is None:
            raise UserNotFoundError(f'User not found: {target_user_id}')

        existing_membership = self._get_membership(
            trip_id=trip_id,
            user_id=target_user_id,
        )
        if existing_membership is not None:
            raise TripMemberAlreadyExistsError(
                f'User is already a trip member: {target_user_id}'
            )

        membership = TripMember(
            trip_id=trip_id,
            user_id=target_user_id,
            role=role,
        )
        self.db.add(membership)
        self.db.commit()
        self.db.refresh(membership)
        return membership

    def update_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
        role: TripRole,
    ) -> TripMember:
        self._require_trip_owner(trip_id=trip_id, user_id=current_user_id)
        membership = self._get_trip_member_or_raise(
            trip_id=trip_id,
            user_id=target_user_id,
        )

        if membership.role == TripRole.OWNER and role != TripRole.OWNER:
            self._raise_if_last_owner(trip_id=trip_id)

        membership.role = role
        self.db.commit()
        self.db.refresh(membership)
        return membership

    def remove_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
    ) -> None:
        self._require_trip_owner(trip_id=trip_id, user_id=current_user_id)
        membership = self._get_trip_member_or_raise(
            trip_id=trip_id,
            user_id=target_user_id,
        )

        if membership.role == TripRole.OWNER:
            self._raise_if_last_owner(trip_id=trip_id)

        self.db.delete(membership)
        self.db.commit()

    def _get_membership(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember | None:
        return self.db.execute(
            select(TripMember).where(
                TripMember.trip_id == trip_id,
                TripMember.user_id == user_id,
            )
        ).scalar_one_or_none()

    def _require_trip_access(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> TripMember:
        membership = self._get_membership(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return membership

    def _get_trip_member_or_raise(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        membership = self._get_membership(trip_id=trip_id, user_id=user_id)
        if membership is None:
            raise TripMemberNotFoundError(f'Trip member not found: {user_id}')
        return membership

    def _require_trip_owner(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        membership = self._require_trip_access(
            trip_id=trip_id,
            current_user_id=user_id,
        )
        if membership.role != TripRole.OWNER:
            raise TripPermissionError('The user does not have enough privileges')
        return membership

    def _raise_if_last_owner(self, trip_id: uuid.UUID) -> None:
        owner_count = self.db.execute(
            select(func.count())
            .select_from(TripMember)
            .where(
                TripMember.trip_id == trip_id,
                TripMember.role == TripRole.OWNER,
            )
        ).scalar_one()
        if owner_count <= 1:
            raise LastTripOwnerError('Cannot remove the last trip owner')
