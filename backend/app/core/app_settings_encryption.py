from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


class AppSettingsEncryptionError(RuntimeError):
    """Raised when a secret app setting cannot be encrypted or decrypted."""


class AppSettingsEncryption:
    envelope_version = 'v1'

    def __init__(self, key: str | None) -> None:
        self._key = key

    def encrypt(self, plaintext: str) -> str:
        fernet = self._fernet()
        token = fernet.encrypt(plaintext.encode('utf-8')).decode('ascii')
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
        if not self._key:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            )
        try:
            return Fernet(self._key.encode('ascii'))
        except (ValueError, UnicodeEncodeError) as exc:
            raise AppSettingsEncryptionError(
                'App settings encryption is not configured'
            ) from exc
