"""Read connection entities while asserting the mutation revision contract."""


def planning_body(response):
    data = response.json()
    if isinstance(data, dict) and 'connection' in data and 'itinerary_revision' in data:
        assert response.headers['etag'] == f'"{data["itinerary_revision"]}"'
        assert set(data) == {'connection', 'itinerary_revision'}
        return data['connection']
    return data
