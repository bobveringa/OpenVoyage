import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from models.api.pagination import SortDirection
from models.api.trips import TripCreateRequest, TripSortField
from models.database.media import Media
from models.database.trips import Trip, TripMember, TripRole, TripVisibility


class TripNotFoundError(Exception):
    """Raised when a trip cannot be found."""


class MediaNotFoundError(Exception):
    """Raised when requested cover media cannot be found."""


class CoverMediaOwnershipError(Exception):
    """Raised when a user tries to use media they do not own."""


class CoverMediaAlreadyUsedError(Exception):
    """Raised when media is already used as a trip cover."""


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
            sort_column.asc()
            if sort_order == SortDirection.ASC
            else sort_column.desc()
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
