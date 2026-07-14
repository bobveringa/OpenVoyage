from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from models.api.itinerary import (
    ItineraryPlacement,
    ItineraryStopCreateRequest,
    ItineraryStopUpdateRequest,
    ItineraryTravelReplaceRequest,
)
from models.database.itinerary import ItineraryStop, ItineraryTravelLeg, TravelMode
from models.database.trips import Trip, TripMember, TripVisibility
from models.database.user import User
from services.location_service import LocationService
from services.trip_authorization import TripPermission, role_has_permission

StopPair = tuple[uuid.UUID, uuid.UUID]


class TripNotFoundError(Exception):
    """Raised when a trip cannot be found or read by the user."""


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
    ) -> None:
        self.db = db
        self.location_service = location_service

    def get_itinerary(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> ItinerarySnapshot:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
        )
        return self._load_itinerary_snapshot(trip=trip)

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
        )
        self._apply_side_replacements(
            legs_by_pair=legs_by_pair,
            incoming_pair=incoming_pair,
            outgoing_pair=outgoing_pair,
            incoming_travel=payload.incoming_travel,
            outgoing_travel=payload.outgoing_travel,
        )
        self._increment_revision(trip)
        self.db.commit()
        return self._load_itinerary_snapshot_by_id(trip_id=trip_id)

    def get_stop_detail(
        self,
        trip_id: uuid.UUID,
        stop_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> ItineraryStopDetail:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
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
            incoming_leg=legs_by_pair.get(incoming_pair) if incoming_pair else None,
            outgoing_leg=legs_by_pair.get(outgoing_pair) if outgoing_pair else None,
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

        changed = metadata_changed or placement_changed or has_location_replacement
        if not changed:
            return self._load_itinerary_snapshot(trip=trip)

        legs_by_pair = self._load_legs_by_pair(trip_id=trip_id)
        if placement_changed:
            self._apply_order(new_order)
            legs_by_pair = self._rebalance_legs(
                trip_id=trip_id,
                new_pairs=self._adjacent_pairs(new_order),
            )

        if has_location_replacement:
            self._reset_side_legs(
                legs_by_pair=legs_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
            )
        if placement_changed or has_location_replacement:
            self._apply_side_replacements(
                legs_by_pair=legs_by_pair,
                incoming_pair=incoming_pair,
                outgoing_pair=outgoing_pair,
                incoming_travel=payload.incoming_travel,
                outgoing_travel=payload.outgoing_travel,
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
        old_stops = self._load_ordered_stops(trip_id=trip_id)
        stop = next((item for item in old_stops if item.id == stop_id), None)
        if stop is None:
            raise ItineraryStopNotFoundError(f'Itinerary stop not found: {stop_id}')

        new_order = [item for item in old_stops if item.id != stop_id]
        self._apply_order(new_order)
        self._rebalance_legs(
            trip_id=trip_id,
            new_pairs=self._adjacent_pairs(new_order),
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
    ) -> ItineraryTravelLegDetail:
        trip = self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
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
        current_pairs = set(self._adjacent_pairs(self._load_ordered_stops(trip_id)))
        if (leg.from_stop_id, leg.to_stop_id) not in current_pairs:
            raise ItineraryTravelLegNotFoundError(
                f'Itinerary travel leg not found: {leg_id}'
            )

        if self._travel_payload_matches_leg(payload=payload, leg=leg):
            return ItineraryTravelLegDetail(
                leg=leg,
                itinerary_revision=trip.itinerary_revision,
            )

        self._replace_travel(leg=leg, payload=payload)
        self._increment_revision(trip)
        self.db.commit()
        return ItineraryTravelLegDetail(
            leg=self._get_leg_or_raise(trip_id=trip_id, leg_id=leg_id),
            itinerary_revision=trip.itinerary_revision,
        )

    def _get_readable_trip_or_raise(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> Trip:
        trip = self.db.get(Trip, trip_id)
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        membership = (
            self._get_membership(trip_id=trip_id, user_id=current_user_id)
            if current_user_id is not None
            else None
        )
        if trip.visibility == TripVisibility.PUBLIC:
            return trip
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if not role_has_permission(membership.role, TripPermission.GET_ITINERARY):
            raise ItineraryPermissionError('The user does not have enough privileges')
        return trip

    def _require_manage_trip_locked(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        expected_revision: int,
    ) -> tuple[Trip, TripMember]:
        trip = self.db.execute(
            select(Trip).where(Trip.id == trip_id).with_for_update()
        ).scalar_one_or_none()
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        membership = self._get_membership(trip_id=trip_id, user_id=user_id)
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if not role_has_permission(membership.role, TripPermission.MANAGE_ITINERARY):
            raise ItineraryPermissionError('The user does not have enough privileges')
        if trip.itinerary_revision != expected_revision:
            raise ItineraryRevisionMismatchError('Itinerary revision does not match')
        return trip, membership

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
            for pair in self._adjacent_pairs(stops)
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
                select(ItineraryTravelLeg).where(ItineraryTravelLeg.trip_id == trip_id)
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

    def _rebalance_legs(
        self,
        *,
        trip_id: uuid.UUID,
        new_pairs: list[StopPair],
    ) -> dict[StopPair, ItineraryTravelLeg]:
        new_pair_set = set(new_pairs)
        existing_legs = self._load_legs_by_pair(trip_id=trip_id)
        kept: dict[StopPair, ItineraryTravelLeg] = {}

        for pair, leg in existing_legs.items():
            if pair in new_pair_set:
                kept[pair] = leg
            else:
                self.db.delete(leg)
        self.db.flush()

        for pair in new_pairs:
            if pair not in kept:
                leg = ItineraryTravelLeg(
                    trip_id=trip_id,
                    from_stop_id=pair[0],
                    to_stop_id=pair[1],
                    travel_mode=TravelMode.UNKNOWN,
                    notes='',
                    operator=None,
                    reference=None,
                )
                self.db.add(leg)
                kept[pair] = leg
        self.db.flush()
        return {pair: kept[pair] for pair in new_pairs}

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
        incoming_travel: ItineraryTravelReplaceRequest | None,
        outgoing_travel: ItineraryTravelReplaceRequest | None,
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
        incoming_travel: ItineraryTravelReplaceRequest | None,
        outgoing_travel: ItineraryTravelReplaceRequest | None,
    ) -> None:
        if incoming_pair is not None and incoming_travel is not None:
            self._replace_travel(
                leg=legs_by_pair[incoming_pair], payload=incoming_travel
            )
        if outgoing_pair is not None and outgoing_travel is not None:
            self._replace_travel(
                leg=legs_by_pair[outgoing_pair], payload=outgoing_travel
            )

    def _reset_side_legs(
        self,
        *,
        legs_by_pair: dict[StopPair, ItineraryTravelLeg],
        incoming_pair: StopPair | None,
        outgoing_pair: StopPair | None,
    ) -> None:
        for pair in (incoming_pair, outgoing_pair):
            if pair is not None:
                self._reset_travel(legs_by_pair[pair])

    def _reset_travel(self, leg: ItineraryTravelLeg) -> None:
        leg.travel_mode = TravelMode.UNKNOWN
        leg.notes = ''
        leg.operator = None
        leg.reference = None

    def _replace_travel(
        self,
        *,
        leg: ItineraryTravelLeg,
        payload: ItineraryTravelReplaceRequest,
    ) -> None:
        leg.travel_mode = payload.travel_mode
        leg.notes = payload.notes
        leg.operator = payload.operator
        leg.reference = payload.reference

    def _travel_payload_matches_leg(
        self,
        *,
        payload: ItineraryTravelReplaceRequest,
        leg: ItineraryTravelLeg,
    ) -> bool:
        return (
            TravelMode(leg.travel_mode) == payload.travel_mode
            and leg.notes == payload.notes
            and leg.operator == payload.operator
            and leg.reference == payload.reference
        )

    def _increment_revision(self, trip: Trip) -> None:
        trip.itinerary_revision += 1

    def _adjacent_pairs(self, stops: list[ItineraryStop]) -> list[StopPair]:
        return [
            (previous.id, current.id)
            for previous, current in zip(stops, stops[1:], strict=False)
        ]
