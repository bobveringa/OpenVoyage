import enum

from models.database.trips import TripRole


class TripPermission(str, enum.Enum):
    """Application-level permissions available within a trip membership.

    Enum values use action strings that can be logged or compared outside Python.
    """

    GET_TRIP = 'trip:getTrip'
    UPDATE_TRIP = 'trip:updateTrip'
    DELETE_TRIP = 'trip:deleteTrip'
    LIST_MEMBERS = 'trip:listMembers'
    MANAGE_MEMBERS = 'trip:manageMembers'


ROLE_PERMISSIONS: dict[TripRole, set[TripPermission]] = {
    TripRole.OWNER: {
        TripPermission.GET_TRIP,
        TripPermission.UPDATE_TRIP,
        TripPermission.DELETE_TRIP,
        TripPermission.LIST_MEMBERS,
        TripPermission.MANAGE_MEMBERS,
    },
    TripRole.MEMBER: {
        TripPermission.GET_TRIP,
        TripPermission.LIST_MEMBERS,
    },
    TripRole.VIEWER: {
        TripPermission.GET_TRIP,
        TripPermission.LIST_MEMBERS,
    },
}


def role_has_permission(role: TripRole, permission: TripPermission) -> bool:
    """Return whether a trip role grants the requested permission.

    Args:
        role: Trip role assigned to a member.
        permission: Permission required for an action.

    Returns:
        ``True`` when the role grants the permission.
    """
    return permission in ROLE_PERMISSIONS[role]
