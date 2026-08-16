from __future__ import annotations

import pytest

from models.database.user import UserRole
from services.platform_authorization import (
    PlatformPermission,
    permissions_for_role,
    role_has_permission,
)


@pytest.mark.unit
def test_admin_has_every_platform_permission() -> None:
    assert permissions_for_role(UserRole.ADMIN) == frozenset(PlatformPermission)


@pytest.mark.unit
def test_user_can_create_trips_but_companion_cannot() -> None:
    assert role_has_permission(UserRole.USER, PlatformPermission.CREATE_TRIP)
    assert not role_has_permission(UserRole.COMPANION, PlatformPermission.CREATE_TRIP)


@pytest.mark.unit
def test_companion_has_no_platform_only_permissions() -> None:
    assert permissions_for_role(UserRole.COMPANION) == frozenset()
