import enum

from models.database.user import UserRole


class PlatformPermission(str, enum.Enum):
    """Permissions that apply to the platform rather than a specific trip."""

    CREATE_TRIP = 'trip:create'
    ADMINISTER_PLATFORM = 'platform:administer'


ROLE_PERMISSIONS: dict[UserRole, frozenset[PlatformPermission]] = {
    UserRole.ADMIN: frozenset(PlatformPermission),
    UserRole.USER: frozenset({PlatformPermission.CREATE_TRIP}),
    UserRole.COMPANION: frozenset(),
}


def permissions_for_role(role: UserRole) -> frozenset[PlatformPermission]:
    """Return the effective platform permissions granted to a user role."""
    return ROLE_PERMISSIONS[role]


def role_has_permission(role: UserRole, permission: PlatformPermission) -> bool:
    """Return whether a platform role grants a permission."""
    return permission in permissions_for_role(role)
