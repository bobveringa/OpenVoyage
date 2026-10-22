
from planning_helpers import planning_body
import pytest

from services.route_providers.route_provider import RouteProviderError, RouteProviderLimitError
from tests.integration.services import test_itinerary_route_service as route_tests
from tests.integration.services.test_itinerary_route_service import (
    connection_write,
    enable_routes,
    headers,
)


plan = route_tests.plan


@pytest.mark.parametrize('explicit', [False, True])
@pytest.mark.parametrize('failure', ['unavailable', 'disabled', 'timeout', 'limit'])
def test_saved_auto_car_falls_back_only_for_unavailable_routes(
    client, db_session, plan, monkeypatch, failure, explicit
):
    user, _, _, endpoint, revision, connection, _ = plan
    if explicit:
        saved = client.put(
            endpoint,
            headers=headers(user, revision),
            json=connection_write(connection, {'segments': [
                connection['segments'][0]['intent'] | {'mode_selected': True}
            ]}),
        )
        assert saved.status_code == 200, saved.text
        revision = saved.headers['etag']

    def unavailable(*args, **kwargs):
        raise {
            'unavailable': RouteProviderError('No road connection'),
            'timeout': TimeoutError(),
            'limit': RouteProviderLimitError('Try later'),
        }[failure]

    if failure != 'disabled':
        enable_routes(db_session, monkeypatch, unavailable)
    response = client.post(endpoint + '/route-refresh', headers=headers(user, revision))
    assert response.status_code == 200, response.text
    fallback = not explicit and failure in {'unavailable', 'disabled'}
    segment = planning_body(response)['segments'][0]
    assert segment['intent']['travel_mode'] == ('OTHER' if fallback else 'CAR')
    assert segment['mode_source'] == ('USER' if explicit else 'AUTO')
    assert segment['route_state'] == ('UNSUPPORTED' if fallback else 'FAILED')
    assert planning_body(client.get(endpoint, headers=headers(user)))['segments'] == planning_body(response)['segments']


@pytest.mark.parametrize('echo_segments', [False, True])
def test_inferred_preview_suggests_other_when_car_is_unavailable(
    client, plan, echo_segments
):
    user, _, _, endpoint, revision, connection, _ = plan
    payload = connection_write(connection, {})
    for _ in range(2):  # Cached suggestions must use the same fallback.
        preview = client.post(endpoint + '/preview', headers=headers(user, revision), json=payload)
        assert preview.status_code == 200, preview.text
        segment = planning_body(preview)['connection']['segments'][0]
        assert segment['intent']['travel_mode'] == 'OTHER'
        assert segment['mode_source'] == 'AUTO'
        assert segment['route_state'] == 'UNSUPPORTED'
    saved = client.put(
        endpoint, headers=headers(user, revision),
        json=connection_write(connection, {
            'preview_id': planning_body(preview)['preview_id'],
            **({'segments': [segment['intent']]} if echo_segments else {}),
        }),
    )
    assert saved.status_code == 200, saved.text
    assert planning_body(saved)['segments'][0]['intent']['travel_mode'] == 'OTHER'
    assert planning_body(saved)['segments'][0]['route_state'] == 'UNSUPPORTED'
