import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from models.api.itinerary import (
    PlannedStepCreateRequest,
    PlannedStepUpdateRequest,
    PlannedTravelCreateRequest,
    PlannedTravelUpdateRequest,
)
from models.database.planned_steps import PlannedStep
from models.database.planned_travel import PlannedTravel
from models.database.trips import Trip, TripMember, TripVisibility
from services.location_service import LocationService
from services.trip_authorization import TripPermission, role_has_permission
from services.trip_service import TripNotFoundError, TripPermissionError

POSITION_STEP = 1000


class PlannedStepNotFoundError(Exception):
    """Raised when a planned step cannot be found in the requested trip."""


class PlannedStepDateRangeError(Exception):
    """Raised when planned step dates are internally inconsistent."""


class PlannedStepPlacementError(Exception):
    """Raised when a planned step cannot be placed at the requested position."""


class PlannedStepPositionConflictError(Exception):
    """Raised when concurrent ordering changes produce a duplicate position."""


class PlannedTravelNotFoundError(Exception):
    """Raised when a planned travel record cannot be found in the requested trip."""


class PlannedTravelStepError(Exception):
    """Raised when planned travel references invalid or cross-trip steps."""


class PlannedTravelAlreadyExistsError(Exception):
    """Raised when the same step-to-step travel record already exists."""


class ItineraryService:
    """Coordinates trip itinerary stops, manual ordering, and travel links."""

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
    ) -> tuple[list[PlannedStep], list[PlannedTravel]]:
        self._require_read_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        return (
            self._list_steps_for_trip(trip_id=trip_id),
            self._list_travel_for_trip(trip_id=trip_id),
        )

    def list_planned_steps(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> list[PlannedStep]:
        self._require_read_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        return self._list_steps_for_trip(trip_id=trip_id)

    def create_planned_step(
        self,
        trip_id: uuid.UUID,
        payload: PlannedStepCreateRequest,
        current_user_id: uuid.UUID,
    ) -> PlannedStep:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        self._validate_step_dates(
            arrival_date=payload.arrival_date,
            departure_date=payload.departure_date,
        )

        position = self._position_after(
            trip_id=trip_id,
            after_planned_step_id=payload.after_planned_step_id,
        )
        location = self.location_service.create_location_for_trip(
            trip_id=trip_id,
            created_by=current_user_id,
            location_input=payload.location,
        )
        planned_step = PlannedStep(
            trip_id=trip_id,
            position=position,
            location_id=location.id,
            arrival_date=payload.arrival_date,
            departure_date=payload.departure_date,
            notes=payload.notes,
        )
        self.db.add(planned_step)
        self._commit_planned_step_position_change(
            trip_id=trip_id,
            position=position,
        )
        return self._get_step_or_raise(trip_id=trip_id, step_id=planned_step.id)

    def get_planned_step(
        self,
        trip_id: uuid.UUID,
        step_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> PlannedStep:
        self._require_read_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        return self._get_step_or_raise(trip_id=trip_id, step_id=step_id)

    def update_planned_step(
        self,
        trip_id: uuid.UUID,
        step_id: uuid.UUID,
        payload: PlannedStepUpdateRequest,
        current_user_id: uuid.UUID,
    ) -> PlannedStep:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        planned_step = self._get_step_or_raise(trip_id=trip_id, step_id=step_id)

        if payload.location is not None:
            location = self.location_service.create_location_for_trip(
                trip_id=trip_id,
                created_by=current_user_id,
                location_input=payload.location,
            )
            planned_step.location_id = location.id
        if payload.arrival_date is not None:
            planned_step.arrival_date = payload.arrival_date
        if payload.departure_date is not None:
            planned_step.departure_date = payload.departure_date
        if payload.notes is not None:
            planned_step.notes = payload.notes

        self._validate_step_dates(
            arrival_date=planned_step.arrival_date,
            departure_date=planned_step.departure_date,
        )
        self.db.commit()
        return self._get_step_or_raise(trip_id=trip_id, step_id=step_id)

    def move_planned_step(
        self,
        trip_id: uuid.UUID,
        step_id: uuid.UUID,
        after_planned_step_id: uuid.UUID | None,
        current_user_id: uuid.UUID,
    ) -> PlannedStep:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        planned_step = self._get_step_or_raise(trip_id=trip_id, step_id=step_id)
        if after_planned_step_id == step_id:
            raise PlannedStepPlacementError('A planned step cannot be moved after itself')

        position = self._position_after(
            trip_id=trip_id,
            after_planned_step_id=after_planned_step_id,
            moving_step_id=step_id,
        )
        planned_step.position = position
        self._commit_planned_step_position_change(
            trip_id=trip_id,
            position=position,
            current_step_id=step_id,
        )
        return self._get_step_or_raise(trip_id=trip_id, step_id=step_id)

    def delete_planned_step(
        self,
        trip_id: uuid.UUID,
        step_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        planned_step = self._get_step_or_raise(trip_id=trip_id, step_id=step_id)
        self.db.delete(planned_step)
        self.db.commit()

    def list_planned_travel(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> list[PlannedTravel]:
        self._require_read_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        return self._list_travel_for_trip(trip_id=trip_id)

    def create_planned_travel(
        self,
        trip_id: uuid.UUID,
        payload: PlannedTravelCreateRequest,
        current_user_id: uuid.UUID,
    ) -> PlannedTravel:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        self._validate_travel_steps(
            trip_id=trip_id,
            from_planned_step_id=payload.from_planned_step_id,
            to_planned_step_id=payload.to_planned_step_id,
        )
        self._raise_if_duplicate_travel(
            trip_id=trip_id,
            from_planned_step_id=payload.from_planned_step_id,
            to_planned_step_id=payload.to_planned_step_id,
        )

        planned_travel = PlannedTravel(
            trip_id=trip_id,
            from_planned_step_id=payload.from_planned_step_id,
            to_planned_step_id=payload.to_planned_step_id,
            travel_mode=payload.travel_mode,
            notes=payload.notes,
        )
        self.db.add(planned_travel)
        self._commit_planned_travel_change(
            trip_id=trip_id,
            from_planned_step_id=payload.from_planned_step_id,
            to_planned_step_id=payload.to_planned_step_id,
        )
        self.db.refresh(planned_travel)
        return planned_travel

    def get_planned_travel(
        self,
        trip_id: uuid.UUID,
        travel_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> PlannedTravel:
        self._require_read_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        return self._get_travel_or_raise(trip_id=trip_id, travel_id=travel_id)

    def update_planned_travel(
        self,
        trip_id: uuid.UUID,
        travel_id: uuid.UUID,
        payload: PlannedTravelUpdateRequest,
        current_user_id: uuid.UUID,
    ) -> PlannedTravel:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        planned_travel = self._get_travel_or_raise(
            trip_id=trip_id,
            travel_id=travel_id,
        )

        from_step_id = payload.from_planned_step_id or planned_travel.from_planned_step_id
        to_step_id = payload.to_planned_step_id or planned_travel.to_planned_step_id
        self._validate_travel_steps(
            trip_id=trip_id,
            from_planned_step_id=from_step_id,
            to_planned_step_id=to_step_id,
        )
        if (
            from_step_id != planned_travel.from_planned_step_id
            or to_step_id != planned_travel.to_planned_step_id
        ):
            self._raise_if_duplicate_travel(
                trip_id=trip_id,
                from_planned_step_id=from_step_id,
                to_planned_step_id=to_step_id,
                current_travel_id=travel_id,
            )
            planned_travel.from_planned_step_id = from_step_id
            planned_travel.to_planned_step_id = to_step_id
        if payload.travel_mode is not None:
            planned_travel.travel_mode = payload.travel_mode
        if payload.notes is not None:
            planned_travel.notes = payload.notes

        self._commit_planned_travel_change(
            trip_id=trip_id,
            from_planned_step_id=from_step_id,
            to_planned_step_id=to_step_id,
            current_travel_id=travel_id,
        )
        self.db.refresh(planned_travel)
        return planned_travel

    def delete_planned_travel(
        self,
        trip_id: uuid.UUID,
        travel_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        self._require_manage_itinerary_permission(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        planned_travel = self._get_travel_or_raise(
            trip_id=trip_id,
            travel_id=travel_id,
        )
        self.db.delete(planned_travel)
        self.db.commit()

    def _require_read_itinerary_permission(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID | None,
    ) -> None:
        trip = self.db.get(Trip, trip_id)
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if trip.visibility == TripVisibility.PUBLIC:
            return
        if user_id is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=user_id,
            permission=TripPermission.LIST_ITINERARY,
        )

    def _require_manage_itinerary_permission(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=user_id,
            permission=TripPermission.MANAGE_ITINERARY,
        )

    def _require_trip_permission(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        permission: TripPermission,
    ) -> None:
        membership = self.db.execute(
            select(TripMember).where(
                TripMember.trip_id == trip_id,
                TripMember.user_id == user_id,
            )
        ).scalar_one_or_none()
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        if not role_has_permission(membership.role, permission):
            raise TripPermissionError('The user does not have enough privileges')

    def _list_steps_for_trip(self, trip_id: uuid.UUID) -> list[PlannedStep]:
        statement = (
            select(PlannedStep)
            .options(joinedload(PlannedStep.location))
            .where(PlannedStep.trip_id == trip_id)
            .order_by(PlannedStep.position.asc(), PlannedStep.id.asc())
        )
        return list(self.db.execute(statement).scalars().all())

    def _list_travel_for_trip(self, trip_id: uuid.UUID) -> list[PlannedTravel]:
        statement = (
            select(PlannedTravel)
            .join(
                PlannedStep,
                PlannedStep.id == PlannedTravel.from_planned_step_id,
            )
            .where(PlannedTravel.trip_id == trip_id)
            .order_by(PlannedStep.position.asc(), PlannedTravel.id.asc())
        )
        return list(self.db.execute(statement).scalars().all())

    def _get_step_or_raise(
        self,
        trip_id: uuid.UUID,
        step_id: uuid.UUID,
    ) -> PlannedStep:
        planned_step = self.db.execute(
            select(PlannedStep)
            .options(joinedload(PlannedStep.location))
            .where(
                PlannedStep.id == step_id,
                PlannedStep.trip_id == trip_id,
            )
        ).scalar_one_or_none()
        if planned_step is None:
            raise PlannedStepNotFoundError(f'Planned step not found: {step_id}')
        return planned_step

    def _get_travel_or_raise(
        self,
        trip_id: uuid.UUID,
        travel_id: uuid.UUID,
    ) -> PlannedTravel:
        planned_travel = self.db.execute(
            select(PlannedTravel).where(
                PlannedTravel.id == travel_id,
                PlannedTravel.trip_id == trip_id,
            )
        ).scalar_one_or_none()
        if planned_travel is None:
            raise PlannedTravelNotFoundError(f'Planned travel not found: {travel_id}')
        return planned_travel

    def _position_after(
        self,
        trip_id: uuid.UUID,
        after_planned_step_id: uuid.UUID | None,
        moving_step_id: uuid.UUID | None = None,
    ) -> int:
        steps = [
            step
            for step in self._list_steps_for_trip(trip_id=trip_id)
            if step.id != moving_step_id
        ]
        if not steps:
            return POSITION_STEP

        if after_planned_step_id is None:
            first_position = steps[0].position
            if first_position > 1:
                return first_position // 2
            self._rebalance_positions(trip_id=trip_id, exclude_step_id=moving_step_id)
            return self._position_after(
                trip_id=trip_id,
                after_planned_step_id=None,
                moving_step_id=moving_step_id,
            )

        after_index = next(
            (
                index
                for index, step in enumerate(steps)
                if step.id == after_planned_step_id
            ),
            None,
        )
        if after_index is None:
            raise PlannedStepPlacementError(
                f'Placement step not found: {after_planned_step_id}'
            )

        after_position = steps[after_index].position
        if after_index == len(steps) - 1:
            return after_position + POSITION_STEP

        before_position = steps[after_index + 1].position
        if before_position - after_position > 1:
            return after_position + ((before_position - after_position) // 2)

        self._rebalance_positions(trip_id=trip_id, exclude_step_id=moving_step_id)
        return self._position_after(
            trip_id=trip_id,
            after_planned_step_id=after_planned_step_id,
            moving_step_id=moving_step_id,
        )

    def _rebalance_positions(
        self,
        trip_id: uuid.UUID,
        exclude_step_id: uuid.UUID | None = None,
    ) -> None:
        steps = [
            step
            for step in self._list_steps_for_trip(trip_id=trip_id)
            if step.id != exclude_step_id
        ]
        for index, step in enumerate(steps, start=1):
            step.position = -index * POSITION_STEP
        self._flush_planned_step_position_change()

        for index, step in enumerate(steps, start=1):
            step.position = index * POSITION_STEP
        self._flush_planned_step_position_change()

    def _validate_step_dates(
        self,
        arrival_date,
        departure_date,
    ) -> None:
        if departure_date < arrival_date:
            raise PlannedStepDateRangeError(
                'departure_date must be on or after arrival_date'
            )

    def _validate_travel_steps(
        self,
        trip_id: uuid.UUID,
        from_planned_step_id: uuid.UUID,
        to_planned_step_id: uuid.UUID,
    ) -> None:
        if from_planned_step_id == to_planned_step_id:
            raise PlannedTravelStepError(
                'from_planned_step_id and to_planned_step_id must differ'
            )
        step_count = self.db.execute(
            select(PlannedStep.id).where(
                PlannedStep.trip_id == trip_id,
                PlannedStep.id.in_([from_planned_step_id, to_planned_step_id]),
            )
        ).all()
        if len(step_count) != 2:
            raise PlannedTravelStepError(
                'Both planned travel steps must belong to the trip'
            )

    def _raise_if_duplicate_travel(
        self,
        trip_id: uuid.UUID,
        from_planned_step_id: uuid.UUID,
        to_planned_step_id: uuid.UUID,
        current_travel_id: uuid.UUID | None = None,
    ) -> None:
        statement = select(PlannedTravel.id).where(
            PlannedTravel.trip_id == trip_id,
            PlannedTravel.from_planned_step_id == from_planned_step_id,
            PlannedTravel.to_planned_step_id == to_planned_step_id,
        )
        existing_id = self.db.execute(statement).scalar_one_or_none()
        if existing_id is not None and existing_id != current_travel_id:
            raise PlannedTravelAlreadyExistsError(
                'Planned travel already exists between these steps'
            )

    def _commit_planned_step_position_change(
        self,
        trip_id: uuid.UUID,
        position: int,
        current_step_id: uuid.UUID | None = None,
    ) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            if self._planned_step_position_exists(
                trip_id=trip_id,
                position=position,
                current_step_id=current_step_id,
            ):
                raise PlannedStepPositionConflictError(
                    'Planned step order changed concurrently; retry the operation'
                ) from exc
            raise

    def _flush_planned_step_position_change(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as exc:
            self.db.rollback()
            raise PlannedStepPositionConflictError(
                'Planned step order changed concurrently; retry the operation'
            ) from exc

    def _commit_planned_travel_change(
        self,
        trip_id: uuid.UUID,
        from_planned_step_id: uuid.UUID,
        to_planned_step_id: uuid.UUID,
        current_travel_id: uuid.UUID | None = None,
    ) -> None:
        try:
            self.db.commit()
        except IntegrityError as exc:
            self.db.rollback()
            if self._planned_travel_exists(
                trip_id=trip_id,
                from_planned_step_id=from_planned_step_id,
                to_planned_step_id=to_planned_step_id,
                current_travel_id=current_travel_id,
            ):
                raise PlannedTravelAlreadyExistsError(
                    'Planned travel already exists between these steps'
                ) from exc
            raise

    def _planned_step_position_exists(
        self,
        trip_id: uuid.UUID,
        position: int,
        current_step_id: uuid.UUID | None = None,
    ) -> bool:
        statement = select(PlannedStep.id).where(
            PlannedStep.trip_id == trip_id,
            PlannedStep.position == position,
        )
        if current_step_id is not None:
            statement = statement.where(PlannedStep.id != current_step_id)
        return self.db.execute(statement).scalar_one_or_none() is not None

    def _planned_travel_exists(
        self,
        trip_id: uuid.UUID,
        from_planned_step_id: uuid.UUID,
        to_planned_step_id: uuid.UUID,
        current_travel_id: uuid.UUID | None = None,
    ) -> bool:
        statement = select(PlannedTravel.id).where(
            PlannedTravel.trip_id == trip_id,
            PlannedTravel.from_planned_step_id == from_planned_step_id,
            PlannedTravel.to_planned_step_id == to_planned_step_id,
        )
        if current_travel_id is not None:
            statement = statement.where(PlannedTravel.id != current_travel_id)
        return self.db.execute(statement).scalar_one_or_none() is not None
