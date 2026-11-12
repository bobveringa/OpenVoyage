from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload, selectinload

from models.api.itinerary import (
    StayCreateRequest,
    StayUpdateRequest,
    ItineraryPlacement,
    ItineraryStopCreateRequest,
    ItineraryStopUpdateRequest,
    ItineraryConnectionReplaceRequest,
)
from models.api.planning import ConnectionIntent, PlanningWarning
from models.database.itinerary import (
    STAY_TYPES_WITHOUT_BOOKING,
    ItineraryPlanningArtifact,
    ItineraryStay,
    ItineraryStop,
    ItineraryConnection,
    ItineraryTravelSegment,
)
from fastapi import HTTPException
from models.database.base import utcnow
from models.database.locations import Location
from models.database.trips import Trip, TripMember
from models.database.user import User
from services.planning_models import ArtifactScope, ConnectionDraft, DraftLocation
from services.connection_endpoints import (
    endpoint_location,
    endpoint_label,
    location_identity,
)
from services.flight_airports import resolve_flight_lookup_airports
from services.gps.geometry import haversine_meters
from services.itinerary_routes import ItineraryRouteService
from services.location_service import LocationService
from services.trip_access import (
    TripReadAccess,
    get_membership,
    get_trip_read_access,
    lock_trip,
)
from services.trip_authorization import TripPermission, role_has_permission
from services.trip_errors import TripNotFoundError

StopPair = tuple[uuid.UUID | None, uuid.UUID | None]

# Optional stay fields copied as sent; null clears them.
_STAY_DETAIL_FIELDS = (
    'address',
    'check_in_time',
    'check_out_time',
    'booking_reference',
    'booking_url',
    'contact_phone',
    'contact_email',
)


class ItineraryPermissionError(Exception):
    """Raised when a trip member lacks itinerary privileges."""


class ItineraryRevisionMismatchError(Exception):
    """Raised when If-Match does not match the stored itinerary revision."""


class ItineraryStopNotFoundError(Exception):
    """Raised when an itinerary stop is missing or hidden."""


class ItineraryConnectionNotFoundError(Exception):
    """Raised when an itinerary travel connection is missing or hidden."""


class ItineraryPlacementError(Exception):
    """Raised when a stop placement request is invalid."""


class ItineraryStayNotFoundError(Exception):
    """Raised when a stay is missing or belongs to another trip."""


class ItineraryStayValidationError(Exception):
    """Raised when a stay's dates or status don't fit."""


class ItineraryConnectionValidationError(Exception):
    """Raised when travel replacement payloads do not match resulting connections."""


class ItineraryMarkerError(Exception):
    """Raised when a marker would move too far from its stop's place."""


MARKER_MAX_DISTANCE_METERS = 25_000


@dataclass(frozen=True)
class ItinerarySnapshot:
    trip_id: uuid.UUID
    itinerary_revision: int
    stops: list[ItineraryStop]
    connections: list[ItineraryConnection]


@dataclass(frozen=True)
class ItineraryStopDetail:
    stop: ItineraryStop
    incoming_connection: ItineraryConnection | None
    outgoing_connection: ItineraryConnection | None
    itinerary_revision: int


@dataclass(frozen=True)
class StopNotesSave:
    stop: ItineraryStop
    replaced_change_by: User | None


@dataclass(frozen=True)
class ItineraryConnectionDetail:
    connection: ItineraryConnection
    itinerary_revision: int


class ItineraryService:
    """Coordinates planned itinerary stops, travel connections, and revision checks."""

    def __init__(
        self,
        db: Session,
        location_service: LocationService,
        route_service: ItineraryRouteService,
    ) -> None:
        self.db = db
        self.location_service = location_service
        self.route_service = route_service
        self.confirm_connection_deletion = False
        self._editing_user_id = None

    def _commit_itinerary(self, trip_id):
        from services.gps.flight_tracking_service import FlightTrackingService
        FlightTrackingService(self.db).sync_itinerary(trip_id)
        self.db.commit()

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

    def route_privacy(self, trip_id: uuid.UUID) -> list[tuple[float, float, int]]:
        """Every member's GPS privacy zones."""
        from services.gps.privacy_zone_service import GpsPrivacyZoneService

        return GpsPrivacyZoneService(self.db).list_trip_member_zone_coordinates(
            trip_id=trip_id
        )

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
            id=uuid.uuid4(),
            trip_id=trip_id,
            location_id=location.id,
            position=len(old_stops),
            title=payload.title,
            planned_nights=payload.planned_nights,
            created_by=membership.user_id,
        )
        new_order = self._ordered_with_inserted_stop(
            stops=old_stops,
            moving_stop=stop,
            placement=payload.placement,
        )
        index = new_order.index(stop)
        stop.planned_start_date = payload.planned_start_date or (
            self._leave_date(new_order[index - 1]) if index else trip.start_date
        )
        self._shift_stops(new_order[index + 1:], stop.planned_nights)
        self.db.add(stop)
        self.db.flush()

        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=new_order,
            stop_id=stop.id,
        )
        self._validate_connection_payload_sides(
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
            incoming_connection=payload.incoming_connection,
            outgoing_connection=payload.outgoing_connection,
        )

        self._apply_order(new_order)
        connections_by_pair = self._rebalance_connections(
            trip_id=trip_id,
            new_pairs=self._adjacent_pairs(new_order),
            new_order=new_order,
        )
        self._apply_side_replacements(
            connections_by_pair=connections_by_pair,
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
            incoming_connection=payload.incoming_connection,
            outgoing_connection=payload.outgoing_connection,
        )
        self._sync_side_routes(
            connections_by_pair=connections_by_pair,
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
        )
        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def get_member_stop(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItineraryStop:
        """One stop with its location, for trip members only (the header photo)."""
        self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        stop = self.db.execute(
            select(ItineraryStop)
            .options(joinedload(ItineraryStop.location))
            .where(ItineraryStop.trip_id == trip_id, ItineraryStop.id == stop_id)
        ).scalar_one_or_none()
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')
        return stop

    def require_itinerary_manager(self, trip_id: uuid.UUID, user_id: uuid.UUID) -> None:
        """Only people who may plan the trip can use its address search."""
        self._require_manage_trip(trip_id=trip_id, user_id=user_id)

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
        connections_by_pair = self._load_connections_by_pair(trip_id=trip_id)
        return ItineraryStopDetail(
            stop=stop,
            incoming_connection=connections_by_pair.get(incoming_pair or (None, stop_id)),
            outgoing_connection=connections_by_pair.get(outgoing_pair or (stop_id, None)),
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
            payload.incoming_connection is not None or payload.outgoing_connection is not None
        )

        if has_placement and payload.placement.after_stop_id == stop_id:
            raise ItineraryPlacementError(
                'after_stop_id cannot reference the same stop'
            )

        new_order = old_stops
        if has_placement:
            new_order = self._ordered_with_inserted_stop(
                stops=old_stops,
                moving_stop=stop,
                placement=payload.placement,
            )
        # Only placement changes the order; dates never do.
        placement_changed = [item.id for item in new_order] != [
            item.id for item in old_stops
        ]

        if has_travel_replacement and not (
            placement_changed or has_location_replacement
        ):
            raise ItineraryConnectionValidationError(
                'Travel replacements require a location replacement or changed placement'
            )

        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=new_order,
            stop_id=stop_id,
        )
        if placement_changed or has_location_replacement:
            self._validate_connection_payload_sides(
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
                incoming_connection=payload.incoming_connection,
                outgoing_connection=payload.outgoing_connection,
            )

        dates_changed = self._apply_stop_dates(
            old_order=old_stops,
            new_order=new_order,
            stop=stop,
            payload=payload,
        )
        metadata_changed = self._apply_stop_metadata_updates(stop=stop, payload=payload)
        if has_location_replacement:
            location = self.location_service.create_location_for_trip(
                trip_id=trip_id,
                created_by=current_user_id,
                location_input=payload.location,
            )
            stop.location_id = location.id
            stop.original_location_id = location.id
            self.db.flush()
            self.db.expire(stop, ['location', 'original_location'])
        marker_changed = 'marker' in payload.model_fields_set and self._move_marker(
            stop=stop, marker=payload.marker, current_user_id=current_user_id
        )

        changed = (
            metadata_changed
            or dates_changed
            or placement_changed
            or has_location_replacement
            or marker_changed
        )
        if not changed:
            return self._load_itinerary_snapshot(trip=trip)

        connections_by_pair = self._load_connections_by_pair(trip_id=trip_id)
        if placement_changed or has_location_replacement:
            self._apply_order(new_order)
            connections_by_pair = self._rebalance_connections(
                trip_id=trip_id,
                new_pairs=self._adjacent_pairs(new_order),
                new_order=new_order,
                reset_stop_ids={stop_id} if has_location_replacement else set(),
            )

        if placement_changed or has_location_replacement:
            self._apply_side_replacements(
                connections_by_pair=connections_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
                incoming_connection=payload.incoming_connection,
                outgoing_connection=payload.outgoing_connection,
            )
            self._sync_side_routes(
                connections_by_pair=connections_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
            )
        elif marker_changed:
            # Travel stays; ground routes that start or end here are drawn again.
            self._sync_side_routes(
                connections_by_pair=connections_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
            )

        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def _move_marker(self, *, stop, marker, current_user_id) -> bool:
        """Point the stop at a new spot near its original place, or back at it."""
        original = stop.original_location
        if marker is None:
            target_id = stop.original_location_id
        elif (marker.latitude, marker.longitude) == (original.latitude, original.longitude):
            target_id = stop.original_location_id
        else:
            if (marker.latitude, marker.longitude) == (
                stop.location.latitude,
                stop.location.longitude,
            ):
                return False
            distance = haversine_meters(
                original.latitude, original.longitude, marker.latitude, marker.longitude
            )
            if distance > MARKER_MAX_DISTANCE_METERS:
                raise ItineraryMarkerError(
                    f'The marker must stay within {MARKER_MAX_DISTANCE_METERS // 1000} km '
                    f'of {original.name}. Change the stop\'s place instead.'
                )
            # A new row: other records may point at the current one.
            location = Location(
                trip_id=stop.trip_id,
                name=original.name,
                latitude=marker.latitude,
                longitude=marker.longitude,
                country_code=original.country_code,
                region=original.region,
                full_name=original.full_name,
                source_place_id=original.source_place_id,
                created_by=current_user_id,
            )
            self.db.add(location)
            self.db.flush()
            target_id = location.id
        if target_id == stop.location_id:
            return False
        stop.location_id = target_id
        self.db.flush()
        self.db.expire(stop, ['location'])
        return True

    def save_stop_notes(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        notes: str,
        based_on: datetime | None,
        current_user_id: uuid.UUID,
    ) -> StopNotesSave:
        """Save notes without the itinerary revision; the last save wins.

        Notes never touch dates or routes, so the revision stays the same and
        a concurrent edit elsewhere in the trip never blocks typing.
        """
        self._require_manage_trip_locked_without_revision(
            trip_id=trip_id, user_id=current_user_id
        )
        stop = self.db.execute(
            select(ItineraryStop)
            .where(ItineraryStop.trip_id == trip_id, ItineraryStop.id == stop_id)
            .with_for_update()
        ).scalar_one_or_none()
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')
        replaced_by = None
        if (
            stop.notes != notes
            and stop.notes_updated_at is not None
            and stop.notes_updated_at != based_on
            and stop.notes_updated_by not in (None, current_user_id)
        ):
            replaced_by = self.db.execute(
                select(User)
                .options(joinedload(User.profile))
                .where(User.id == stop.notes_updated_by)
            ).scalar_one_or_none()
        if stop.notes != notes:
            stop.notes = notes
            stop.notes_updated_at = utcnow()
            stop.notes_updated_by = current_user_id
        self.db.commit()
        return StopNotesSave(stop=stop, replaced_change_by=replaced_by)

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

        self._shift_stops(
            old_stops[old_stops.index(stop) + 1:], -stop.planned_nights
        )
        new_order = [item for item in old_stops if item.id != stop_id]
        self._apply_order(new_order)
        connections_by_pair = self._rebalance_connections(
            trip_id=trip_id,
            new_pairs=self._adjacent_pairs(new_order),
            new_order=new_order,
        )
        self._sync_bridge_route_after_stop_delete(
            old_ordered_stops=old_stops,
            deleted_stop_id=stop_id,
            connections_by_pair=connections_by_pair,
        )
        self.db.delete(stop)
        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def create_stay(
        self,
        trip_id: uuid.UUID,
        payload: StayCreateRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        stop = self._get_stop_or_raise(trip_id, payload.stop_id)
        self._check_stay_dates(
            stop, payload.check_in_date, payload.check_out_date, check_in=True, check_out=True
        )
        stay = ItineraryStay(
            trip_id=trip_id,
            stop_id=stop.id,
            stay_type=payload.stay_type,
            status=self._stay_status(payload.stay_type, payload.status, 'status' in payload.model_fields_set),
            name=payload.name,
            check_in_date=payload.check_in_date,
            check_out_date=payload.check_out_date,
            created_by=current_user_id,
        )
        for field_name in _STAY_DETAIL_FIELDS:
            setattr(stay, field_name, getattr(payload, field_name))
        if payload.location is not None:
            stay.location_id = self.location_service.create_location_for_trip(
                trip_id=trip_id, created_by=current_user_id, location_input=payload.location
            ).id
        self.db.add(stay)
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def update_stay(
        self,
        trip_id: uuid.UUID,
        stay_id: uuid.UUID,
        payload: StayUpdateRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        """Change only the fields sent. Unchanged dates are never checked, so a
        booked stay that no longer fits its stop can still be edited."""
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        stay = self._get_stay_or_raise(trip_id, stay_id)
        stop = self._get_stop_or_raise(trip_id, stay.stop_id)
        fields = payload.model_fields_set
        check_in = payload.check_in_date if 'check_in_date' in fields else stay.check_in_date
        check_out = payload.check_out_date if 'check_out_date' in fields else stay.check_out_date
        self._check_stay_dates(
            stop,
            check_in,
            check_out,
            check_in=check_in != stay.check_in_date,
            check_out=check_out != stay.check_out_date,
        )
        stay_type = payload.stay_type if 'stay_type' in fields else stay.stay_type
        status = payload.status if 'status' in fields else stay.status
        stay.status = self._stay_status(stay_type, status, 'status' in fields)
        stay.stay_type = stay_type
        stay.check_in_date, stay.check_out_date = check_in, check_out
        for field_name in ('name', *_STAY_DETAIL_FIELDS):
            if field_name in fields:
                setattr(stay, field_name, getattr(payload, field_name))
        if 'location' in fields:
            stay.location_id = (
                self.location_service.create_location_for_trip(
                    trip_id=trip_id, created_by=current_user_id, location_input=payload.location
                ).id
                if payload.location is not None
                else None
            )
        if not self.db.is_modified(stay):
            return self._load_itinerary_snapshot(trip=trip)
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def delete_stay(
        self,
        trip_id: uuid.UUID,
        stay_id: uuid.UUID,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItinerarySnapshot:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        self.db.delete(self._get_stay_or_raise(trip_id, stay_id))
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    @staticmethod
    def _stay_status(stay_type: str, status: str | None, status_sent: bool) -> str | None:
        if stay_type in STAY_TYPES_WITHOUT_BOOKING:
            if status is not None and status_sent:
                raise ItineraryStayValidationError(f'{stay_type} stays have no status')
            return None
        if status is None and status_sent:
            raise ItineraryStayValidationError('status must be IDEA or BOOKED')
        return status or 'IDEA'

    def _check_stay_dates(
        self,
        stop: ItineraryStop,
        check_in_date: date,
        check_out_date: date,
        *,
        check_in: bool,
        check_out: bool,
    ) -> None:
        if check_out_date <= check_in_date:
            raise ItineraryStayValidationError('check_out_date must be after check_in_date')
        leave_date = self._leave_date(stop)
        for changed, value in ((check_in, check_in_date), (check_out, check_out_date)):
            if changed and not stop.planned_start_date <= value <= leave_date:
                raise ItineraryStayValidationError(
                    "A stay's dates must fall within its stop's nights"
                )

    def _get_stop_or_raise(self, trip_id: uuid.UUID, stop_id: uuid.UUID) -> ItineraryStop:
        stop = self.db.execute(
            select(ItineraryStop).where(
                ItineraryStop.trip_id == trip_id, ItineraryStop.id == stop_id
            )
        ).scalar_one_or_none()
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')
        return stop

    def _get_stay_or_raise(self, trip_id: uuid.UUID, stay_id: uuid.UUID) -> ItineraryStay:
        stay = self.db.execute(
            select(ItineraryStay).where(
                ItineraryStay.trip_id == trip_id, ItineraryStay.id == stay_id
            )
        ).scalar_one_or_none()
        if stay is None:
            raise ItineraryStayNotFoundError(f'Stay not found: {stay_id}')
        return stay

    def get_connection(
        self,
        trip_id: uuid.UUID,
        connection_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
        share_token: str | None = None,
    ) -> ItineraryConnectionDetail:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
            share_token=share_token,
        )
        connection = self._get_connection_or_raise(trip_id=trip_id, connection_id=connection_id)
        return ItineraryConnectionDetail(
            connection=connection,
            itinerary_revision=trip.itinerary_revision,
        )

    def replace_connection(
        self,
        trip_id: uuid.UUID,
        connection_id: uuid.UUID,
        payload: ItineraryConnectionReplaceRequest,
        current_user_id: uuid.UUID,
        expected_revision: int,
    ) -> ItineraryConnectionDetail:
        trip, _membership = self._require_manage_trip_locked(
            trip_id=trip_id,
            user_id=current_user_id,
            expected_revision=expected_revision,
        )
        connection = self._get_connection_or_raise(trip_id=trip_id, connection_id=connection_id)
        draft = self._connection_draft(connection, payload, current_user_id)
        endpoints_changed = any(
            endpoint_location(connection, side).id != endpoint_location(draft, side).id
            for side in ('from', 'to')
        )
        if not endpoints_changed and self._connection_payload_matches(
            payload=payload, connection=connection
        ):
            return ItineraryConnectionDetail(
                connection=connection, itinerary_revision=trip.itinerary_revision
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
                    setattr(connection, f'{side}_location_id', location.id)
                    self.db.expire(connection, [f'{side}_location'])
            for segment in connection.segments:
                if segment.flight:
                    segment.flight.lookup = None
                    segment.flight.lookup_owner_user_id = None
        self._replace_connection(connection=connection, payload=payload)
        if endpoints_changed:
            self._clear_artifacts(connection)
        self.route_service.invalidate(connection)
        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
        return ItineraryConnectionDetail(
            connection=self._get_connection_or_raise(trip_id=trip_id, connection_id=connection_id),
            itinerary_revision=trip.itinerary_revision,
        )

    def _connection_draft(self, connection, payload, actor, *, creating=False):
        stops = self._load_ordered_stops(connection.trip_id)
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
            or (not creating and pair != (connection.from_stop_id, connection.to_stop_id))
        ):
            raise HTTPException(
                409,
                {
                    'code': 'CONNECTION_TOPOLOGY_CONFLICT',
                    'message': 'Connection endpoints must preserve itinerary topology',
                },
            )
        values = {
            key: getattr(connection, key)
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
                current = getattr(connection, f'{side}_location', None)
                if current and location_identity(current) == location_identity(
                    resolved
                ):
                    location = current
                else:
                    location = DraftLocation(
                        **vars(resolved),
                        id=uuid.uuid4(),
                        source_place_id=getattr(endpoint.location, 'place_id', None),
                    )
                values[f'{side}_location'] = location
        return ConnectionDraft(**values)

    def create_connection(self, trip_id, payload, current_user_id, expected_revision):
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
                    self.route_service.artifacts.get(
                        segment.flight.candidate_id,
                        'FLIGHT_CANDIDATE',
                        draft,
                        current_user_id,
                    )
                )
        self.route_service.build(draft, payload, current_user_id)
        if payload.preview_id:
            artifacts.append(
                self.route_service.artifacts.get(
                    payload.preview_id,
                    'PREVIEW',
                    draft,
                    current_user_id,
                    expected_revision,
                    self.route_service.binding(draft, payload),
                )
            )
        connection = ItineraryConnection(
            id=uuid.uuid4(), trip_id=trip_id, notes='', segments=[]
        )
        pair = (draft.from_stop_id, draft.to_stop_id)
        connection.from_stop_id, connection.to_stop_id = pair
        for side, endpoint in (('from', payload.from_), ('to', payload.to)):
            if endpoint.type == 'LOCATION':
                location = self.location_service.create_location_for_trip(
                    trip_id,
                    current_user_id,
                    endpoint.location,
                )
                setattr(connection, f'{side}_location_id', location.id)
        self.db.add(connection)
        self.db.flush()
        for artifact in artifacts:
            artifact.connection_id = connection.id
        self._editing_user_id = current_user_id
        self._replace_connection(connection=connection, payload=payload)
        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
        return ItineraryConnectionDetail(
            self._get_connection_or_raise(trip_id, connection.id), trip.itinerary_revision
        )

    def _new_connection_draft(self, trip_id, payload, actor):
        from models.database.base import utcnow

        connection = ConnectionDraft(
            id=uuid.UUID(int=0),
            trip_id=trip_id,
            notes='',
            segments=[],
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        draft = self._connection_draft(connection, payload, actor, creating=True)
        if (draft.from_stop_id, draft.to_stop_id) in self._load_connections_by_pair(trip_id):
            raise HTTPException(409, {'code': 'CONNECTION_ALREADY_EXISTS'})
        return draft

    def _planning_connection(self, trip_id, connection_id, payload, actor):
        if connection_id is None:
            return self._new_connection_draft(trip_id, payload, actor)
        return self._connection_draft(
            self._get_connection_or_raise(trip_id, connection_id), payload, actor
        )

    def delete_connection(self, trip_id, connection_id, current_user_id, expected_revision):
        trip, _ = self._require_manage_trip_locked(
            trip_id, current_user_id, expected_revision
        )
        connection = self._get_connection_or_raise(trip_id, connection_id)
        if connection.from_stop_id is not None and connection.to_stop_id is not None:
            raise HTTPException(
                409,
                {
                    'code': 'CONNECTION_TOPOLOGY_CONFLICT',
                    'message': 'Between-stop connections are managed by the itinerary',
                },
            )
        self._confirm_discard([connection])
        self.db.delete(connection)
        self._increment_revision(trip)
        self._commit_itinerary(trip_id)
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

    def preview_connection(
        self, trip_id, connection_id, payload, actor, revision, retry_failed=False
    ):
        from models.api.itinerary import ItineraryConnectionResponse, PreviewResponse
        from services.planning_calculator import calculation_gate

        self._require_manage_trip_locked(trip_id, actor, revision)
        connection = self._planning_connection(trip_id, connection_id, payload, actor)
        segments = self.route_service.build(connection, payload, actor)
        binding = self.route_service.binding(connection, payload)
        # Reuse actor-owned provider results while inputs and revision still match.
        cached = self.route_service.artifacts.cached_preview(
            ArtifactScope(id=connection_id, trip_id=trip_id), actor, revision, binding,
        )
        if cached and not retry_failed:
            for seg, previous in zip(segments, cached.payload['routes'], strict=True):
                if previous and previous['input_hash'] == seg.input_hash:
                    seg.result = previous
            prepared = self.route_service.prepare_connection(connection, payload, segments)
            connection = ItineraryConnectionResponse.from_model(
                connection,
                route=self.route_service.connection(
                    connection, prepared.segments, warnings=prepared.warnings
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
        connection = self._planning_connection(trip_id, connection_id, payload, actor)
        current_segments = self.route_service.build(connection, payload, actor)
        if self.route_service.binding(connection, payload) != binding or [
            segment.input_hash for segment in current_segments
        ] != [segment.input_hash for segment in segments]:
            raise ItineraryRevisionMismatchError('Connection endpoint inputs changed')
        prepared = self.route_service.prepare_connection(connection, payload, segments)
        result = self.route_service.connection(
            connection, prepared.segments, warnings=prepared.warnings
        )
        if any(
            s.intent.travel_mode in ('CAR', 'BIKE', 'WALK')
            and s.start
            and s.end
            and s.result is None
            for s in segments
        ):
            result['warnings'].append(PlanningWarning(
                code='CALCULATION_INCOMPLETE',
                message='Calculation incomplete. Retry the remaining routes when ready.',
            ))
        connection = ItineraryConnectionResponse.from_model(connection, route=result)
        connection.notes = payload.notes
        artifact = self.route_service.artifacts.create(
            'PREVIEW',
            connection_id,
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
        self, trip_id, connection_id, current_user_id, expected_revision
    ):
        from models.database.itinerary import ItinerarySegmentRoute
        from services.planning_calculator import calculation_gate
        from services.planning_geometry import route_values

        self._require_manage_trip_locked(trip_id, current_user_id, expected_revision)
        connection = self._get_connection_or_raise(trip_id, connection_id)
        segments = self.route_service.build(connection)
        self.db.rollback()
        calculation_gate.enter(current_user_id, trip_id, connection_id)
        try:
            self.route_service.calculate(segments, retry_failed=True, force=True)
        finally:
            calculation_gate.leave(current_user_id, trip_id)
        trip, _ = self._require_manage_trip_locked(
            trip_id, current_user_id, expected_revision
        )
        connection = self._get_connection_or_raise(trip_id, connection_id)
        current = {s.id: s for s in self.route_service.build(connection)}
        for calculated in segments:
            if current[calculated.id].input_hash != calculated.input_hash:
                raise ItineraryRevisionMismatchError('Route inputs changed')
        prepared = self.route_service.prepare_connection(connection, None, segments)
        changed = False
        for calculated in prepared.segments:
            row = next(s for s in connection.segments if s.id == calculated.id)
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
        return ItineraryConnectionDetail(connection, trip.itinerary_revision)

    def lookup_flights(self, trip_id, connection_id, payload, actor, revision):
        from models.api.planning import FlightCandidate, FlightLookupResponse
        from services.flight_providers import FlightUnavailable
        from services.planning_calculator import calculation_gate
        from services.planning_geometry import fingerprint

        self._require_manage_trip_locked(trip_id, actor, revision)
        connection = (
            self._get_connection_or_raise(trip_id, connection_id)
            if connection_id is not None
            else ArtifactScope(id=None, trip_id=trip_id)
        )
        cached = self.route_service.artifacts.cached_flights(connection, actor, payload)
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
        # Candidates survive unrelated revisions, but never removal of access/connection.
        self._require_manage_trip_locked_without_revision(trip_id, actor)
        if connection_id is not None:
            self._get_connection_or_raise(trip_id, connection_id)
        if not matches:
            return FlightLookupResponse(status='NOT_FOUND')
        candidates, expiry = [], None
        for lookup in matches:
            lookup = resolve_flight_lookup_airports(self.db, lookup)
            artifact = self.route_service.artifacts.create(
                'FLIGHT_CANDIDATE',
                connection_id,
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
        trip = lock_trip(self.db, trip_id)
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return trip, self._require_manage_trip(trip_id=trip_id, user_id=user_id)

    def _require_manage_trip(self, trip_id: uuid.UUID, user_id: uuid.UUID) -> TripMember:
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
        return membership

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
        connections_by_pair = self._load_connections_by_pair(trip_id=trip.id)
        ordered_connections = [
            connections_by_pair[pair]
            for pair in (
                [(None, stops[0].id)]
                + self._adjacent_pairs(stops)
                + [(stops[-1].id, None)]
                if stops
                else []
            )
            if pair in connections_by_pair
        ]
        return ItinerarySnapshot(
            trip_id=trip.id,
            itinerary_revision=trip.itinerary_revision,
            stops=stops,
            connections=ordered_connections,
        )

    def _load_ordered_stops(self, trip_id: uuid.UUID) -> list[ItineraryStop]:
        return list(
            self.db.execute(
                select(ItineraryStop)
                .options(
                    joinedload(ItineraryStop.location),
                    joinedload(ItineraryStop.original_location),
                    joinedload(ItineraryStop.creator).joinedload(User.profile),
                    selectinload(ItineraryStop.stays).joinedload(ItineraryStay.location),
                )
                .where(ItineraryStop.trip_id == trip_id)
                .order_by(ItineraryStop.position.asc(), ItineraryStop.id.asc())
            )
            .scalars()
            .all()
        )

    def _load_connections_by_pair(
        self,
        trip_id: uuid.UUID,
    ) -> dict[StopPair, ItineraryConnection]:
        connections = list(
            self.db.execute(
                select(ItineraryConnection)
                .options(
                    selectinload(ItineraryConnection.segments).joinedload(
                        ItineraryTravelSegment.route
                    ),
                    selectinload(ItineraryConnection.segments).joinedload(
                        ItineraryTravelSegment.flight
                    ),
                )
                .where(ItineraryConnection.trip_id == trip_id)
            )
            .scalars()
            .all()
        )
        return {(connection.from_stop_id, connection.to_stop_id): connection for connection in connections}

    def _get_connection_or_raise(
        self,
        trip_id: uuid.UUID,
        connection_id: uuid.UUID,
    ) -> ItineraryConnection:
        connection = self.db.execute(
            select(ItineraryConnection).where(
                ItineraryConnection.trip_id == trip_id,
                ItineraryConnection.id == connection_id,
            )
        ).scalar_one_or_none()
        if connection is None:
            raise ItineraryConnectionNotFoundError(
                f'Itinerary travel connection not found: {connection_id}'
            )
        return connection

    def _ordered_with_inserted_stop(
        self,
        *,
        stops: list[ItineraryStop],
        moving_stop: ItineraryStop,
        placement: ItineraryPlacement,
    ) -> list[ItineraryStop]:
        """Return the stops with ``moving_stop`` placed right after its anchor."""
        source = [stop for stop in stops if stop.id != moving_stop.id]
        index = 0
        if placement.after_stop_id is not None:
            index = next(
                (
                    position + 1
                    for position, stop in enumerate(source)
                    if stop.id == placement.after_stop_id
                ),
                None,
            )
            if index is None:
                raise ItineraryStopNotFoundError(
                    f'Itinerary stop not found: {placement.after_stop_id}'
                )
        return source[:index] + [moving_stop] + source[index:]

    def _apply_order(self, ordered_stops: list[ItineraryStop]) -> None:
        for position, stop in enumerate(ordered_stops):
            stop.position = position
        self.db.flush()

    @staticmethod
    def _leave_date(stop: ItineraryStop) -> date:
        return stop.planned_start_date + timedelta(days=stop.planned_nights)

    def _shift_stops(self, stops: list[ItineraryStop], days: int) -> None:
        for stop in stops:
            self._shift_stop(stop, days)

    def _shift_stop(self, stop: ItineraryStop, days: int) -> None:
        """Move a stop and its idea stays. Booked stays, and stays that need
        no booking, keep their dates: the booking doesn't move with the plan."""
        if not days:
            return
        stop.planned_start_date += timedelta(days=days)
        for stay in stop.stays:
            if stay.status == 'IDEA':
                stay.check_in_date += timedelta(days=days)
                stay.check_out_date += timedelta(days=days)

    def _apply_stop_dates(
        self,
        *,
        old_order: list[ItineraryStop],
        new_order: list[ItineraryStop],
        stop: ItineraryStop,
        payload: ItineraryStopUpdateRequest,
    ) -> bool:
        """Apply a move, then the arrival date, then the nights.

        The gaps between stops never change on their own: every change pushes
        or pulls the stops after it by the same number of days.
        """
        before = {item.id: item.planned_start_date for item in old_order}
        nights_before = stop.planned_nights
        index = new_order.index(stop)
        if new_order != old_order:
            # A move is a removal followed by an insertion. A stop moved to
            # the front arrives when the stop it displaces did.
            self._shift_stops(
                old_order[old_order.index(stop) + 1:], -stop.planned_nights
            )
            arrival = (
                self._leave_date(new_order[index - 1])
                if index
                else new_order[1].planned_start_date
            )
            self._shift_stop(stop, (arrival - stop.planned_start_date).days)
            self._shift_stops(new_order[index + 1:], stop.planned_nights)
        if 'planned_start_date' in payload.model_fields_set:
            self._shift_stops(
                new_order[index:],
                (payload.planned_start_date - stop.planned_start_date).days,
            )
        if 'planned_nights' in payload.model_fields_set:
            difference = payload.planned_nights - stop.planned_nights
            stop.planned_nights = payload.planned_nights
            self._shift_stops(new_order[index + 1:], difference)
        return stop.planned_nights != nights_before or any(
            item.planned_start_date != before[item.id] for item in old_order
        )

    @staticmethod
    def _customized(connection):
        return bool(
            connection.notes
            or len(connection.segments) > 1
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
                for seg in connection.segments
            )
        )

    def _confirm_discard(self, connections):
        affected = [connection for connection in connections if self._customized(connection)]
        if affected and not self.confirm_connection_deletion:
            detail = {
                'code': 'CONNECTION_DELETION_REQUIRED',
                'connections': [
                    {
                        'id': str(connection.id),
                        'from': endpoint_label(connection, 'from'),
                        'to': endpoint_label(connection, 'to'),
                    }
                    for connection in affected
                ],
            }
            self.db.rollback()
            raise HTTPException(409, detail)

    def _clear_artifacts(self, connection):
        self.db.execute(
            delete(ItineraryPlanningArtifact).where(
                ItineraryPlanningArtifact.trip_id == connection.trip_id,
                ItineraryPlanningArtifact.connection_id == connection.id,
            )
        )

    def _rebalance_connections(self, *, trip_id, new_pairs, new_order, reset_stop_ids=None):
        reset_stop_ids = reset_stop_ids or set()
        existing = self._load_connections_by_pair(trip_id)
        desired = set(new_pairs)
        removals, resets, reanchors = [], [], []
        for pair, connection in existing.items():
            if connection.from_stop_id is None or connection.to_stop_id is None:
                if not new_order:
                    removals.append(connection)
                    continue
                target = (
                    (None, new_order[0].id)
                    if connection.from_stop_id is None
                    else (new_order[-1].id, None)
                )
                if pair != target:
                    reanchors.append((connection, target))
                    resets.append(connection)
            elif pair not in desired:
                removals.append(connection)
        self._confirm_discard(removals + resets)
        for connection in removals:
            self.db.delete(connection)
        # Release old stop uniqueness before reanchoring, and reanchor before stop deletion.
        self.db.flush()
        for connection, pair in reanchors:
            connection.from_stop_id, connection.to_stop_id = pair
            self.db.expire(connection, ['from_stop', 'to_stop'])
        self.db.flush()
        for connection in resets:
            self._reset_connection(connection)
        for connection in existing.values():
            if (
                connection not in removals
                and connection not in resets
                and reset_stop_ids.intersection((connection.from_stop_id, connection.to_stop_id))
            ):
                self.route_service.invalidate(connection)
                self._clear_artifacts(connection)
        kept = {
            (connection.from_stop_id, connection.to_stop_id): connection
            for connection in existing.values()
            if connection not in removals
        }
        for pair in new_pairs:
            if pair not in kept:
                connection = ItineraryConnection(
                    trip_id=trip_id, from_stop_id=pair[0], to_stop_id=pair[1], notes=''
                )
                self.db.add(connection)
                self.db.flush()
                self._reset_connection(connection)
                kept[pair] = connection
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

    def _validate_connection_payload_sides(
        self,
        *,
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
        incoming_connection: ConnectionIntent | None,
        outgoing_connection: ConnectionIntent | None,
    ) -> None:
        if incoming_connection is not None and incoming_pair is None:
            raise ItineraryConnectionValidationError(
                'incoming_connection requires a resulting incoming connection'
            )
        if outgoing_connection is not None and outgoing_pair is None:
            raise ItineraryConnectionValidationError(
                'outgoing_connection requires a resulting outgoing connection'
            )

    def _apply_side_replacements(
        self,
        *,
        connections_by_pair: dict[StopPair, ItineraryConnection],
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
        incoming_connection: ConnectionIntent | None,
        outgoing_connection: ConnectionIntent | None,
    ) -> None:
        if incoming_pair is not None and incoming_connection is not None:
            self._replace_connection(
                connection=connections_by_pair[incoming_pair], payload=incoming_connection
            )
        if outgoing_pair is not None and outgoing_connection is not None:
            self._replace_connection(
                connection=connections_by_pair[outgoing_pair], payload=outgoing_connection
            )

    def _sync_side_routes(
        self,
        *,
        connections_by_pair: dict[StopPair, ItineraryConnection],
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
    ) -> None:
        synced_connection_ids: set[uuid.UUID] = set()
        for pair in (incoming_pair, outgoing_pair):
            if pair is None:
                continue
            connection = connections_by_pair[pair]
            if connection.id in synced_connection_ids:
                continue
            self.route_service.invalidate(connection)
            synced_connection_ids.add(connection.id)

    def _sync_bridge_route_after_stop_delete(
        self,
        *,
        old_ordered_stops: list[ItineraryStop],
        deleted_stop_id: uuid.UUID,
        connections_by_pair: dict[StopPair, ItineraryConnection],
    ) -> None:
        incoming_pair, outgoing_pair = self._neighbor_pairs_for_stop(
            ordered_stops=old_ordered_stops,
            stop_id=deleted_stop_id,
        )
        if incoming_pair is None or outgoing_pair is None:
            return

        bridge_pair = (incoming_pair[0], outgoing_pair[1])
        bridge_connection = connections_by_pair.get(bridge_pair)
        if bridge_connection is not None:
            self.route_service.invalidate(bridge_connection)

    def _reset_connection(self, connection: ItineraryConnection) -> None:
        self._clear_artifacts(connection)
        connection.notes = ''
        connection.segments = [
            ItineraryTravelSegment(
                trip_id=connection.trip_id,
                position=0,
                mode_source='AUTO',
                travel_mode=self.route_service.infer_mode(
                    endpoint_location(connection, 'from'),
                    endpoint_location(connection, 'to'),
                    connection.trip_id,
                ),
            )
        ]
        self.db.flush()

    def _replace_connection(self, *, connection, payload) -> None:
        trip = self.db.get(Trip, connection.trip_id)
        self.route_service.persist(
            connection, payload, self._editing_user_id, trip.itinerary_revision
        )

    def _connection_payload_matches(self, *, payload, connection) -> bool:
        if payload.preview_id or any(s.mode_selected for s in (payload.segments or [])):
            return False
        if payload.segments is None:
            return (
                not self._customized(connection)
                and not payload.notes
                and len(connection.segments) == 1
                and connection.segments[0].travel_mode
                == self.route_service.infer_mode(
                    endpoint_location(connection, 'from'),
                    endpoint_location(connection, 'to'),
                    connection.trip_id,
                )
            )
        return payload.model_dump(
            mode='json', by_alias=True, exclude={'preview_id', 'from_', 'to'}
        ) == self.route_service.saved_intent(connection).model_dump(
            mode='json', by_alias=True, exclude={'preview_id'}
        )

    def _increment_revision(self, trip: Trip) -> None:
        trip.itinerary_revision += 1

    def _adjacent_pairs(self, stops: list[ItineraryStop]) -> list[StopPair]:
        return [
            (previous.id, current.id)
            for previous, current in zip(stops, stops[1:], strict=False)
        ]
