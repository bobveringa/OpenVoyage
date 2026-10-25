"""Actor-scoped preview and flight-candidate persistence."""

import uuid
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select

from models.api.planning import FlightCandidate, FlightLookup, FlightLookupResponse
from models.database.base import utcnow
from models.database.itinerary import ItineraryPlanningArtifact
from services.planning_geometry import fingerprint
from services.flight_airports import resolve_flight_lookup_airports


class PlanningArtifactStore:
    def __init__(self, db):
        self.db = db

    def cached_preview(self, scope, actor, revision, binding):
        return self.db.scalar(
            select(ItineraryPlanningArtifact)
            .where(
                ItineraryPlanningArtifact.kind == 'PREVIEW',
                ItineraryPlanningArtifact.trip_id == scope.trip_id,
                ItineraryPlanningArtifact.connection_id == scope.id,
                ItineraryPlanningArtifact.created_by_user_id == actor,
                ItineraryPlanningArtifact.itinerary_revision == revision,
                ItineraryPlanningArtifact.input_hash == binding,
                ItineraryPlanningArtifact.expires_at > utcnow(),
            )
            .order_by(ItineraryPlanningArtifact.created_at.desc())
        )

    def get(self, artifact_id, kind, connection, actor, revision=None, binding=None):
        row = self.db.get(ItineraryPlanningArtifact, artifact_id)
        if (
            row is None
            or row.kind != kind
            or row.trip_id != connection.trip_id
            or row.connection_id
            != getattr(connection, 'artifact_connection_id', connection.id)
            or row.created_by_user_id != actor
            or row.expires_at <= utcnow()
            or (revision is not None and row.itinerary_revision != revision)
            or (
                binding is not None
                and row.input_hash != binding
                and not (
                    kind == 'PREVIEW'
                    and row.payload.get('resolved_input_hash') == binding
                )
            )
        ):
            raise HTTPException(
                409,
                'LOOKUP_EXPIRED' if kind == 'FLIGHT_CANDIDATE' else 'PREVIEW_EXPIRED',
            )
        return row

    def create(
        self, kind, connection_id, trip_id, actor, payload, binding, revision=None
    ):
        row = ItineraryPlanningArtifact(
            id=uuid.uuid4(),
            kind=kind,
            connection_id=connection_id,
            trip_id=trip_id,
            created_by_user_id=actor,
            itinerary_revision=revision,
            input_hash=binding,
            payload=payload,
            expires_at=utcnow()
            + (timedelta(days=7) if kind == 'PREVIEW' else timedelta(minutes=10)),
        )
        self.db.add(row)
        return row

    def cached_flights(self, connection, actor, intent):
        binding = fingerprint(intent.model_dump(mode='json'))
        cached = list(
            self.db.scalars(
                select(ItineraryPlanningArtifact).where(
                    ItineraryPlanningArtifact.kind == 'FLIGHT_CANDIDATE',
                    ItineraryPlanningArtifact.trip_id == connection.trip_id,
                    ItineraryPlanningArtifact.connection_id
                    == getattr(connection, 'artifact_connection_id', connection.id),
                    ItineraryPlanningArtifact.created_by_user_id == actor,
                    ItineraryPlanningArtifact.input_hash == binding,
                    ItineraryPlanningArtifact.expires_at > utcnow(),
                )
            )
        )
        if cached:
            return FlightLookupResponse(
                status='MATCHES',
                expires_at=min(r.expires_at for r in cached),
                candidates=[
                    FlightCandidate(
                        candidate_id=r.id,
                        lookup=resolve_flight_lookup_airports(
                            self.db, FlightLookup.model_validate(r.payload)
                        ),
                        duration_seconds=FlightLookup.model_validate(
                            r.payload
                        ).duration_seconds,
                    )
                    for r in cached
                ],
            )
        return None
