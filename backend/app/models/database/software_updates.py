from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class SoftwareReleaseCache(Base):
    __tablename__ = 'software_release_cache'
    __table_args__ = (
        CheckConstraint("trim(channel) <> ''", name='ck_software_release_cache_channel'),
        CheckConstraint(
            '(version IS NULL AND release_url IS NULL AND published_at IS NULL) OR '
            '(version IS NOT NULL AND release_url IS NOT NULL AND published_at IS NOT NULL)',
            name='ck_software_release_cache_release',
        ),
    )

    channel: Mapped[str] = mapped_column(String(32), primary_key=True)
    version: Mapped[str | None] = mapped_column(String(100))
    release_url: Mapped[str | None] = mapped_column(String(2048))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    etag: Mapped[str | None] = mapped_column(String(512))
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
