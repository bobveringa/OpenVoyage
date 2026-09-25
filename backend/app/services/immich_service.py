from __future__ import annotations

import os
import tempfile
import uuid
from dataclasses import dataclass

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from core.app_settings import (
    IMMICH_ALLOWED_SERVERS_KEY,
    IMMICH_ALLOW_ANY_SERVER_KEY,
    IMMICH_ENABLED_KEY,
    MEDIA_MAX_UPLOAD_SIZE_MB_KEY,
)
from core.app_settings_encryption import AppSettingsEncryption
from core.config import settings
from models.database.immich import TripImmichAlbum, UserImmichConnection
from models.database.trips import TripMember, TripRole
from models.database.user import User
from services.app_settings_service import AppSettingsService
from services.immich_client import (
    ImmichAsset,
    ImmichAssetPage,
    ImmichClient,
    ImmichInvalidConnectionError,
    ImmichNotFoundError,
    ImmichUnavailableError,
    normalize_server_url,
    validate_server_policy,
)
from services.media_service import MediaService, MediaTooLargeError
from services.trip_access import get_membership


FEATURE_DISABLED_DETAIL = 'Immich integration is disabled'


class ImmichFeatureDisabledError(RuntimeError):
    pass


class ImmichConnectionMissingError(RuntimeError):
    pass


class ImmichConnectionConflictError(RuntimeError):
    pass


class ImmichAccessError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImmichAlbumLinkRecord:
    link: TripImmichAlbum
    connected_by: User
    name: str | None
    can_remove: bool


@dataclass(frozen=True)
class ImmichMediaResult:
    content: bytes
    content_type: str | None


class ImmichService:
    def __init__(
        self,
        db: Session,
        app_settings_service: AppSettingsService,
        media_service: MediaService | None = None,
    ) -> None:
        self.db = db
        self.app_settings_service = app_settings_service
        self.media_service = media_service
        self.encryption = AppSettingsEncryption(settings.SECRET_KEY)

    def get_connection(self, user_id: uuid.UUID) -> UserImmichConnection | None:
        self._require_enabled()
        return self.db.get(UserImmichConnection, user_id)

    def test_connection(self, user_id: uuid.UUID, server_url: str, api_key: str) -> None:
        self._require_enabled()
        normalized_url, candidate_key = self._resolve_candidate_key(
            user_id,
            server_url,
            api_key,
        )
        self._validate_candidate(normalized_url, candidate_key)

    def save_connection(
        self,
        user_id: uuid.UUID,
        server_url: str,
        api_key: str,
    ) -> UserImmichConnection:
        self._require_enabled()
        normalized_url, candidate_key = self._resolve_candidate_key(
            user_id,
            server_url,
            api_key,
        )
        identity = self._validate_candidate(normalized_url, candidate_key)
        existing = self.db.get(UserImmichConnection, user_id)
        if existing is not None and existing.immich_user_id != identity.user_id:
            raise ImmichConnectionConflictError(
                'Disconnect the existing Immich account before connecting another account'
            )

        encrypted_key = self.encryption.encrypt(candidate_key)
        if existing is None:
            connection = UserImmichConnection(
                user_id=user_id,
                server_url=normalized_url,
                immich_user_id=identity.user_id,
                api_key_encrypted=encrypted_key,
            )
            self.db.add(connection)
        else:
            connection = existing
            connection.server_url = normalized_url
            connection.api_key_encrypted = encrypted_key

        self.db.commit()
        self.db.refresh(connection)
        return connection

    def disconnect(self, user_id: uuid.UUID) -> None:
        self._require_enabled()
        connection = self.db.get(UserImmichConnection, user_id)
        if connection is not None:
            self.db.delete(connection)
            self.db.commit()

    def list_personal_albums(self, user_id: uuid.UUID) -> list[dict[str, object]]:
        self._require_enabled()
        connection = self._require_connection(user_id)
        return self._client_for_connection(connection).list_albums()

    def list_trip_albums(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> list[ImmichAlbumLinkRecord]:
        self._require_enabled()
        membership = self._require_membership(trip_id, current_user_id)
        links = self.db.execute(
            select(TripImmichAlbum)
            .options(
                joinedload(TripImmichAlbum.connection)
                .joinedload(UserImmichConnection.user)
                .joinedload(User.profile)
            )
            .where(TripImmichAlbum.trip_id == trip_id)
            .order_by(TripImmichAlbum.id)
        ).scalars()

        records: list[ImmichAlbumLinkRecord] = []
        for link in links:
            owner_membership = get_membership(
                self.db,
                trip_id=trip_id,
                user_id=link.connection_user_id,
            )
            if owner_membership is None:
                continue
            name: str | None = None
            try:
                album = self._client_for_connection(link.connection).get_album(
                    link.album_id
                )
                name = str(album['name'])
            except Exception:
                name = None
            records.append(
                ImmichAlbumLinkRecord(
                    link=link,
                    connected_by=link.connection.user,
                    name=name,
                    can_remove=(
                        membership.role == TripRole.OWNER
                        or link.connection_user_id == current_user_id
                    ),
                )
            )
        return records

    def connect_album(
        self,
        trip_id: uuid.UUID,
        current_user_id: uuid.UUID,
        album_id: uuid.UUID,
    ) -> tuple[ImmichAlbumLinkRecord, bool]:
        self._require_enabled()
        membership = self._require_membership(trip_id, current_user_id)
        connection = self._require_connection(current_user_id)
        album = self._client_for_connection(connection).get_album(album_id)
        existing = self.db.execute(
            select(TripImmichAlbum).where(
                TripImmichAlbum.trip_id == trip_id,
                TripImmichAlbum.connection_user_id == current_user_id,
                TripImmichAlbum.album_id == album_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return (
                ImmichAlbumLinkRecord(
                    link=existing,
                    connected_by=connection.user,
                    name=str(album['name']),
                    can_remove=True,
                ),
                False,
            )

        link = TripImmichAlbum(
            trip_id=trip_id,
            connection_user_id=current_user_id,
            album_id=album_id,
        )
        self.db.add(link)
        try:
            self.db.commit()
        except IntegrityError:
            self.db.rollback()
            link = self.db.execute(
                select(TripImmichAlbum).where(
                    TripImmichAlbum.trip_id == trip_id,
                    TripImmichAlbum.connection_user_id == current_user_id,
                    TripImmichAlbum.album_id == album_id,
                )
            ).scalar_one()
            created = False
        else:
            self.db.refresh(link)
            created = True
        return (
            ImmichAlbumLinkRecord(
                link=link,
                connected_by=connection.user,
                name=str(album['name']),
                can_remove=membership.role == TripRole.OWNER
                or current_user_id == link.connection_user_id,
            ),
            created,
        )

    def remove_album_link(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        self._require_enabled()
        membership = self._require_membership(trip_id, current_user_id)
        link = self._require_link(trip_id, link_id)
        if (
            membership.role != TripRole.OWNER
            and link.connection_user_id != current_user_id
        ):
            raise ImmichAccessError('You cannot remove this Immich album link')
        self.db.delete(link)
        self.db.commit()

    def list_assets(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        current_user_id: uuid.UUID,
        page: int,
        page_size: int,
    ) -> ImmichAssetPage:
        self._require_enabled()
        link, client = self._asset_context(trip_id, link_id, current_user_id)
        return client.search_assets(link.album_id, page=page, page_size=page_size)

    def get_asset_media(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        asset_id: uuid.UUID,
        current_user_id: uuid.UUID,
        *,
        display: bool,
    ) -> ImmichMediaResult:
        self._require_enabled()
        link, client = self._asset_context(trip_id, link_id, current_user_id)
        asset = client.get_asset(link.album_id, asset_id)
        if display and asset.media_type != 'IMAGE':
            raise ImmichNotFoundError('Display images are available for images only')
        size = 'preview' if display else 'thumbnail'
        try:
            content, content_type = client.get_media_bytes(asset_id, size=size)
        except ImmichNotFoundError as exc:
            raise ImmichUnavailableError(
                'Immich did not provide the requested generated image'
            ) from exc
        return ImmichMediaResult(content=content, content_type=content_type)

    def import_asset(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        asset_id: uuid.UUID,
        current_user: User,
    ):
        self._require_enabled()
        if self.media_service is None:
            raise RuntimeError('Media service is required for Immich imports')
        link, client = self._asset_context(trip_id, link_id, current_user.id)
        asset = client.get_asset(link.album_id, asset_id)
        media_size = self._import_media_size(asset)
        max_size = int(
            self.app_settings_service.get_value(MEDIA_MAX_UPLOAD_SIZE_MB_KEY)
        ) * 1_000_000
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False) as temporary_file:
                temporary_path = temporary_file.name
                bytes_written = 0
                try:
                    stream_context = client.open_media(
                        asset_id,
                        size=media_size,
                        timeout=300,
                    )
                except ImmichNotFoundError as exc:
                    if media_size == 'fullsize':
                        raise ImmichUnavailableError(
                            'Immich did not provide a compatible generated image'
                        ) from exc
                    raise
                with stream_context as stream:
                    while chunk := stream.read():
                        bytes_written += len(chunk)
                        if bytes_written > max_size:
                            raise MediaTooLargeError(
                                f'File size exceeds the maximum allowed size of {max_size} bytes'
                            )
                        temporary_file.write(chunk)

            self._recheck_import_access(
                trip_id,
                link_id,
                current_user.id,
            )
            with open(temporary_path, 'rb') as imported_file:
                upload = UploadFile(
                    file=imported_file,
                    filename='immich-import',
                    size=bytes_written,
                )
                return self.media_service.upload_media(upload, current_user)
        finally:
            if temporary_path is not None and os.path.exists(temporary_path):
                os.remove(temporary_path)

    def _resolve_candidate_key(
        self,
        user_id: uuid.UUID,
        server_url: str,
        api_key: str,
    ) -> tuple[str, str]:
        normalized_url = normalize_server_url(server_url)
        candidate_key = api_key.strip()
        if candidate_key:
            return normalized_url, candidate_key
        existing = self.db.get(UserImmichConnection, user_id)
        if existing is None or existing.server_url != normalized_url:
            raise ImmichInvalidConnectionError(
                'An API key is required for a new or different Immich server'
            )
        return normalized_url, self.encryption.decrypt(existing.api_key_encrypted)

    def _validate_candidate(self, server_url: str, api_key: str):
        client = self._client(server_url, api_key)
        return client.validate_connection()

    def _client_for_connection(self, connection: UserImmichConnection) -> ImmichClient:
        return self._client(
            connection.server_url,
            self.encryption.decrypt(connection.api_key_encrypted),
        )

    def _client(self, server_url: str, api_key: str) -> ImmichClient:
        allowed_servers = self.app_settings_service.get_value(
            IMMICH_ALLOWED_SERVERS_KEY
        )
        allow_any = self.app_settings_service.get_value(IMMICH_ALLOW_ANY_SERVER_KEY)
        server = validate_server_policy(server_url, allowed_servers, allow_any)
        return ImmichClient(server, api_key)

    def _asset_context(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> tuple[TripImmichAlbum, ImmichClient]:
        self._require_membership(trip_id, current_user_id)
        link = self._require_link(trip_id, link_id)
        if get_membership(
            self.db,
            trip_id=trip_id,
            user_id=link.connection_user_id,
        ) is None:
            raise ImmichNotFoundError('Immich album link is not accessible')
        connection = self.db.get(UserImmichConnection, link.connection_user_id)
        if connection is None:
            raise ImmichNotFoundError('Immich album link is not accessible')
        return link, self._client_for_connection(connection)

    def _recheck_import_access(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
        current_user_id: uuid.UUID,
    ) -> None:
        self.db.expire_all()
        self._require_enabled()
        self._require_membership(trip_id, current_user_id)
        link = self._require_link(trip_id, link_id)
        if get_membership(
            self.db,
            trip_id=trip_id,
            user_id=link.connection_user_id,
        ) is None:
            raise ImmichNotFoundError('Immich album link is not accessible')
        connection = self.db.get(UserImmichConnection, link.connection_user_id)
        if connection is None:
            raise ImmichNotFoundError('Immich album link is not accessible')
        self._client_for_connection(connection)

    def _require_enabled(self) -> None:
        if not self.app_settings_service.get_value(IMMICH_ENABLED_KEY):
            raise ImmichFeatureDisabledError(FEATURE_DISABLED_DETAIL)

    def _require_connection(self, user_id: uuid.UUID) -> UserImmichConnection:
        connection = self.db.get(UserImmichConnection, user_id)
        if connection is None:
            raise ImmichConnectionMissingError('Configure an Immich connection first')
        return connection

    def _require_membership(
        self,
        trip_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> TripMember:
        membership = get_membership(self.db, trip_id=trip_id, user_id=user_id)
        if membership is None:
            raise ImmichNotFoundError('Trip is not accessible')
        return membership

    def _require_link(
        self,
        trip_id: uuid.UUID,
        link_id: uuid.UUID,
    ) -> TripImmichAlbum:
        link = self.db.get(TripImmichAlbum, link_id)
        if link is None or link.trip_id != trip_id:
            raise ImmichNotFoundError('Immich album link is not accessible')
        return link

    @staticmethod
    def _import_media_size(asset: ImmichAsset) -> str:
        if asset.media_type == 'VIDEO':
            return 'original'
        if asset.original_mime_type in {'image/jpeg', 'image/png', 'image/webp'}:
            return 'original'
        return 'fullsize'


__all__ = [
    'FEATURE_DISABLED_DETAIL',
    'ImmichAccessError',
    'ImmichAlbumLinkRecord',
    'ImmichConnectionConflictError',
    'ImmichConnectionMissingError',
    'ImmichFeatureDisabledError',
    'ImmichMediaResult',
    'ImmichService',
]
