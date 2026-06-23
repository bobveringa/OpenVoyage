import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from models.api.trips import TripCreateRequest
from models.database.media import Media
from models.database.trips import Trip, TripMember, TripRole


class TripNotFoundError(Exception):
    """Raised when a trip cannot be found."""


class MediaNotFoundError(Exception):
    """Raised when requested cover media cannot be found."""


class CoverMediaOwnershipError(Exception):
    """Raised when a user tries to use media they do not own."""


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

    def get_trip(self, trip_id: uuid.UUID) -> Trip:
        return self.get_public_trip(trip_id=trip_id)

    def get_public_trip(self, trip_id: uuid.UUID) -> Trip:
        statement = (
            select(Trip).options(joinedload(Trip.cover_media)).where(Trip.id == trip_id)
        )
        trip = self.db.execute(statement).scalar_one_or_none()
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return trip
