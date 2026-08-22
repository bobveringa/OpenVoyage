def test_health_check_reports_ready_when_database_is_available(client):
    response = client.get('/health')

    assert response.status_code == 200
    assert response.json() == {'status': 'ok'}
