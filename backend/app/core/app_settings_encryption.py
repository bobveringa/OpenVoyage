from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken


class AppSettingsEncryptionError(RuntimeError):
    """Raised when a secret app setting cannot be encrypted or decrypted."""


class AppSettingsEncryption:
    """Encrypt secret settings with a deterministic text-derived key."""

    envelope_version = 'v1'

    def __init__(self, key: str | None) -> None:
        self._key = key

    def encrypt(self, plaintext: str) -> str:
        try:
            token = self._fernet().encrypt(plaintext.encode('utf-8')).decode('ascii')
        except UnicodeEncodeError as exc:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            ) from exc
        return f'{self.envelope_version}:{token}'

    def decrypt(self, ciphertext: str) -> str:
        version, separator, token = ciphertext.partition(':')
        if separator != ':' or version != self.envelope_version or not token:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            )

        try:
            plaintext = self._fernet().decrypt(token.encode('ascii'))
            return plaintext.decode('utf-8')
        except (InvalidToken, UnicodeDecodeError, UnicodeEncodeError) as exc:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            ) from exc

    def _fernet(self) -> Fernet:
        derived_key = base64.urlsafe_b64encode(
            hashlib.sha256(self._key_bytes()).digest()
        )
        return Fernet(derived_key)

    def _key_bytes(self) -> bytes:
        if self._key is None or self._key == '':
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            )
        try:
            return self._key.encode('utf-8')
        except UnicodeEncodeError as exc:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            ) from exc
