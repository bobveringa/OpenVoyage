import secrets
from pathlib import Path
from typing import Self, Annotated, Any

from pydantic import (
    model_validator,
    AnyUrl,
    BeforeValidator,
    PostgresDsn,
    computed_field,
    ByteSize,
)
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[3]


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
        env_ignore_empty=True,
        extra='ignore',
    )
    API_V1_STR: str = '/api/v1'
    SECRET_KEY: str = secrets.token_urlsafe(32)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    ID_TOKEN_EXPIRE_MINUTES: int = 15
    # 60 minutes * 24 hours * 30 days
    REFRESH_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 30
    JWT_ISSUER: str = 'openvoyage-backend'
    JWT_AUDIENCE: str = 'openvoyage-api'
    FRONTEND_HOST: str = ''

    MAX_MEDIA_SIZE: ByteSize = '512MB'

    MEDIA_DIRECTORY: str = ''

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
        origins = [
            str(origin).rstrip('/') for origin in self.BACKEND_CORS_ORIGINS
        ] + [self.FRONTEND_HOST]
        return [origin for origin in origins if origin]

    POSTGRES_SERVER: str = ''
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = ''
    POSTGRES_PASSWORD: str = ''
    POSTGRES_DB: str = ''

    @computed_field
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return PostgresDsn.build(
            scheme='postgresql+pg8000',
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == 'changethis':
            message = (
                f'The value of {var_name} is "changethis", '
                'for security, please change it, at least for deployments.'
            )
            raise ValueError(message)

    @model_validator(mode='after')
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret('SECRET_KEY', self.SECRET_KEY)
        self._check_default_secret('POSTGRES_PASSWORD', self.POSTGRES_PASSWORD)

        return self


settings = Settings()
