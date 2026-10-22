
from planning_helpers import planning_body
import uuid
from datetime import date, timedelta
import pytest
from core import security
from factories.places import create_place
from factories.trips import add_trip_viewer, create_trip
from factories.users import create_user


def _auth_headers(user, *, etag: str | None = None) -> dict[str, str]:
    tokens = security.create_auth_tokens(subject=user.id, email=user.email)
    headers = {'Authorization': f'Bearer {tokens["access_token"]}'}
    if etag is not None:
        headers['If-Match'] = etag
    return headers


def _place_location(place) -> dict[str, str]:
    return {'place_id': str(place.id)}


def _stop_payload(
    place,
    *,
    title: str,
    planned_start_date: str = '2026-08-14',
    planned_nights: int = 0,
    after_stop_id: str | None = None,
    incoming_connection: dict | None = None,
    outgoing_connection: dict | None = None,
) -> dict:
    return {
        'location': _place_location(place),
        'title': title,
        'notes': '',
        'planned_nights': planned_nights,
        'placement': {
            'planned_start_date': planned_start_date,
            'after_stop_id': after_stop_id,
        },
        'incoming_connection': incoming_connection,
        'outgoing_connection': outgoing_connection,
    }


@pytest.mark.integration
def test_itinerary_stop_visited_is_derived_from_departure_date(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    current_place = create_place(db_session, name='Current city')
    next_place = create_place(db_session, name='Next city')
    today = date.today()

    current_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(
            current_place,
            title='Current stop',
            planned_start_date=today.isoformat(),
            planned_nights=0,
        ),
    )
    next_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"1"'),
        json=_stop_payload(
            next_place,
            title='Next stop',
            planned_start_date=(today + timedelta(days=1)).isoformat(),
        ),
    )

    assert current_response.status_code == 201
    assert next_response.status_code == 201
    assert [
        (stop['title'], stop['visited']) for stop in planning_body(next_response)['stops']
    ] == [
        ('Current stop', True),
        ('Next stop', False),
    ]


@pytest.mark.integration
def test_itinerary_mutations_require_current_quoted_revision(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    place = create_place(db_session)
    endpoint = f'{api_prefix}/trips/{trip.id}/itinerary/stops'

    missing_response = client.post(
        endpoint,
        headers=_auth_headers(owner),
        json=_stop_payload(place, title='Kyoto'),
    )
    invalid_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='0'),
        json=_stop_payload(place, title='Kyoto'),
    )
    create_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Kyoto'),
    )
    stale_response = client.post(
        endpoint,
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Second Kyoto'),
    )

    assert missing_response.status_code == 428
    assert invalid_response.status_code == 422
    assert create_response.status_code == 201
    assert create_response.headers['etag'] == '"1"'
    assert stale_response.status_code == 412
    assert planning_body(stale_response)['detail'] == {
        'code': 'ITINERARY_CHANGED',
        'connections': [],
        'segment_id': None,
        'validation_errors': [],
        'message': (
            'This trip\'s plan changed while you were editing. '
            'Reload the page and try again. '
            'Your unsaved changes will be lost when you reload.'
        ),
    }

    get_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=_auth_headers(owner),
    )
    assert get_response.status_code == 200
    assert get_response.headers['etag'] == '"1"'
    assert [stop['title'] for stop in planning_body(get_response)['stops']] == ['Kyoto']


@pytest.mark.integration
def test_itinerary_permissions_follow_trip_roles(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    viewer = create_user(db_session, password='ItineraryPass123!')
    non_member = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    add_trip_viewer(
        db_session,
        trip_id=trip.id,
        user_id=viewer.id,
        created_by=owner.id,
    )
    place = create_place(db_session)
    endpoint = f'{api_prefix}/trips/{trip.id}/itinerary/stops'

    viewer_response = client.post(
        endpoint,
        headers=_auth_headers(viewer, etag='"0"'),
        json=_stop_payload(place, title='Viewer stop'),
    )
    non_member_response = client.post(
        endpoint,
        headers=_auth_headers(non_member, etag='"0"'),
        json=_stop_payload(place, title='Non-member stop'),
    )
    read_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=_auth_headers(viewer),
    )

    assert viewer_response.status_code == 403
    assert non_member_response.status_code == 404
    assert read_response.status_code == 403


@pytest.mark.integration
def test_share_link_can_read_only_private_trip_route_overview(
    client,
    db_session,
    api_prefix,
) -> None:
    owner = create_user(db_session, password='ItineraryPass123!')
    trip = create_trip(db_session, owner_id=owner.id)
    place = create_place(db_session, name='Utrecht')
    owner_headers = _auth_headers(owner)
    create_stop_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers=_auth_headers(owner, etag='"0"'),
        json=_stop_payload(place, title='Shared stop'),
    )
    link_response = client.post(
        f'{api_prefix}/trips/{trip.id}/share-links',
        headers=owner_headers,
        json={'label': 'Itinerary'},
    )
    share_headers = {'X-Trip-Share-Token': planning_body(link_response)['token']}

    read_response = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary',
        headers=share_headers,
    )
    mutate_response = client.post(
        f'{api_prefix}/trips/{trip.id}/itinerary/stops',
        headers={**share_headers, 'If-Match': '"1"'},
        json=_stop_payload(place, title='Blocked stop'),
    )

    assert create_stop_response.status_code == 201
    assert link_response.status_code == 201
    assert read_response.status_code == 403
    overview = client.get(
        f'{api_prefix}/trips/{trip.id}/itinerary/overview', headers=share_headers,
    )
    assert overview.status_code == 200
    assert [stop['title'] for stop in planning_body(overview)['stops']] == ['Utrecht']
    assert mutate_response.status_code == 401


@pytest.mark.integration
def test_itinerary_returns_not_found_for_missing_ids(client, api_prefix) -> None:
    response = client.get(f'{api_prefix}/trips/{uuid.uuid4()}/itinerary')
    assert response.status_code == 404
