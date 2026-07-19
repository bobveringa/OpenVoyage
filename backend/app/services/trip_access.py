from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.database.base import utcnow
from models.database.trips import (
    Trip,
    TripMember,
    TripRole,
    TripShareLink,
    TripViewer,
    TripVisibility,
)

SHARE_TOKEN_HEADER = 'X-Trip-Share-Token'


class TripAccessSource(str, Enum):
    PARTICIPANT = 'participant'
    DIRECT_VIEWER = 'direct_viewer'
    SHARE_LINK = 'share_link'
    PLATFORM_PUBLIC = 'platform_public'
    PUBLIC = 'public'


@dataclass(frozen=True)
class TripReadAccess:
    trip: Trip
    source: TripAccessSource
    membership: TripMember | None = None
    viewer: TripViewer | None = None
    share_link: TripShareLink | None = None

    @property
    def can_read_drafts(self) -> bool:
        return self.membership is not None and self.membership.role in {
            TripRole.OWNER,
            TripRole.MEMBER,
        }


def generate_share_token() -> str:
    """Return a random raw share token suitable for one-time display."""
    return secrets.token_urlsafe(32)


def hash_share_token(token: str) -> str:
    """Return the stable storage hash for a raw share token."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def get_membership(
    db: Session,
    *,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
) -> TripMember | None:
    return db.execute(
        select(TripMember).where(
            TripMember.trip_id == trip_id,
            TripMember.user_id == user_id,
        )
    ).scalar_one_or_none()


def get_direct_viewer(
    db: Session,
    *,
    trip_id: uuid.UUID,
    user_id: uuid.UUID,
) -> TripViewer | None:
    return db.execute(
        select(TripViewer).where(
            TripViewer.trip_id == trip_id,
            TripViewer.user_id == user_id,
        )
    ).scalar_one_or_none()


def get_valid_share_link(
    db: Session,
    *,
    trip_id: uuid.UUID,
    share_token: str | None,
) -> TripShareLink | None:
    if not share_token:
        return None

    token_hash = hash_share_token(share_token)
    share_link = db.execute(
        select(TripShareLink).where(
            TripShareLink.trip_id == trip_id,
            TripShareLink.token_hash == token_hash,
        )
    ).scalar_one_or_none()
    if share_link is None:
        return None

    now = utcnow()
    if share_link.revoked_at is not None:
        return None
    if share_link.expires_at is not None and share_link.expires_at <= now:
        return None

    share_link.last_used_at = now
    db.add(share_link)
    db.flush()
    return share_link


def get_trip_read_access(
    db: Session,
    *,
    trip_id: uuid.UUID,
    current_user_id: uuid.UUID | None,
    share_token: str | None = None,
) -> TripReadAccess | None:
    """Return the strongest read access available for a trip."""
    trip = db.get(Trip, trip_id)
    if trip is None:
        return None

    if current_user_id is not None:
        membership = get_membership(
            db,
            trip_id=trip_id,
            user_id=current_user_id,
        )
        if membership is not None:
            return TripReadAccess(
                trip=trip,
                source=TripAccessSource.PARTICIPANT,
                membership=membership,
            )

        viewer = get_direct_viewer(
            db,
            trip_id=trip_id,
            user_id=current_user_id,
        )
        if viewer is not None:
            return TripReadAccess(
                trip=trip,
                source=TripAccessSource.DIRECT_VIEWER,
                viewer=viewer,
            )

    share_link = get_valid_share_link(
        db,
        trip_id=trip_id,
        share_token=share_token,
    )
    if share_link is not None:
        return TripReadAccess(
            trip=trip,
            source=TripAccessSource.SHARE_LINK,
            share_link=share_link,
        )

    if trip.visibility == TripVisibility.PUBLIC:
        return TripReadAccess(trip=trip, source=TripAccessSource.PUBLIC)

    if (
        trip.visibility == TripVisibility.PLATFORM_PUBLIC
        and current_user_id is not None
    ):
        return TripReadAccess(
            trip=trip,
            source=TripAccessSource.PLATFORM_PUBLIC,
        )

    return None
