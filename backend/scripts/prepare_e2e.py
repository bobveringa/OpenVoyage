from __future__ import annotations

import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class E2EPlace:
    external_id: str
    name: str
    latitude: float
    longitude: float
    country_code: str
    region: str
    full_name: str
    population: int


E2E_PLACES = (
    E2EPlace(
        external_id='coimbra',
        name='Coimbra',
        latitude=40.2033,
        longitude=-8.4103,
        country_code='PT',
        region='Coimbra',
        full_name='Coimbra, Coimbra, Portugal',
        population=106_582,
    ),
    E2EPlace(
        external_id='porto',
        name='Porto',
        latitude=41.1496,
        longitude=-8.6109,
        country_code='PT',
        region='Porto',
        full_name='Porto, Porto, Portugal',
        population=249_633,
    ),
)


def main() -> None:
    backend_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_root / 'app'))

    from core import security
    from core.db import get_engine
    from models.api.admin import SetupCreateRequest
    from models.database import Place, User, UserProfile
    from models.database.places import PlaceFeatureClass
    from models.database.user import UserRole

    email = require_environment_variable('E2E_LOGIN_EMAIL').lower()
    password = require_environment_variable('E2E_LOGIN_PASSWORD')
    account = SetupCreateRequest(
        email=email,
        password=password,
        username='ci-e2e',
        first_name='CI',
        last_name='E2E',
    )

    with Session(get_engine()) as session:
        existing_user = session.scalar(select(User).where(User.email == email))
        if existing_user is None:
            if session.scalar(select(User.id).limit(1)) is not None:
                raise RuntimeError(
                    'The E2E account is missing, but this database already contains '
                    'users. Refusing to seed a non-isolated database.'
                )

            user_id = uuid.uuid4()
            session.add(
                User(
                    id=user_id,
                    email=email,
                    password_hash=security.get_password_hash(password),
                    role=UserRole.ADMIN.value,
                )
            )
            session.add(
                UserProfile(
                    user_id=user_id,
                    username=account.username,
                    first_name=account.first_name,
                    last_name=account.last_name,
                    biography='',
                )
            )
        else:
            password_matches, _ = security.verify_password(
                password, existing_user.password_hash
            )
            if not password_matches:
                raise RuntimeError(
                    'The existing E2E account does not match E2E_LOGIN_PASSWORD.'
                )

        for fixture in E2E_PLACES:
            place = session.scalar(
                select(Place).where(
                    Place.external_source == 'e2e',
                    Place.external_id == fixture.external_id,
                )
            )
            if place is None:
                place = Place(
                    external_source='e2e',
                    external_id=fixture.external_id,
                    feature_class=PlaceFeatureClass.POPULATED_PLACE.value,
                )
                session.add(place)

            place.name = fixture.name
            place.latitude = fixture.latitude
            place.longitude = fixture.longitude
            place.country_code = fixture.country_code
            place.region = fixture.region
            place.full_name = fixture.full_name
            place.population = fixture.population

        session.commit()

    print(f'Prepared isolated E2E fixtures for {email}.')


def require_environment_variable(name: str) -> str:
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} must be set before preparing E2E fixtures.')
    return value


if __name__ == '__main__':
    main()
