import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from models.api.pagination import SortDirection
from models.api.trips import TripCreateRequest, TripSortField, TripUpdateRequest
from models.database.media import Media
from models.database.trips import Trip, TripMember, TripRole, TripVisibility
from models.database.user import User
from services.trip_authorization import TripPermission, role_has_permission


class TripNotFoundError(Exception):
    """Raised when a trip cannot be found."""


class MediaNotFoundError(Exception):
    """Raised when requested cover media cannot be found."""


class CoverMediaOwnershipError(Exception):
    """Raised when a user tries to use media they do not own."""


class CoverMediaAlreadyUsedError(Exception):
    """Raised when media is already used as a trip cover."""


class TripPermissionError(Exception):
    """Raised when a trip member does not have enough privileges."""


class TripMemberNotFoundError(Exception):
    """Raised when a trip membership cannot be found."""


class TripMemberAlreadyExistsError(Exception):
    """Raised when a trip membership already exists."""


class LastTripOwnerError(Exception):
    """Raised when an action would remove the final trip owner."""


class UserNotFoundError(Exception):
    """Raised when a user cannot be found."""


class TripService:
    """Coordinates trip lifecycle, membership management, and authorization.

    Args:
        db: SQLAlchemy session used for all trip and membership persistence.
    """

    def __init__(self, db: Session) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads and writes.
        """
        self.db = db

    def create_trip(
        self,
        payload: TripCreateRequest,
        current_user_id: uuid.UUID,
    ) -> Trip:
        """Create a trip and make the current user its initial owner.

        Args:
            payload: Request data containing trip metadata and cover media id.
            current_user_id: Id of the authenticated user creating the trip.

        Returns:
            The newly created trip.

        Raises:
            MediaNotFoundError: The requested cover media does not exist.
            CoverMediaOwnershipError: The cover media belongs to another user.
            CoverMediaAlreadyUsedError: The cover media is already used by a trip.
        """
        self._validate_cover_media(
            media_id=payload.media_id,
            current_user_id=current_user_id,
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

    def update_trip(
        self,
        trip_id: uuid.UUID,
        payload: TripUpdateRequest,
        current_user_id: uuid.UUID,
    ) -> Trip:
        """Update owner-managed trip metadata and optional cover media.

        Args:
            trip_id: Id of the trip to update.
            payload: Partial update payload for trip fields.
            current_user_id: Id of the authenticated user performing the update.

        Returns:
            The updated trip.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the user.
            TripPermissionError: The user is a member but lacks update permission.
            MediaNotFoundError: The replacement cover media does not exist.
            CoverMediaOwnershipError: The replacement cover belongs to another user.
            CoverMediaAlreadyUsedError: The replacement cover is used by another trip.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.UPDATE_TRIP,
        )
        trip = self._get_trip_or_raise(trip_id=trip_id)

        if payload.name is not None:
            trip.name = payload.name
        if payload.description is not None:
            trip.description = payload.description
        if payload.visibility is not None:
            trip.visibility = payload.visibility
        if payload.media_id is not None and payload.media_id != trip.cover_media_id:
            self._validate_cover_media(
                media_id=payload.media_id,
                current_user_id=current_user_id,
                current_trip_id=trip_id,
            )
            trip.cover_media_id = payload.media_id

        self.db.commit()
        self.db.refresh(trip)
        return trip

    def delete_trip(self, trip_id: uuid.UUID, current_user_id: uuid.UUID) -> None:
        """Delete a trip after verifying the current user may delete it.

        Args:
            trip_id: Id of the trip to delete.
            current_user_id: Id of the authenticated user performing deletion.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the user.
            TripPermissionError: The user is a member but lacks delete permission.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.DELETE_TRIP,
        )
        trip = self._get_trip_or_raise(trip_id=trip_id)

        self.db.delete(trip)
        self.db.commit()

    def get_trip(self, trip_id: uuid.UUID, current_user_id: uuid.UUID | None) -> Trip:
        """Return a trip when public or readable by the current member.

        Args:
            trip_id: Id of the trip to retrieve.
            current_user_id: Authenticated user id, or ``None`` for anonymous reads.

        Returns:
            The readable trip.

        Raises:
            TripNotFoundError: The trip is missing or not readable by the user.
            TripPermissionError: The member role does not grant read permission.
        """
        return self._get_readable_trip_or_raise(
            trip_id=trip_id,
            current_user_id=current_user_id,
        )

    def list_trips_for_user(
        self,
        current_user_id: uuid.UUID,
        *,
        offset: int,
        limit: int,
        sort_by: TripSortField,
        sort_order: SortDirection,
    ) -> tuple[list[Trip], int]:
        """Return a paginated page of trips where the user is a member.

        Args:
            current_user_id: Id of the user whose memberships define the list.
            offset: Number of matching rows to skip.
            limit: Maximum number of trips to return.
            sort_by: Trip column used for primary sorting.
            sort_order: Direction for the primary sort column.

        Returns:
            A tuple containing the current page of trips and total match count.
        """
        sort_columns = {
            TripSortField.CREATED_AT: Trip.created_at,
            TripSortField.UPDATED_AT: Trip.updated_at,
            TripSortField.NAME: Trip.name,
        }
        sort_column = sort_columns[sort_by]
        sort_expression = (
            sort_column.asc() if sort_order == SortDirection.ASC else sort_column.desc()
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

    def list_trip_members(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> list[TripMember]:
        """Return trip members when the current user can list them.

        Args:
            trip_id: Id of the trip whose members should be listed.
            current_user_id: Id of the authenticated user requesting the list.

        Returns:
            All trip memberships with user/profile data loaded.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the user.
            TripPermissionError: The user lacks member-list permission.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.LIST_MEMBERS,
        )

        statement = (
            select(TripMember)
            .join(TripMember.user)
            .options(joinedload(TripMember.user).joinedload(User.profile))
            .where(TripMember.trip_id == trip_id)
            .order_by(User.email.asc(), TripMember.user_id.asc())
        )
        return list(self.db.execute(statement).scalars().all())

    def add_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
        role: TripRole,
    ) -> TripMember:
        """Add a user to a trip after verifying member-management permission.

        Args:
            trip_id: Id of the trip receiving a new member.
            current_user_id: Id of the authenticated user adding the member.
            target_user_id: Id of the user to add as a member.
            role: Role to assign to the new member.

        Returns:
            The created membership.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the current user.
            TripPermissionError: The user lacks member-management permission.
            UserNotFoundError: The target user does not exist.
            TripMemberAlreadyExistsError: The target user is already a member.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_MEMBERS,
        )

        target_user = self.db.get(User, target_user_id)
        if target_user is None:
            raise UserNotFoundError(f'User not found: {target_user_id}')

        existing_membership = self._get_membership(
            trip_id=trip_id,
            user_id=target_user_id,
        )
        if existing_membership is not None:
            raise TripMemberAlreadyExistsError(
                f'User is already a trip member: {target_user_id}'
            )

        membership = TripMember(
            trip_id=trip_id,
            user_id=target_user_id,
            role=role,
        )
        self.db.add(membership)
        self.db.commit()
        self.db.refresh(membership)
        return membership

    def update_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
        role: TripRole,
    ) -> TripMember:
        """Change an existing trip member's role.

        Args:
            trip_id: Id of the trip containing the membership.
            current_user_id: Id of the authenticated user changing the role.
            target_user_id: Id of the member whose role should change.
            role: New role for the target member.

        Returns:
            The updated membership.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the current user.
            TripPermissionError: The user lacks member-management permission.
            TripMemberNotFoundError: The target user is not a trip member.
            LastTripOwnerError: The change would leave the trip without owners.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_MEMBERS,
        )
        membership = self._get_trip_member_or_raise(
            trip_id=trip_id,
            user_id=target_user_id,
        )

        if membership.role == TripRole.OWNER and role != TripRole.OWNER:
            self._raise_if_last_owner(trip_id=trip_id)

        membership.role = role
        self.db.commit()
        self.db.refresh(membership)
        return membership

    def remove_trip_member(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        target_user_id: uuid.UUID,
    ) -> None:
        """Remove an existing trip member.

        Args:
            trip_id: Id of the trip containing the membership.
            current_user_id: Id of the authenticated user removing the member.
            target_user_id: Id of the member to remove.

        Raises:
            TripNotFoundError: The trip is missing or hidden from the current user.
            TripPermissionError: The user lacks member-management permission.
            TripMemberNotFoundError: The target user is not a trip member.
            LastTripOwnerError: The removal would leave the trip without owners.
        """
        self._require_trip_permission(
            trip_id=trip_id,
            user_id=current_user_id,
            permission=TripPermission.MANAGE_MEMBERS,
        )
        membership = self._get_trip_member_or_raise(
            trip_id=trip_id,
            user_id=target_user_id,
        )

        if membership.role == TripRole.OWNER:
            self._raise_if_last_owner(trip_id=trip_id)

        self.db.delete(membership)
        self.db.commit()

    def _get_membership(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember | None:
        """Return the membership row for a user in a trip, if present.

        Args:
            trip_id: Id of the trip that may contain the membership.
            user_id: Id of the user whose membership should be loaded.

        Returns:
            The membership row, or ``None`` when the user is not a member.
        """
        return self.db.execute(
            select(TripMember).where(
                TripMember.trip_id == trip_id,
                TripMember.user_id == user_id,
            )
        ).scalar_one_or_none()

    def _get_trip_or_raise(self, trip_id: uuid.UUID) -> Trip:
        """Return a trip by id, or raise when it does not exist.

        Args:
            trip_id: Id of the trip to load.

        Returns:
            The requested trip with cover media loaded.

        Raises:
            TripNotFoundError: No trip exists for the supplied id.
        """
        trip = self.db.execute(
            select(Trip).options(joinedload(Trip.cover_media)).where(Trip.id == trip_id)
        ).scalar_one_or_none()
        if trip is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return trip

    def _validate_cover_media(
        self,
        media_id: uuid.UUID,
        current_user_id: uuid.UUID,
        current_trip_id: uuid.UUID | None = None,
    ) -> None:
        """Validate that media can be used as the current user's trip cover.

        Args:
            media_id: Id of the media to use as a cover.
            current_user_id: Id of the user attempting to use the media.
            current_trip_id: Existing trip id allowed to already use this cover.

        Raises:
            MediaNotFoundError: The media row does not exist.
            CoverMediaOwnershipError: The media was not created by the user.
            CoverMediaAlreadyUsedError: Another trip already uses the media.
        """
        media = self.db.get(Media, media_id)
        if media is None:
            raise MediaNotFoundError(f'Media not found: {media_id}')

        if media.created_by != current_user_id:
            raise CoverMediaOwnershipError(
                'The selected media is not owned by the user'
            )

        existing_trip_id = self.db.execute(
            select(Trip.id).where(Trip.cover_media_id == media_id)
        ).scalar_one_or_none()
        if existing_trip_id is not None and existing_trip_id != current_trip_id:
            raise CoverMediaAlreadyUsedError(
                f'Media is already used as a trip cover: {media_id}'
            )

    def _get_readable_trip_or_raise(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID | None,
    ) -> Trip:
        """Return a trip when visibility and membership allow read access.

        Args:
            trip_id: Id of the trip to read.
            current_user_id: Authenticated user id, or ``None`` for anonymous reads.

        Returns:
            The trip when it is public or readable by the user's role.

        Raises:
            TripNotFoundError: The trip is missing or not readable by the user.
            TripPermissionError: The member role does not grant read permission.
        """
        trip = self._get_trip_or_raise(trip_id=trip_id)
        if trip.visibility == TripVisibility.PUBLIC:
            return trip
        if current_user_id is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')

        membership = self._require_trip_member(
            trip_id=trip_id,
            user_id=current_user_id,
        )
        if not role_has_permission(membership.role, TripPermission.GET_TRIP):
            raise TripPermissionError('The user does not have enough privileges')
        return trip

    def _get_trip_member_or_raise(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        """Return the target membership being managed, or raise if missing.

        Args:
            trip_id: Id of the trip containing the target membership.
            user_id: Id of the target member.

        Returns:
            The target membership row.

        Raises:
            TripMemberNotFoundError: The target user is not a trip member.
        """
        membership = self._get_membership(trip_id=trip_id, user_id=user_id)
        if membership is None:
            raise TripMemberNotFoundError(f'Trip member not found: {user_id}')
        return membership

    def _require_trip_member(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        """Require that the current user has a membership on the trip.

        Args:
            trip_id: Id of the trip being accessed.
            user_id: Id of the current user.

        Returns:
            The current user's membership.

        Raises:
            TripNotFoundError: The user is not a member of the trip.
        """
        membership = self._get_membership(
            trip_id=trip_id,
            user_id=user_id,
        )
        if membership is None:
            raise TripNotFoundError(f'Trip not found: {trip_id}')
        return membership

    def _require_trip_permission(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
        permission: TripPermission,
    ) -> TripMember:
        """Require that the current user's role grants a trip permission.

        Args:
            trip_id: Id of the trip being accessed.
            user_id: Id of the current user.
            permission: Permission required for the attempted action.

        Returns:
            The current user's membership.

        Raises:
            TripNotFoundError: The user is not a member of the trip.
            TripPermissionError: The user's role does not grant the permission.
        """
        membership = self._require_trip_member(trip_id=trip_id, user_id=user_id)
        if not role_has_permission(membership.role, permission):
            raise TripPermissionError('The user does not have enough privileges')
        return membership

    def _raise_if_last_owner(self, trip_id: uuid.UUID) -> None:
        """Raise when a role change/removal would leave a trip without owners.

        Args:
            trip_id: Id of the trip whose owner count should be checked.

        Raises:
            LastTripOwnerError: The trip currently has one or fewer owners.
        """
        owner_count = self.db.execute(
            select(func.count())
            .select_from(TripMember)
            .where(
                TripMember.trip_id == trip_id,
                TripMember.role == TripRole.OWNER,
            )
        ).scalar_one()
        if owner_count <= 1:
            raise LastTripOwnerError('Cannot remove the last trip owner')
