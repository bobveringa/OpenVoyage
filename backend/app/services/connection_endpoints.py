"""Effective anchors shared by planning, reconciliation and response construction."""


def endpoint_location(leg, side):
    stop = getattr(leg, f'{side}_stop', None)
    return stop.location if stop is not None else getattr(leg, f'{side}_location')


def endpoint_label(leg, side):
    stop = getattr(leg, f'{side}_stop', None)
    return stop.title if stop is not None else endpoint_location(leg, side).name


def location_identity(location):
    # Place IDs and raw coordinates that resolve to the same point are one anchor.
    return (location.longitude, location.latitude)


def endpoint_identity(leg, side):
    location = endpoint_location(leg, side)
    return {
        'stop_id': getattr(leg, f'{side}_stop_id', None),
        'coordinates': location_identity(location),
    }
