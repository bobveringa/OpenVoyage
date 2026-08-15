import enum


class TravelMode(str, enum.Enum):
    """Transport mode shared by itinerary legs, post routes, and GPS samples.

    Values are stored as plain strings in ``String(32)`` columns, so adding a
    member is a code change only and never needs a migration.
    """

    UNKNOWN = 'UNKNOWN'
    WALK = 'WALK'
    BIKE = 'BIKE'
    MOTORCYCLE = 'MOTORCYCLE'
    CAR = 'CAR'
    BUS = 'BUS'
    TRAIN = 'TRAIN'
    FERRY = 'FERRY'
    FLIGHT = 'FLIGHT'
    OTHER = 'OTHER'
