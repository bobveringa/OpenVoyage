import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from core.config import settings

password_hash = PasswordHash(
    hashers=[
        Argon2Hasher(),
    ],
)

ALGORITHM = 'HS256'
TOKEN_TYPE_ACCESS = 'access'
TOKEN_TYPE_ID = 'id'
TOKEN_TYPE_REFRESH = 'refresh'


def create_token(
    subject: str | Any,
    token_type: str,
    expires_delta: timedelta,
    extra_claims: dict[str, Any] | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + expires_delta
    to_encode = {
        'iat': now,
        'exp': expire,
        'iss': settings.JWT_ISSUER,
        'aud': settings.JWT_AUDIENCE,
        'jti': str(uuid.uuid4()),
        'sub': str(subject),
        'typ': token_type,
    }
    if extra_claims:
        to_encode.update(extra_claims)

    encoded_jwt = jwt.encode(
        payload=to_encode,
        key=settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    return encoded_jwt


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    payload = jwt.decode(
        token,
        settings.SECRET_KEY,
        algorithms=[ALGORITHM],
        audience=settings.JWT_AUDIENCE,
        issuer=settings.JWT_ISSUER,
    )
    token_type = payload.get('typ')
    if token_type != expected_type:
        raise InvalidTokenError('Unexpected token type')
    return payload


def create_auth_tokens(subject: str | Any, email: str) -> dict[str, str]:
    access_token = create_token(
        subject=subject,
        token_type=TOKEN_TYPE_ACCESS,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    id_token = create_token(
        subject=subject,
        token_type=TOKEN_TYPE_ID,
        expires_delta=timedelta(minutes=settings.ID_TOKEN_EXPIRE_MINUTES),
        extra_claims={'email': email},
    )
    refresh_token = create_token(
        subject=subject,
        token_type=TOKEN_TYPE_REFRESH,
        expires_delta=timedelta(minutes=settings.REFRESH_TOKEN_EXPIRE_MINUTES),
    )
    return {
        'access_token': access_token,
        'id_token': id_token,
        'refresh_token': refresh_token,
    }


def verify_password(
    plain_password: str, hashed_password: str
) -> tuple[bool, str | None]:
    return password_hash.verify_and_update(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)
