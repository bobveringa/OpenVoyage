from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.api.gps_privacy_zones import MAX_ZONES_PER_USER, GpsPrivacyZoneRequest
from models.database.gps_privacy_zones import GpsPrivacyZone
from models.database.trips import TripMember
from services.gps.geometry import is_within_radius


class PrivacyZoneNotFoundError(Exception):
    """Raised when a privacy zone does not exist or belongs to another user."""


class PrivacyZoneLimitError(Exception):
    """Raised when a user already holds the maximum number of zones."""


class GpsPrivacyZoneService:
    """Manages account privacy zones and their use by trip tracking."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def list_zones(self, *, user_id: uuid.UUID) -> list[GpsPrivacyZone]:
        return list(
            self.db.execute(
                select(GpsPrivacyZone)
                .where(GpsPrivacyZone.user_id == user_id)
                .order_by(GpsPrivacyZone.created_at.asc(), GpsPrivacyZone.id.asc())
            )
            .scalars()
            .all()
        )

    def create_zone(
        self,
        *,
        user_id: uuid.UUID,
        payload: GpsPrivacyZoneRequest,
    ) -> GpsPrivacyZone:
        existing_count = self.db.execute(
            select(func.count())
            .select_from(GpsPrivacyZone)
            .where(GpsPrivacyZone.user_id == user_id)
        ).scalar_one()
        if existing_count >= MAX_ZONES_PER_USER:
            raise PrivacyZoneLimitError(
                f'A user may hold at most {MAX_ZONES_PER_USER} privacy zones'
            )

        zone = GpsPrivacyZone(
            user_id=user_id,
            name=payload.name,
            latitude=payload.latitude,
            longitude=payload.longitude,
            radius_meters=payload.radius_meters,
        )
        self.db.add(zone)
        self.db.commit()
        self.db.refresh(zone)
        return zone

    def replace_zone(
        self,
        *,
        user_id: uuid.UUID,
        zone_id: uuid.UUID,
        payload: GpsPrivacyZoneRequest,
    ) -> GpsPrivacyZone:
        zone = self._require_own_zone(user_id=user_id, zone_id=zone_id)
        zone.name = payload.name
        zone.latitude = payload.latitude
        zone.longitude = payload.longitude
        zone.radius_meters = payload.radius_meters
        self.db.add(zone)
        self.db.commit()
        self.db.refresh(zone)
        return zone

    def delete_zone(self, *, user_id: uuid.UUID, zone_id: uuid.UUID) -> None:
        zone = self._require_own_zone(user_id=user_id, zone_id=zone_id)
        self.db.delete(zone)
        self.db.commit()

    def list_trip_member_zone_coordinates(
        self,
        *,
        trip_id: uuid.UUID,
    ) -> list[tuple[float, float, int]]:
        """Return every current trip member's ``(latitude, longitude, radius)``."""
        rows = self.db.execute(
            select(
                GpsPrivacyZone.latitude,
                GpsPrivacyZone.longitude,
                GpsPrivacyZone.radius_meters,
            )
            .join(TripMember, TripMember.user_id == GpsPrivacyZone.user_id)
            .where(TripMember.trip_id == trip_id)
        ).all()
        return [(row[0], row[1], row[2]) for row in rows]

    @staticmethod
    def is_within_any_zone(
        *,
        latitude: float,
        longitude: float,
        zones: list[tuple[float, float, int]],
    ) -> bool:
        return any(
            is_within_radius(
                latitude,
                longitude,
                zone_latitude,
                zone_longitude,
                float(radius_meters),
            )
            for zone_latitude, zone_longitude, radius_meters in zones
        )

    def _require_own_zone(
        self,
        *,
        user_id: uuid.UUID,
        zone_id: uuid.UUID,
    ) -> GpsPrivacyZone:
        zone = self.db.execute(
            select(GpsPrivacyZone).where(
                GpsPrivacyZone.id == zone_id,
                GpsPrivacyZone.user_id == user_id,
            )
        ).scalar_one_or_none()
        if zone is None:
            raise PrivacyZoneNotFoundError(f'Privacy zone not found: {zone_id}')
        return zone
