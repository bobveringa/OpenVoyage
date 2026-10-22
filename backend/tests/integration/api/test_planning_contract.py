"""Planning clients receive typed errors and revisions without reading headers."""

import pytest

from integration.services.test_itinerary_route_service import headers, plan  # noqa: F401


@pytest.mark.parametrize(
    'case,status,code',
    [
        ('missing_revision', 428, 'REVISION_REQUIRED'),
        ('invalid_revision', 422, 'VALIDATION_ERROR'),
        ('stale_revision', 412, 'ITINERARY_CHANGED'),
        ('invalid_body', 422, 'VALIDATION_ERROR'),
        ('unauthenticated', 401, 'AUTHENTICATION_REQUIRED'),
    ],
)
def test_planning_errors_share_the_documented_shape(client, plan, case, status, code):  # noqa: F811
    user, _, _, endpoint, revision, connection, _ = plan
    payload = {
        'from': connection['from'],
        'to': connection['to'],
        'segments': [{'travel_mode': 'CAR'}],
    }
    request_headers = headers(user, revision)
    if case == 'missing_revision':
        request_headers.pop('If-Match')
    elif case == 'invalid_revision':
        request_headers['If-Match'] = 'unquoted'
    elif case == 'stale_revision':
        request_headers['If-Match'] = '"0"'
    elif case == 'invalid_body':
        payload['segments'] = []
    elif case == 'unauthenticated':
        request_headers.pop('Authorization')
    response = client.put(endpoint, headers=request_headers, json=payload)
    assert response.status_code == status, response.text
    detail = response.json()['detail']
    assert detail['code'] == code
    assert detail['message']
    assert detail['connections'] == []
    assert detail['segment_id'] is None
    assert bool(detail['validation_errors']) == (case == 'invalid_body')
    assert response.headers['cache-control'] == 'private, no-store'


def test_openapi_documents_planning_errors_and_connection_mutations(client, api_prefix):
    schema = client.app.openapi()
    operation = schema['paths'][
        f'{api_prefix}/trips/{{trip_id}}/itinerary/connections/{{connection_id}}'
    ]['put']
    for status in (401, 403, 404, 409, 412, 422, 428, 429):
        assert operation['responses'][str(status)]['content']['application/json'][
            'schema'
        ]['$ref'].endswith('/PlanningErrorResponse')
    assert operation['responses']['200']['content']['application/json']['schema'][
        '$ref'
    ].endswith('/ConnectionMutationResponse')
