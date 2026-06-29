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
    GET_POST = 'post:getPost'
    LIST_POSTS = 'post:listPosts'
    CREATE_POST = 'post:createPost'
    UPDATE_POST = 'post:updatePost'
    DELETE_POST = 'post:deletePost'
    PUBLISH_POST = 'post:publishPost'


ROLE_PERMISSIONS: dict[TripRole, set[TripPermission]] = {
    TripRole.OWNER: {
        TripPermission.GET_TRIP,
        TripPermission.UPDATE_TRIP,
        TripPermission.DELETE_TRIP,
        TripPermission.LIST_MEMBERS,
        TripPermission.MANAGE_MEMBERS,
        TripPermission.GET_POST,
        TripPermission.LIST_POSTS,
        TripPermission.CREATE_POST,
        TripPermission.UPDATE_POST,
        TripPermission.DELETE_POST,
        TripPermission.PUBLISH_POST,
    },
    TripRole.MEMBER: {
        TripPermission.GET_TRIP,
        TripPermission.LIST_MEMBERS,
        TripPermission.GET_POST,
        TripPermission.LIST_POSTS,
        TripPermission.CREATE_POST,
        TripPermission.UPDATE_POST,
        TripPermission.DELETE_POST,
        TripPermission.PUBLISH_POST,
    },
    TripRole.VIEWER: {
        TripPermission.GET_TRIP,
        TripPermission.LIST_MEMBERS,
        TripPermission.GET_POST,
        TripPermission.LIST_POSTS,
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
