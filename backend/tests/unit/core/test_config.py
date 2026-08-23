from __future__ import annotations

import pytest
from pydantic import ValidationError

from core.config import MINIMUM_KEY_MATERIAL_LENGTH, Settings

STRONG_SECRET = 'q' * MINIMUM_KEY_MATERIAL_LENGTH
STRONG_DB_PASSWORD = 'x2Tqf-9wPl0Zr'


def build_settings(**overrides: object) -> Settings:
    """Build settings from explicit values, ignoring the repository .env file."""
    values: dict[str, object] = {
        'ENVIRONMENT': 'production',
        'SECRET_KEY': STRONG_SECRET,
        'POSTGRES_PASSWORD': STRONG_DB_PASSWORD,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.mark.unit
def test_accepts_generated_secrets():
    settings = build_settings()

    assert settings.SECRET_KEY == STRONG_SECRET


@pytest.mark.unit
def test_secret_key_has_no_default():
    # A per-process default would sign each worker's tokens with a different
    # key, so an unset SECRET_KEY has to be an error rather than a fallback.
    with pytest.raises(ValidationError, match='SECRET_KEY must be set'):
        build_settings(SECRET_KEY='')


@pytest.mark.unit
@pytest.mark.parametrize(
    'variable',
    ['SECRET_KEY', 'POSTGRES_PASSWORD'],
)
def test_rejects_the_shipped_example_secret(variable: str):
    with pytest.raises(ValidationError, match='published example value'):
        build_settings(**{variable: 'change-this-to-a-long-random-secret'})


@pytest.mark.unit
def test_rejects_the_example_postgres_password():
    with pytest.raises(ValidationError, match='published example value'):
        build_settings(POSTGRES_PASSWORD='travelblog_password')


@pytest.mark.unit
def test_rejects_an_invented_placeholder():
    with pytest.raises(ValidationError, match='looks like a placeholder'):
        build_settings(SECRET_KEY=f'{"a" * 40}-CHANGEthis')


@pytest.mark.unit
def test_rejects_short_key_material():
    with pytest.raises(ValidationError, match='shorter than'):
        build_settings(SECRET_KEY='q' * (MINIMUM_KEY_MATERIAL_LENGTH - 1))


@pytest.mark.unit
def test_allows_a_short_postgres_password():
    # Only key material feeds the crypto primitives; the database password is
    # checked for placeholders but its length is the operator's call.
    settings = build_settings(POSTGRES_PASSWORD='hunter2')

    assert settings.POSTGRES_PASSWORD == 'hunter2'


@pytest.mark.unit
@pytest.mark.unit
def test_local_environment_warns_instead_of_failing():
    with pytest.warns(UserWarning, match='published example value'):
        settings = build_settings(
            ENVIRONMENT='local',
            SECRET_KEY='change-this-to-a-long-random-secret',
        )

    assert settings.ENVIRONMENT == 'local'


@pytest.mark.unit
def test_environment_defaults_to_the_strict_setting():
    # An operator who never sets ENVIRONMENT gets the checks, not a bypass.
    settings = Settings(
        _env_file=None,
        SECRET_KEY=STRONG_SECRET,
        POSTGRES_PASSWORD=STRONG_DB_PASSWORD,
    )

    assert settings.ENVIRONMENT == 'production'
