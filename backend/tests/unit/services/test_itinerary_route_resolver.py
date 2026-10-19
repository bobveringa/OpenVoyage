from services.place_service import valid_timezone


def test_timezone_names_are_validated_without_guessing():
    assert valid_timezone('Europe/Amsterdam') == 'Europe/Amsterdam'
    assert valid_timezone('not/a-zone') is None
