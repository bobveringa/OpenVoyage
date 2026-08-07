from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from core.config import settings
from models.database.media import Media, MediaStorageBackend
from models.database.posts import PostMedia
from models.database.trips import Trip
from models.database.user import UserProfile

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MediaCleanupResult:
    deleted_files: int = 0
    deleted_media: int = 0
    failed_media: int = 0
    missing_files: int = 0
    scanned: int = 0


class MediaCleanupService:
    """Safely remove old, unreferenced files from local storage."""

    def __init__(self, db: Session) -> None:
        self.db = db

    def cleanup_orphans(
        self, *, cutoff: datetime, batch_size: int = 100
    ) -> MediaCleanupResult:
        totals = MediaCleanupResult()
        failed_ids = set()
        while True:
            statement = select(Media.id).where(
                Media.created_at < cutoff,
                ~exists(
                    select(UserProfile.user_id).where(
                        UserProfile.profile_picture_media_id == Media.id
                    )
                ),
                ~exists(select(Trip.id).where(Trip.cover_media_id == Media.id)),
                ~exists(select(PostMedia.id).where(PostMedia.media_id == Media.id)),
            )
            if failed_ids:
                statement = statement.where(Media.id.not_in(failed_ids))
            candidates = self.db.scalars(
                statement.order_by(Media.created_at).limit(batch_size)
            ).all()
            if not candidates:
                return totals
            for media_id in candidates:
                scanned = totals.scanned + 1
                try:
                    media = self.db.scalar(
                        select(Media).where(Media.id == media_id).with_for_update()
                    )
                    if media is None or not self._is_orphan(media, cutoff):
                        self.db.rollback()
                        totals = MediaCleanupResult(
                            **{**totals.__dict__, 'scanned': scanned}
                        )
                        continue
                    files, missing = self._remove_files(media)
                    self.db.delete(media)
                    self.db.commit()
                    totals = MediaCleanupResult(
                        deleted_files=totals.deleted_files + files,
                        deleted_media=totals.deleted_media + 1,
                        failed_media=totals.failed_media,
                        missing_files=totals.missing_files + missing,
                        scanned=scanned,
                    )
                except Exception:
                    self.db.rollback()
                    failed_ids.add(media_id)
                    logger.exception(
                        'media_cleanup_item_failed', extra={'media_id': str(media_id)}
                    )
                    totals = MediaCleanupResult(
                        **{
                            **totals.__dict__,
                            'failed_media': totals.failed_media + 1,
                            'scanned': scanned,
                        }
                    )

    def _is_orphan(self, media: Media, cutoff: datetime) -> bool:
        if media.created_at >= cutoff:
            return False
        return not any(
            (
                self.db.scalar(
                    select(
                        exists().where(UserProfile.profile_picture_media_id == media.id)
                    )
                ),
                self.db.scalar(select(exists().where(Trip.cover_media_id == media.id))),
                self.db.scalar(select(exists().where(PostMedia.media_id == media.id))),
            )
        )

    def _remove_files(self, media: Media) -> tuple[int, int]:
        if media.storage_backend != MediaStorageBackend.LOCAL:
            raise ValueError('Unsupported media storage backend')
        root = Path(settings.media_root).resolve()
        deleted = missing = 0
        for stored_path in filter(
            None, (media.storage_path, media.thumbnail_storage_path)
        ):
            path = Path(stored_path).resolve()
            if root != path and root not in path.parents:
                raise ValueError('Media path is outside media root')
            try:
                path.unlink()
                deleted += 1
            except FileNotFoundError:
                missing += 1
        return deleted, missing
