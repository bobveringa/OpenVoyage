from __future__ import annotations

from datetime import timedelta

import pytest
from jwt import InvalidTokenError

from core.security import (
    TOKEN_TYPE_ACCESS,
    TOKEN_TYPE_ID,
    TOKEN_TYPE_REFRESH,
    create_auth_tokens,
    create_token,
    decode_token,
    get_password_hash,
    verify_password,
)


@pytest.mark.unit
def test_create_token_round_trip_with_extra_claims() -> None:
    token = create_token(
        subject="user-123",
        token_type=TOKEN_TYPE_ID,
        expires_delta=timedelta(minutes=10),
        extra_claims={"email": "user@example.com", "role": "admin"},
    )

    payload = decode_token(token, expected_type=TOKEN_TYPE_ID)

    assert payload["sub"] == "user-123"
    assert payload["typ"] == TOKEN_TYPE_ID
    assert payload["email"] == "user@example.com"
    assert payload["role"] == "admin"
    assert payload["jti"]
    assert payload["exp"] > payload["iat"]


@pytest.mark.unit
def test_decode_token_raises_for_unexpected_type() -> None:
    token = create_token(
        subject="user-123",
        token_type=TOKEN_TYPE_ACCESS,
        expires_delta=timedelta(minutes=5),
    )

    with pytest.raises(InvalidTokenError, match="Unexpected token type"):
        decode_token(token, expected_type=TOKEN_TYPE_REFRESH)


@pytest.mark.unit
def test_create_auth_tokens_creates_expected_token_types() -> None:
    tokens = create_auth_tokens(subject="user-abc", email="abc@example.com")

    assert set(tokens) == {"access_token", "id_token", "refresh_token"}

    access_payload = decode_token(tokens["access_token"], expected_type=TOKEN_TYPE_ACCESS)
    id_payload = decode_token(tokens["id_token"], expected_type=TOKEN_TYPE_ID)
    refresh_payload = decode_token(
        tokens["refresh_token"], expected_type=TOKEN_TYPE_REFRESH
    )

    assert access_payload["sub"] == "user-abc"
    assert id_payload["sub"] == "user-abc"
    assert id_payload["email"] == "abc@example.com"
    assert refresh_payload["sub"] == "user-abc"


@pytest.mark.unit
def test_password_hash_and_verify_success() -> None:
    plain_password = "S3curePass!"

    hashed_password = get_password_hash(plain_password)

    is_valid, updated_hash = verify_password(plain_password, hashed_password)

    assert hashed_password != plain_password
    assert is_valid is True
    assert updated_hash is None or isinstance(updated_hash, str)


@pytest.mark.unit
def test_password_hash_and_verify_rejects_wrong_password() -> None:
    hashed_password = get_password_hash("Correct#123")

    is_valid, _ = verify_password("Wrong#123", hashed_password)

    assert is_valid is False

