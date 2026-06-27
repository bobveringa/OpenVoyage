from __future__ import annotations

import pytest

from models.database.trips import TripRole
from services.trip_authorization import TripPermission, role_has_permission


@pytest.mark.unit
def test_owner_has_all_current_trip_permissions() -> None:
    for permission in TripPermission:
        assert role_has_permission(TripRole.OWNER, permission)


@pytest.mark.unit
def test_member_can_read_and_list_members_only() -> None:
    assert role_has_permission(TripRole.MEMBER, TripPermission.GET_TRIP)
    assert role_has_permission(TripRole.MEMBER, TripPermission.LIST_MEMBERS)
    assert not role_has_permission(TripRole.MEMBER, TripPermission.UPDATE_TRIP)
    assert not role_has_permission(TripRole.MEMBER, TripPermission.DELETE_TRIP)
    assert not role_has_permission(TripRole.MEMBER, TripPermission.MANAGE_MEMBERS)


@pytest.mark.unit
def test_viewer_can_read_and_list_members_only() -> None:
    assert role_has_permission(TripRole.VIEWER, TripPermission.GET_TRIP)
    assert role_has_permission(TripRole.VIEWER, TripPermission.LIST_MEMBERS)
    assert not role_has_permission(TripRole.VIEWER, TripPermission.UPDATE_TRIP)
    assert not role_has_permission(TripRole.VIEWER, TripPermission.DELETE_TRIP)
    assert not role_has_permission(TripRole.VIEWER, TripPermission.MANAGE_MEMBERS)
