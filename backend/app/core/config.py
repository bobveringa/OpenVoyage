import warnings
from pathlib import Path
from typing import Self, Annotated, Any, Literal

from pydantic import (
    model_validator,
    AnyUrl,
    BeforeValidator,
    PostgresDsn,
    computed_field,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]

# Key material derives encryption/signing keys directly, so anything shorter
# than this has less entropy than the primitives it feeds assume.
MINIMUM_KEY_MATERIAL_LENGTH = 32

# Values .env.example ships (and the ones earlier versions shipped). They are
# public, so a deployment still using one has no secret at all.
PUBLISHED_PLACEHOLDER_SECRETS = frozenset(
    {
        'changethis',
        'change-this-to-a-long-random-secret',
        'a-very-secret-key-change-this-in-production',
        'travelblog_password',
    }
)

# Catches placeholders this project never shipped but operators still invent.
PLACEHOLDER_MARKERS = ('changethis', 'change-this', 'change_this')


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith('['):
        return [i.strip() for i in v.split(',') if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file=PROJECT_ROOT / '.env',
        env_file_encoding='utf-8',
        env_ignore_empty=True,
        extra='ignore',
    )
    API_V1_STR: str = '/api/v1'
    # Defaults to the strict behaviour, so an operator who never sets it gets
    # the secret checks below rather than silently skipping them.
    ENVIRONMENT: Literal['local', 'staging', 'production'] = 'production'
    # Deliberately has no default. A generated-per-process default invalidates
    # every issued token on restart, and hands each uvicorn worker a different
    # signing key, which shows up as sporadic 401s rather than as a clear error.
    SECRET_KEY: str = ''
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    ID_TOKEN_EXPIRE_MINUTES: int = 15
    MEDIA_URL_TOKEN_EXPIRE_MINUTES: int = 60
    # 60 minutes * 24 hours * 30 days
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30
    JWT_ISSUER: str = 'openvoyage-backend'
    JWT_AUDIENCE: str = 'openvoyage-api'
    FRONTEND_DIST_DIRECTORY: str = ''

    MEDIA_DIRECTORY: str = ''
    GEONAMES_DOWNLOAD_BASE_URL: str = 'https://download.geonames.org/export/dump'
    APP_SETTINGS_ENCRYPTION_KEY: str | None = None

    @computed_field
    @property
    def media_root(self) -> str:
        # The  media root is based on the location of the .env file,
        # which is one level above the backend directory
        # We set media root as an absolute path
        media_directory = Path(self.MEDIA_DIRECTORY)
        if media_directory.is_absolute():
            return str(media_directory.resolve())
        return str((PROJECT_ROOT / media_directory).resolve())

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip('/') for origin in self.BACKEND_CORS_ORIGINS]

    POSTGRES_SERVER: str = ''
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = ''
    POSTGRES_PASSWORD: str = ''
    POSTGRES_DB: str = ''

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return PostgresDsn.build(
            scheme='postgresql+psycopg',
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    def _reject_weak_secret(self, var_name: str, reason: str) -> None:
        """Fail deployments over a weak secret; only warn during local work."""
        message = (
            f'{var_name} {reason}. Generate a unique value, for example with '
            '`python -c "import secrets; print(secrets.token_urlsafe(32))"`.'
        )
        if self.ENVIRONMENT == 'local':
            warnings.warn(message, stacklevel=1)
            return
        raise ValueError(message)

    def _check_secret(
        self, var_name: str, value: str | None, *, is_key_material: bool
    ) -> None:
        if value is None or value == '':
            # Only reached for optional secrets; required ones are checked
            # before this and always raise on an empty value.
            return

        if value in PUBLISHED_PLACEHOLDER_SECRETS:
            self._reject_weak_secret(var_name, 'is a published example value')
            return

        if any(marker in value.lower() for marker in PLACEHOLDER_MARKERS):
            self._reject_weak_secret(var_name, 'still looks like a placeholder')
            return

        if is_key_material and len(value) < MINIMUM_KEY_MATERIAL_LENGTH:
            self._reject_weak_secret(
                var_name,
                f'is shorter than {MINIMUM_KEY_MATERIAL_LENGTH} characters',
            )

    @model_validator(mode='after')
    def _enforce_non_default_secrets(self) -> Self:
        if not self.SECRET_KEY:
            raise ValueError(
                'SECRET_KEY must be set. Tokens are signed with it, so it has '
                'to stay identical across restarts and across every worker.'
            )

        self._check_secret('SECRET_KEY', self.SECRET_KEY, is_key_material=True)
        self._check_secret(
            'POSTGRES_PASSWORD', self.POSTGRES_PASSWORD, is_key_material=False
        )
        self._check_secret(
            'APP_SETTINGS_ENCRYPTION_KEY',
            self.APP_SETTINGS_ENCRYPTION_KEY,
            is_key_material=True,
        )

        return self


settings = Settings()
