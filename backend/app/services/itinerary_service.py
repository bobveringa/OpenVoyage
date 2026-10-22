from __future__ import annotations

import uuid
from dataclasses import dataclass
from types import SimpleNamespace

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload, selectinload

from models.api.itinerary import (
    ItineraryPlacement,
    ItineraryStopCreateRequest,
    ItineraryStopUpdateRequest,
    ItineraryTravelReplaceRequest,
)
from models.api.planning import ConnectionIntent
from models.database.itinerary import (
    ItineraryPlanningArtifact,
    ItineraryStop,
    ItineraryTravelLeg,
    ItineraryTravelSegment,
)
from fastapi import HTTPException
from models.database.trips import Trip, TripMember
from models.database.user import User
from services.connection_endpoints import (
    endpoint_location,
    endpoint_label,
    location_identity,
)
from services.itinerary_routes import ItineraryRouteService
from services.location_service import LocationService
from services.trip_access import TripReadAccess, get_membership, get_trip_read_access
from services.trip_authorization import TripPermission, role_has_permission
from services.trip_errors import TripNotFoundError

StopPair = tuple[uuid.UUID | None, uuid.UUID | None]


class ItineraryPermissionError(Exception):
    """Raised when a trip member lacks itinerary privileges."""


class ItineraryRevisionMismatchError(Exception):
    """Raised when If-Match does not match the stored itinerary revision."""


class ItineraryStopNotFoundError(Exception):
    """Raised when an itinerary stop is missing or hidden."""


class ItineraryTravelLegNotFoundError(Exception):
    """Raised when an itinerary travel leg is missing or hidden."""


class ItineraryPlacementError(Exception):
    """Raised when a stop placement request is invalid."""


class ItineraryTravelValidationError(Exception):
    """Raised when travel replacement payloads do not match resulting legs."""


@dataclass(frozen=True)
class ItinerarySnapshot:
    trip_id: uuid.UUID
    itinerary_revision: int
    stops: list[ItineraryStop]
    legs: list[ItineraryTravelLeg]


@dataclass(frozen=True)
class ItineraryStopDetail:
    stop: ItineraryStop
    incoming_leg: ItineraryTravelLeg | None
    outgoing_leg: ItineraryTravelLeg | None
    itinerary_revision: int


@dataclass(frozen=True)
class ItineraryTravelLegDetail:
    leg: ItineraryTravelLeg
    itinerary_revision: int


class ItineraryService:
    """Coordinates planned itinerary stops, travel legs, and revision checks."""

    def __init__(
        self,
        db: Session,
        location_service: LocationService,
        route_service: ItineraryRouteService,
    ) -> None:
        self.db = db
        self.location_service = location_service
        self.route_service = route_service
        self.confirm_travel_deletion = False
        self._editing_user_id = None

    def get_itinerary(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItinerarySnapshot:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        return self._load_itinerary_snapshot(trip=trip)

    def get_route_overview(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItinerarySnapshot:
        access = self._get_trip_read_access_or_raise(
            trip_id, current_user_id, share_token
        )
        return self._load_itinerary_snapshot(trip=access.trip)

    def create_stop(
        self,
        trip_id: uuid.UUID,
        payload: ItineraryStopCreateRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        trip, membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        self._editing_user_id = current_user_id
        old_stops = self._load_ordered_stops(trip_id=trip_id)
        location = self.location_service.create_location_for_trip(
            trip_id=trip_id,
            created_by=current_user_id,
            location_input=payload.location,
        )
        stop = ItineraryStop(
            trip_id=trip_id,
            location_id=location.id,
            planned_start_date=payload.placement.planned_start_date,
            same_day_position=0,
            title=payload.title,
            notes=payload.notes,
            planned_nights=payload.planned_nights,
            created_by=membership.user_id,
        )
        self.db.add(stop)
        self.db.flush()

        new_order = self._ordered_with_inserted_stop(
            stops=old_stops + [stop],
            moving_stop=stop,
            placement=payload.placement,
        )
        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=new_order,
            stop_id=stop.id,
        )
        self._validate_travel_payload_sides(
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
            incoming_travel=payload.incoming_travel,
            outgoing_travel=payload.outgoing_travel,
        )

        self._apply_order(new_order)
        legs_by_pair = self._rebalance_legs(
            trip_id=trip_id,
            new_pairs=self._adjacent_pairs(new_order),
            new_order=new_order,
        )
        self._apply_side_replacements(
            legs_by_pair=legs_by_pair,
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
            incoming_travel=payload.incoming_travel,
            outgoing_travel=payload.outgoing_travel,
        )
        self._sync_side_routes(
            legs_by_pair=legs_by_pair,
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
        )
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def get_stop_detail(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItineraryStopDetail:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        stops = self._load_ordered_stops(trip_id=trip_id)
        stop = next((item for item in stops if item.id == stop_id), None)
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')

        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=stops,
            stop_id=stop_id,
        )
        legs_by_pair = self._load_legs_by_pair(trip_id=trip_id)
        return ItineraryStopDetail(
            stop=stop,
            incoming_leg=legs_by_pair.get(incoming_pair or (None, stop_id)),
            outgoing_leg=legs_by_pair.get(outgoing_pair or (stop_id, None)),
            itinerary_revision=trip.itinerary_revision,
        )

    def update_stop(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        payload: ItineraryStopUpdateRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        self._editing_user_id = current_user_id
        old_stops = self._load_ordered_stops(trip_id=trip_id)
        stop = next((item for item in old_stops if item.id == stop_id), None)
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')

        has_location_replacement = 'location' in payload.model_fields_set
        has_placement = 'placement' in payload.model_fields_set
        has_travel_replacement = (
            payload.incoming_travel is not None or payload.outgoing_travel is not None
        )

        if has_placement and payload.placement.after_stop_id == stop_id:
            raise ItineraryPlacementError(
                'after_stop_id cannot reference the same stop'
            )

        original_date = stop.planned_start_date
        original_order_ids = [item.id for item in old_stops]
        new_order = old_stops
        placement_changed = False
        if has_placement:
            new_order = self._ordered_with_inserted_stop(
                stops=old_stops,
                moving_stop=stop,
                placement=payload.placement,
            )
            placement_changed = (
                payload.placement.planned_start_date != original_date
                or [item.id for item in new_order] != original_order_ids
            )

        if has_travel_replacement and not (
            placement_changed or has_location_replacement
        ):
            raise ItineraryTravelValidationError(
                'Travel replacements require a location replacement or changed placement'
            )

        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=new_order,
            stop_id=stop_id,
        )
        if placement_changed or has_location_replacement:
            self._validate_travel_payload_sides(
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
                incoming_travel=payload.incoming_travel,
                outgoing_travel=payload.outgoing_travel,
            )

        metadata_changed = self._apply_stop_metadata_updates(stop=stop, payload=payload)
        if has_location_replacement:
            location = self.location_service.create_location_for_trip(
                trip_id=trip_id,
                created_by=current_user_id,
                location_input=payload.location,
            )
            stop.location_id = location.id
            self.db.flush()
            self.db.expire(stop, ['location'])

        changed = metadata_changed or placement_changed or has_location_replacement
        if not changed:
            return self._load_itinerary_snapshot(trip=trip)

        legs_by_pair = self._load_legs_by_pair(trip_id=trip_id)
        if placement_changed or has_location_replacement:
            self._apply_order(new_order)
            legs_by_pair = self._rebalance_legs(
                trip_id=trip_id,
                new_pairs=self._adjacent_pairs(new_order),
                new_order=new_order,
                reset_stop_ids={stop_id} if has_location_replacement else set(),
            )

        if placement_changed or has_location_replacement:
            self._apply_side_replacements(
                legs_by_pair=legs_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
                incoming_travel=payload.incoming_travel,
                outgoing_travel=payload.outgoing_travel,
            )
            self._sync_side_routes(
                legs_by_pair=legs_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
            )

        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def delete_stop(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        self._editing_user_id = current_user_id
        old_stops = self._load_ordered_stops(trip_id=trip_id)
        stop = next((item for item in old_stops if item.id == stop_id), None)
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')

        new_order = [item for item in old_stops if item.id != stop_id]
        self._apply_order(new_order)
        legs_by_pair = self._rebalance_legs(
            trip_id=trip_id,
            new_pairs=self._adjacent_pairs(new_order),
            new_order=new_order,
        )
        self._sync_bridge_route_after_stop_delete(
            old_ordered_stops=old_stops,
            deleted_stop_id=stop_id,
            legs_by_pair=legs_by_pair,
        )
        self.db.delete(stop)
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def get_travel_leg(
        self,
        trip_id: uuid.UUID,
        leg_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItineraryTravelLegDetail:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        leg = self._get_leg_or_raise(trip_id=trip_id, leg_id=leg_id)
        return ItineraryTravelLegDetail(
            leg=leg,
            itinerary_revision=trip.itinerary_revision,
        )

    def replace_travel_leg(
        self,
        trip_id: uuid.UUID,
        leg_id: uuid.UUID,
        payload: ItineraryTravelReplaceRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItineraryTravelLegDetail:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        leg = self._get_leg_or_raise(trip_id=trip_id, leg_id=leg_id)
        draft = self._connection_draft(leg, payload, current_user_id)
        endpoints_changed = any(
            endpoint_location(leg, side).id != endpoint_location(draft, side).id
            for side in ('from', 'to')
        )
        if not endpoints_changed and self._travel_payload_matches_leg(
            payload=payload, leg=leg
        ):
            return ItineraryTravelLegDetail(
                leg=leg, itinerary_revision=trip.itinerary_revision
            )
        self._editing_user_id = current_user_id
        if endpoints_changed:
            for side in ('from', 'to'):
                if getattr(draft, f'{side}_stop_id') is None:
                    endpoint = getattr(payload, 'from_' if side == 'from' else 'to')
                    location = self.location_service.create_location_for_trip(
                        trip_id,
                        current_user_id,
                        endpoint.location,
                    )
                    setattr(leg, f'{side}_location_id', location.id)
                    self.db.expire(leg, [f'{side}_location'])
            for segment in leg.segments:
                if segment.flight:
                    segment.flight.lookup = None
                    segment.flight.lookup_owner_user_id = None
        self._replace_travel(leg=leg, payload=payload)
        if endpoints_changed:
            self._clear_artifacts(leg)
        self.route_service.invalidate(leg)
        self._increment_revision(trip)
        self.db.commit()
        return ItineraryTravelLegDetail(
            leg=self._get_leg_or_raise(trip_id=trip_id, leg_id=leg_id),
            itinerary_revision=trip.itinerary_revision,
        )

    def _connection_draft(self, leg, payload, actor, *, creating=False):
        stops = self._load_ordered_stops(leg.trip_id)
        stop_map = {stop.id: stop for stop in stops}
        pair = tuple(
            endpoint.stop_id if endpoint.type == 'STOP' else None
            for endpoint in (payload.from_, payload.to)
        )
        for stop_id in pair:
            if stop_id is not None and stop_id not in stop_map:
                raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')
        allowed = self._adjacent_pairs(stops)
        if stops:
            allowed += [(None, stops[0].id), (stops[-1].id, None)]
        if (
            pair not in allowed
            or (creating and None not in pair)
            or (not creating and pair != (leg.from_stop_id, leg.to_stop_id))
        ):
            raise HTTPException(
                409,
                {
                    'code': 'CONNECTION_TOPOLOGY_CONFLICT',
                    'message': 'Connection endpoints must preserve itinerary topology',
                },
            )
        values = {
            key: getattr(leg, key)
            for key in (
                'id',
                'trip_id',
                'notes',
                'segments',
                'created_at',
                'updated_at',
            )
        }
        for side, endpoint, stop_id in zip(
            ('from', 'to'), (payload.from_, payload.to), pair
        ):
            values[f'{side}_stop_id'] = stop_id
            values[f'{side}_stop'] = stop_map.get(stop_id)
            values[f'{side}_location'] = None
            if endpoint.type == 'LOCATION':
                resolved = self.location_service._resolve_location_input(
                    endpoint.location
                )
                current = getattr(leg, f'{side}_location', None)
                if current and location_identity(current) == location_identity(
                    resolved
                ):
                    location = current
                else:
                    location = SimpleNamespace(
                        **vars(resolved),
                        id=uuid.uuid4(),
                        source_place_id=getattr(endpoint.location, 'place_id', None),
                    )
                values[f'{side}_location'] = location
        return SimpleNamespace(**values)

    def create_travel_leg(self, trip_id, payload, current_user_id, expected_revision):
        trip, _ = self._require_manage_trip_locked(
            trip_id, current_user_id, expected_revision
        )
        draft = self._new_connection_draft(trip_id, payload, current_user_id)
        # Validate draft artifacts against the actor, trip, inputs and revision
        # before assigning them to the newly persisted connection.
        artifacts = []
        for segment in payload.segments or []:
            if segment.flight and segment.flight.candidate_id:
                artifacts.append(
                    self.route_service.artifact(
                        segment.flight.candidate_id,
                        'FLIGHT_CANDIDATE',
                        draft,
                        current_user_id,
                    )
                )
        self.route_service.build(draft, payload, current_user_id)
        if payload.preview_id:
            artifacts.append(
                self.route_service.artifact(
                    payload.preview_id,
                    'PREVIEW',
                    draft,
                    current_user_id,
                    expected_revision,
                    self.route_service.binding(draft, payload),
                )
            )
        leg = ItineraryTravelLeg(
            id=uuid.uuid4(), trip_id=trip_id, notes='', segments=[]
        )
        pair = (draft.from_stop_id, draft.to_stop_id)
        leg.from_stop_id, leg.to_stop_id = pair
        for side, endpoint in (('from', payload.from_), ('to', payload.to)):
            if endpoint.type == 'LOCATION':
                location = self.location_service.create_location_for_trip(
                    trip_id,
                    current_user_id,
                    endpoint.location,
                )
                setattr(leg, f'{side}_location_id', location.id)
        self.db.add(leg)
        self.db.flush()
        for artifact in artifacts:
            artifact.leg_id = leg.id
        self._editing_user_id = current_user_id
        self._replace_travel(leg=leg, payload=payload)
        self._increment_revision(trip)
        self.db.commit()
        return ItineraryTravelLegDetail(
            self._get_leg_or_raise(trip_id, leg.id), trip.itinerary_revision
        )

    def _new_connection_draft(self, trip_id, payload, actor):
        from models.database.base import utcnow

        leg = SimpleNamespace(
            id=uuid.UUID(int=0),
            trip_id=trip_id,
            notes='',
            segments=[],
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        draft = self._connection_draft(leg, payload, actor, creating=True)
        if (draft.from_stop_id, draft.to_stop_id) in self._load_legs_by_pair(trip_id):
            raise HTTPException(409, {'code': 'CONNECTION_ALREADY_EXISTS'})
        draft.artifact_leg_id = None
        return draft

    def _planning_connection(self, trip_id, leg_id, payload, actor):
        if leg_id is None:
            return self._new_connection_draft(trip_id, payload, actor)
        return self._connection_draft(
            self._get_leg_or_raise(trip_id, leg_id), payload, actor
        )

    def delete_travel_leg(self, trip_id, leg_id, current_user_id, expected_revision):
        trip, _ = self._require_manage_trip_locked(
            trip_id, current_user_id, expected_revision
        )
        leg = self._get_leg_or_raise(trip_id, leg_id)
        if leg.from_stop_id is not None and leg.to_stop_id is not None:
            raise HTTPException(
                409,
                {
                    'code': 'CONNECTION_TOPOLOGY_CONFLICT',
                    'message': 'Between-stop connections are managed by the itinerary',
                },
            )
        self._confirm_discard([leg])
        self.db.delete(leg)
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id)

    def _get_readable_trip_or_raise(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> Trip:
        access = self._get_trip_read_access_or_raise(
            trip_id, current_user_id, share_token
        )
        if access.membership is None or not role_has_permission(
            access.membership.role, TripPermission.GET_ITINERARY
        ):
            raise ItineraryPermissionError('Only trip participants can read planning details')
        return access.trip

    def _get_trip_read_access_or_raise(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> TripReadAccess:
        access = get_trip_read_access(
            self.db,
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        if access is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return access

    def preview_travel(
        self, trip_id, leg_id, payload, actor, revision, retry_failed=False
    ):
        from models.api.itinerary import ItineraryTravelLegResponse, PreviewResponse
        from services.planning_service import calculation_gate

        self._require_manage_trip_locked(trip_id, actor, revision)
        leg = self._planning_connection(trip_id, leg_id, payload, actor)
        segments = self.route_service.build(leg, payload, actor)
        binding = self.route_service.binding(leg, payload)
        # Do not spend credits again for the same completed, unexpired preview.
        from models.database.itinerary import ItineraryPlanningArtifact
        from models.database.base import utcnow

        cached = self.db.scalar(
            select(ItineraryPlanningArtifact)
            .where(
                ItineraryPlanningArtifact.kind == 'PREVIEW',
                ItineraryPlanningArtifact.trip_id == trip_id,
                ItineraryPlanningArtifact.leg_id == leg_id,
                ItineraryPlanningArtifact.created_by_user_id == actor,
                ItineraryPlanningArtifact.itinerary_revision == revision,
                ItineraryPlanningArtifact.input_hash == binding,
                ItineraryPlanningArtifact.expires_at > utcnow(),
            )
            .order_by(ItineraryPlanningArtifact.created_at.desc())
        )
        if cached and not retry_failed:
            for seg, previous in zip(segments, cached.payload['routes'], strict=True):
                if previous and previous['input_hash'] == seg.input_hash:
                    seg.result = previous
            prepared = self.route_service.prepare_connection(leg, payload, segments)
            connection = ItineraryTravelLegResponse.from_model(
                leg,
                route=self.route_service.connection(
                    leg, prepared.segments, warnings=prepared.warnings
                ),
            )
            connection.notes = payload.notes
            return PreviewResponse(
                preview_id=cached.id,
                expires_at=cached.expires_at,
                connection=connection,
            )
        if cached:
            for seg, previous in zip(segments, cached.payload['routes'], strict=True):
                if previous and previous['input_hash'] == seg.input_hash:
                    seg.result = previous
        self.db.rollback()
        calculation_gate.enter(actor, trip_id, binding)
        try:
            self.route_service.calculate(
                segments, retry_failed, include_alternatives=True
            )
        finally:
            calculation_gate.leave(actor, trip_id)
        self._require_manage_trip_locked(trip_id, actor, revision)
        leg = self._planning_connection(trip_id, leg_id, payload, actor)
        current_segments = self.route_service.build(leg, payload, actor)
        if self.route_service.binding(leg, payload) != binding or [
            segment.input_hash for segment in current_segments
        ] != [segment.input_hash for segment in segments]:
            raise ItineraryRevisionMismatchError('Connection endpoint inputs changed')
        prepared = self.route_service.prepare_connection(leg, payload, segments)
        result = self.route_service.connection(
            leg, prepared.segments, warnings=prepared.warnings
        )
        if any(
            s.intent.travel_mode in ('CAR', 'BIKE', 'WALK')
            and s.start
            and s.end
            and s.result is None
            for s in segments
        ):
            result['warnings'].append(
                'Calculation incomplete. Retry the remaining routes when ready.'
            )
        connection = ItineraryTravelLegResponse.from_model(leg, route=result)
        connection.notes = payload.notes
        artifact = self.route_service.new_artifact(
            'PREVIEW',
            leg_id,
            trip_id,
            actor,
            {
                'routes': [s.result for s in segments],
                'connection': connection.model_dump(mode='json', by_alias=True),
                'resolved_input_hash': prepared.binding,
            },
            binding,
            revision,
        )
        self.db.commit()
        return PreviewResponse(
            preview_id=artifact.id,
            expires_at=artifact.expires_at,
            connection=connection,
        )

    def calculate_saved_routes(
        self, trip_id, leg_id, current_user_id, expected_revision
    ):
        from models.database.itinerary import ItinerarySegmentRoute
        from services.planning_service import calculation_gate, route_values

        self._require_manage_trip_locked(trip_id, current_user_id, expected_revision)
        leg = self._get_leg_or_raise(trip_id, leg_id)
        segments = self.route_service.build(leg)
        self.db.rollback()
        calculation_gate.enter(current_user_id, trip_id, leg_id)
        try:
            self.route_service.calculate(segments, retry_failed=True, force=True)
        finally:
            calculation_gate.leave(current_user_id, trip_id)
        trip, _ = self._require_manage_trip_locked(
            trip_id, current_user_id, expected_revision
        )
        leg = self._get_leg_or_raise(trip_id, leg_id)
        current = {s.id: s for s in self.route_service.build(leg)}
        for calculated in segments:
            if current[calculated.id].input_hash != calculated.input_hash:
                raise ItineraryRevisionMismatchError('Route inputs changed')
        prepared = self.route_service.prepare_connection(leg, None, segments)
        changed = False
        for calculated in prepared.segments:
            row = next(s for s in leg.segments if s.id == calculated.id)
            if row.travel_mode != calculated.intent.travel_mode:
                row.travel_mode = calculated.intent.travel_mode
                row.input_version = calculated.version
                row.route = None
                changed = True
                continue
            if (
                calculated.result is not None
                and calculated.result != current[calculated.id].result
            ):
                row.route = None
                self.db.flush()
                row.route = ItinerarySegmentRoute(
                    segment_id=row.id,
                    trip_id=trip_id,
                    input_version=row.input_version,
                    **route_values(calculated.result),
                )
                changed = True
        if changed:
            self._increment_revision(trip)
        self.db.commit()
        return ItineraryTravelLegDetail(leg, trip.itinerary_revision)

    def lookup_flights(self, trip_id, leg_id, payload, actor, revision):
        from models.api.planning import FlightCandidate, FlightLookupResponse
        from services.flight_providers import FlightUnavailable
        from services.planning_service import calculation_gate, fingerprint

        self._require_manage_trip_locked(trip_id, actor, revision)
        leg = (
            self._get_leg_or_raise(trip_id, leg_id)
            if leg_id is not None
            else SimpleNamespace(id=None, trip_id=trip_id)
        )
        cached = self.route_service.flight_lookup(leg, actor, payload)
        if cached:
            return cached
        self.db.rollback()
        calculation_gate.enter(
            actor, trip_id, fingerprint(payload.model_dump(mode='json'))
        )
        try:
            matches = self.route_service.flights.lookup(payload)
        except FlightUnavailable as exc:
            return FlightLookupResponse(
                status='UNAVAILABLE',
                reason=exc.reason,
                retry_after_seconds=exc.retry_after_seconds,
            )
        finally:
            calculation_gate.leave(actor, trip_id)
        # Candidates survive unrelated revisions, but never removal of access/leg.
        self._require_manage_trip_locked_without_revision(trip_id, actor)
        if leg_id is not None:
            self._get_leg_or_raise(trip_id, leg_id)
        if not matches:
            return FlightLookupResponse(status='NOT_FOUND')
        candidates, expiry = [], None
        for lookup in matches:
            artifact = self.route_service.new_artifact(
                'FLIGHT_CANDIDATE',
                leg_id,
                trip_id,
                actor,
                lookup.model_dump(mode='json'),
                fingerprint(payload.model_dump(mode='json')),
            )
            expiry = artifact.expires_at
            candidates.append(
                FlightCandidate(
                    candidate_id=artifact.id,
                    lookup=lookup,
                    duration_seconds=lookup.duration_seconds,
                )
            )
        self.db.commit()
        return FlightLookupResponse(
            status='MATCHES', candidates=candidates, expires_at=expiry
        )

    def _require_manage_trip_locked(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        expected_revision: int,
    ) -> tuple[Trip, TripMember]:
        trip, membership = self._require_manage_trip_locked_without_revision(
            trip_id=trip_id,
            user_id=user_id,
        )
        if trip.itinerary_revision != expected_revision:
            raise ItineraryRevisionMismatchError('Itinerary revision does not match')
        return trip, membership

    def _require_manage_trip_locked_without_revision(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> tuple[Trip, TripMember]:
        trip = self.db.execute(
            select(Trip).where(Trip.id == trip_id).with_for_update()
        ).scalar_one_or_none()
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        membership = self._get_membership(trip_id=trip_id, user_id=user_id)
        if membership is None:
            if (
                get_trip_read_access(
                    self.db,
                    trip_id=trip_id,
                    current_user_id=user_id,
                )
                is not None
            ):
                raise ItineraryPermissionError(
                    'The user does not have enough privileges'
                )
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if not role_has_permission(membership.role, TripPermission.MANAGE_ITINERARY):
            raise ItineraryPermissionError('The user does not have enough privileges')
        return trip, membership

    def _get_membership(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember | None:
        return get_membership(self.db, trip_id=trip_id, user_id=user_id)

    def _load_itinerary_snapshot_by_id(self, trip_id: uuid.UUID) -> ItinerarySnapshot:
        trip = self.db.get(Trip, trip_id)
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return self._load_itinerary_snapshot(trip=trip)

    def _load_itinerary_snapshot(self, trip: Trip) -> ItinerarySnapshot:
        stops = self._load_ordered_stops(trip_id=trip.id)
        legs_by_pair = self._load_legs_by_pair(trip_id=trip.id)
        ordered_legs = [
            legs_by_pair[pair]
            for pair in (
                [(None, stops[0].id)]
                + self._adjacent_pairs(stops)
                + [(stops[-1].id, None)]
                if stops
                else []
            )
            if pair in legs_by_pair
        ]
        return ItinerarySnapshot(
            trip_id=trip.id,
            itinerary_revision=trip.itinerary_revision,
            stops=stops,
            legs=ordered_legs,
        )

    def _load_ordered_stops(self, trip_id: uuid.UUID) -> list[ItineraryStop]:
        return list(
            self.db.execute(
                select(ItineraryStop)
                .options(
                    joinedload(ItineraryStop.location),
                    joinedload(ItineraryStop.creator).joinedload(User.profile),
                )
                .where(ItineraryStop.trip_id == trip_id)
                .order_by(
                    ItineraryStop.planned_start_date.asc(),
                    ItineraryStop.same_day_position.asc(),
                    ItineraryStop.id.asc(),
                )
            )
            .scalars()
            .all()
        )

    def _load_legs_by_pair(
        self,
        trip_id: uuid.UUID,
    ) -> dict[StopPair, ItineraryTravelLeg]:
        legs = list(
            self.db.execute(
                select(ItineraryTravelLeg)
                .options(
                    selectinload(ItineraryTravelLeg.segments).joinedload(
                        ItineraryTravelSegment.route
                    ),
                    selectinload(ItineraryTravelLeg.segments).joinedload(
                        ItineraryTravelSegment.flight
                    ),
                )
                .where(ItineraryTravelLeg.trip_id == trip_id)
            )
            .scalars()
            .all()
        )
        return {(leg.from_stop_id, leg.to_stop_id): leg for leg in legs}

    def _get_leg_or_raise(
        self,
        trip_id: uuid.UUID,
        leg_id: uuid.UUID,
    ) -> ItineraryTravelLeg:
        leg = self.db.execute(
            select(ItineraryTravelLeg).where(
                ItineraryTravelLeg.trip_id == trip_id,
                ItineraryTravelLeg.id == leg_id,
            )
        ).scalar_one_or_none()
        if leg is None:
            raise ItineraryTravelLegNotFoundError(
                f'Itinerary travel leg not found: {leg_id}'
            )
        return leg

    def _ordered_with_inserted_stop(
        self,
        *,
        stops: list[ItineraryStop],
        moving_stop: ItineraryStop,
        placement: ItineraryPlacement,
    ) -> list[ItineraryStop]:
        source = [stop for stop in stops if stop.id != moving_stop.id]
        anchor = None
        if placement.after_stop_id is not None:
            anchor = next(
                (stop for stop in source if stop.id == placement.after_stop_id),
                None,
            )
            if anchor is None:
                raise ItineraryStopNotFoundError(
                    f'Itinerary stop not found: {placement.after_stop_id}'
                )
            if anchor.planned_start_date != placement.planned_start_date:
                raise ItineraryPlacementError(
                    'after_stop_id must be on the same planned_start_date'
                )

        before_date = [
            stop
            for stop in source
            if stop.planned_start_date < placement.planned_start_date
        ]
        same_date = [
            stop
            for stop in source
            if stop.planned_start_date == placement.planned_start_date
        ]
        after_date = [
            stop
            for stop in source
            if stop.planned_start_date > placement.planned_start_date
        ]

        insert_index = 0
        if anchor is not None:
            insert_index = same_date.index(anchor) + 1
        moving_stop.planned_start_date = placement.planned_start_date
        same_date.insert(insert_index, moving_stop)
        return before_date + same_date + after_date

    def _apply_order(self, ordered_stops: list[ItineraryStop]) -> None:
        current_date = None
        same_day_position = 0
        for stop in ordered_stops:
            if stop.planned_start_date != current_date:
                current_date = stop.planned_start_date
                same_day_position = 0
            stop.same_day_position = same_day_position
            same_day_position += 1
        self.db.flush()

    @staticmethod
    def _customized(leg):
        return bool(
            leg.notes
            or len(leg.segments) > 1
            or any(
                seg.mode_source == 'USER'
                or seg.notes
                or (
                    seg.flight
                    and any(
                        getattr(seg.flight, field)
                        for field in (
                            'flight_number',
                            'departure_date',
                            'departure_airport_place_id',
                            'arrival_airport_place_id',
                            'airline_name',
                            'lookup',
                        )
                    )
                )
                or seg.service_company
                or seg.service_number
                or seg.from_location_id
                or seg.to_location_id
                or seg.via_location_id
                for seg in leg.segments
            )
        )

    def _confirm_discard(self, legs):
        affected = [leg for leg in legs if self._customized(leg)]
        if affected and not self.confirm_travel_deletion:
            detail = {
                'code': 'TRAVEL_DELETION_REQUIRED',
                'connections': [
                    {
                        'id': str(leg.id),
                        'from': endpoint_label(leg, 'from'),
                        'to': endpoint_label(leg, 'to'),
                    }
                    for leg in affected
                ],
            }
            self.db.rollback()
            raise HTTPException(409, detail)

    def _clear_artifacts(self, leg):
        self.db.execute(
            delete(ItineraryPlanningArtifact).where(
                ItineraryPlanningArtifact.trip_id == leg.trip_id,
                ItineraryPlanningArtifact.leg_id == leg.id,
            )
        )

    def _rebalance_legs(self, *, trip_id, new_pairs, new_order, reset_stop_ids=None):
        reset_stop_ids = reset_stop_ids or set()
        existing = self._load_legs_by_pair(trip_id)
        desired = set(new_pairs)
        removals, resets, reanchors = [], [], []
        for pair, leg in existing.items():
            if leg.from_stop_id is None or leg.to_stop_id is None:
                if not new_order:
                    removals.append(leg)
                    continue
                target = (
                    (None, new_order[0].id)
                    if leg.from_stop_id is None
                    else (new_order[-1].id, None)
                )
                if pair != target:
                    reanchors.append((leg, target))
                    resets.append(leg)
            elif pair not in desired:
                removals.append(leg)
        self._confirm_discard(removals + resets)
        for leg in removals:
            self.db.delete(leg)
        # Release old stop uniqueness before reanchoring, and reanchor before stop deletion.
        self.db.flush()
        for leg, pair in reanchors:
            leg.from_stop_id, leg.to_stop_id = pair
            self.db.expire(leg, ['from_stop', 'to_stop'])
        self.db.flush()
        for leg in resets:
            self._reset_travel(leg)
        for leg in existing.values():
            if (
                leg not in removals
                and leg not in resets
                and reset_stop_ids.intersection((leg.from_stop_id, leg.to_stop_id))
            ):
                self.route_service.invalidate(leg)
                self._clear_artifacts(leg)
        kept = {
            (leg.from_stop_id, leg.to_stop_id): leg
            for leg in existing.values()
            if leg not in removals
        }
        for pair in new_pairs:
            if pair not in kept:
                leg = ItineraryTravelLeg(
                    trip_id=trip_id, from_stop_id=pair[0], to_stop_id=pair[1], notes=''
                )
                self.db.add(leg)
                self.db.flush()
                self._reset_travel(leg)
                kept[pair] = leg
        self.db.flush()
        return kept

    def _apply_stop_metadata_updates(
        self,
        *,
        stop: ItineraryStop,
        payload: ItineraryStopUpdateRequest,
    ) -> bool:
        changed = False
        if 'title' in payload.model_fields_set and payload.title != stop.title:
            stop.title = payload.title
            changed = True
        if 'notes' in payload.model_fields_set and payload.notes != stop.notes:
            stop.notes = payload.notes
            changed = True
        if (
            'planned_nights' in payload.model_fields_set
            and payload.planned_nights != stop.planned_nights
        ):
            stop.planned_nights = payload.planned_nights
            changed = True
        return changed

    def _neighbor_pairs_for_stop(
        self,
        *,
        ordered_stops: list[ItineraryStop],
        stop_id: uuid.UUID,
    ) -> tuple[StopPair | None, StopPair | None]:
        for index, stop in enumerate(ordered_stops):
            if stop.id != stop_id:
                continue
            incoming_pair = (
                (ordered_stops[index - 1].id, stop.id) if index > 0 else None
            )
            outgoing_pair = (
                (stop.id, ordered_stops[index + 1].id)
                if index < len(ordered_stops) - 1
                else None
            )
            return incoming_pair, outgoing_pair
        raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')

    def _validate_travel_payload_sides(
        self,
        *,
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
        incoming_travel: ConnectionIntent | None,
        outgoing_travel: ConnectionIntent | None,
    ) -> None:
        if incoming_travel is not None and incoming_pair is None:
            raise ItineraryTravelValidationError(
                'incoming_travel requires a resulting incoming leg'
            )
        if outgoing_travel is not None and outgoing_pair is None:
            raise ItineraryTravelValidationError(
                'outgoing_travel requires a resulting outgoing leg'
            )

    def _apply_side_replacements(
        self,
        *,
        legs_by_pair: dict[StopPair, ItineraryTravelLeg],
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
        incoming_travel: ConnectionIntent | None,
        outgoing_travel: ConnectionIntent | None,
    ) -> None:
        if incoming_pair is not None and incoming_travel is not None:
            self._replace_travel(
                leg=legs_by_pair[incoming_pair], payload=incoming_travel
            )
        if outgoing_pair is not None and outgoing_travel is not None:
            self._replace_travel(
                leg=legs_by_pair[outgoing_pair], payload=outgoing_travel
            )

    def _sync_side_routes(
        self,
        *,
        legs_by_pair: dict[StopPair, ItineraryTravelLeg],
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
    ) -> None:
        synced_leg_ids: set[uuid.UUID] = set()
        for pair in (incoming_pair, outgoing_pair):
            if pair is None:
                continue
            leg = legs_by_pair[pair]
            if leg.id in synced_leg_ids:
                continue
            self.route_service.invalidate(leg)
            synced_leg_ids.add(leg.id)

    def _sync_bridge_route_after_stop_delete(
        self,
        *,
        old_ordered_stops: list[ItineraryStop],
        deleted_stop_id: uuid.UUID,
        legs_by_pair: dict[StopPair, ItineraryTravelLeg],
    ) -> None:
        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=old_ordered_stops,
            stop_id=deleted_stop_id,
        )
        if incoming_pair is None or outgoing_pair is None:
            return

        bridge_pair = (incoming_pair[0], outgoing_pair[1])
        bridge_leg = legs_by_pair.get(bridge_pair)
        if bridge_leg is not None:
            self.route_service.invalidate(bridge_leg)

    def _reset_travel(self, leg: ItineraryTravelLeg) -> None:
        self._clear_artifacts(leg)
        leg.notes = ''
        leg.segments = [
            ItineraryTravelSegment(
                trip_id=leg.trip_id,
                position=0,
                mode_source='AUTO',
                travel_mode=self.route_service.infer_mode(
                    endpoint_location(leg, 'from'),
                    endpoint_location(leg, 'to'),
                    leg.trip_id,
                ),
            )
        ]
        self.db.flush()

    def _replace_travel(self, *, leg, payload) -> None:
        trip = self.db.get(Trip, leg.trip_id)
        self.route_service.persist(
            leg, payload, self._editing_user_id, trip.itinerary_revision
        )

    def _travel_payload_matches_leg(self, *, payload, leg) -> bool:
        if payload.preview_id or any(s.mode_selected for s in (payload.segments or [])):
            return False
        if payload.segments is None:
            return (
                not self._customized(leg)
                and not payload.notes
                and len(leg.segments) == 1
                and leg.segments[0].travel_mode
                == self.route_service.infer_mode(
                    endpoint_location(leg, 'from'),
                    endpoint_location(leg, 'to'),
                    leg.trip_id,
                )
            )
        return payload.model_dump(
            mode='json', by_alias=True, exclude={'preview_id', 'from_', 'to'}
        ) == self.route_service.saved_intent(leg).model_dump(
            mode='json', by_alias=True, exclude={'preview_id'}
        )

    def _increment_revision(self, trip: Trip) -> None:
        trip.itinerary_revision += 1

    def _adjacent_pairs(self, stops: list[ItineraryStop]) -> list[StopPair]:
        return [
            (previous.id, current.id)
            for previous, current in zip(stops, stops[1:], strict=False)
        ]
