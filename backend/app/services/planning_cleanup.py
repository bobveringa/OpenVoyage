"""Remove temporary artifacts and provider-owned data without removing trip-owned intent."""

from sqlalchemy import delete, select, update

from models.database.itinerary import (
    ItineraryPlanningArtifact,
    ItinerarySegmentFlight,
    ItinerarySegmentRoute,
    ItineraryTravelSegment,
)
from models.database.trips import Trip


def revoke_planning_artifacts(db, trip_id, user_id):
    db.execute(
        delete(ItineraryPlanningArtifact).where(
            ItineraryPlanningArtifact.trip_id == trip_id,
            ItineraryPlanningArtifact.created_by_user_id == user_id,
        )
    )


def clear_account_flight_snapshots(db, user_id):
    segments = list(
        db.scalars(
            select(ItineraryTravelSegment)
            .join(
                ItinerarySegmentFlight,
                ItinerarySegmentFlight.segment_id == ItineraryTravelSegment.id,
            )
            .where(ItinerarySegmentFlight.lookup_owner_user_id == user_id)
        )
    )
    legs = {s.leg_id for s in segments}
    trips = {s.trip_id for s in segments}
    if not legs:
        return
    affected_segments = select(ItineraryTravelSegment.id).where(
        ItineraryTravelSegment.leg_id.in_(legs)
    )
    db.execute(
        delete(ItinerarySegmentRoute).where(
            ItinerarySegmentRoute.segment_id.in_(affected_segments)
        )
    )
    db.execute(
        delete(ItineraryPlanningArtifact).where(
            ItineraryPlanningArtifact.leg_id.in_(legs)
        )
    )
    db.execute(
        update(ItinerarySegmentFlight)
        .where(ItinerarySegmentFlight.lookup_owner_user_id == user_id)
        .values(
            lookup=None,
            lookup_owner_user_id=None,
        )
    )
    db.execute(
        update(ItineraryTravelSegment)
        .where(ItineraryTravelSegment.leg_id.in_(legs))
        .values(
            input_version=ItineraryTravelSegment.input_version + 1,
        )
    )
    db.execute(
        update(Trip)
        .where(Trip.id.in_(trips))
        .values(itinerary_revision=Trip.itinerary_revision + 1)
    )
