from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, utcnow


class AppSetting(Base):
    __tablename__ = 'app_settings'
    __table_args__ = (
        CheckConstraint(
            '((value IS NOT NULL AND secret_value IS NULL) OR '
            '(value IS NULL AND secret_value IS NOT NULL))',
            name='ck_app_settings_exactly_one_payload',
        ),
        CheckConstraint(
            "value IS NULL OR value <> 'null'::jsonb",
            name='ck_app_settings_value_not_json_null',
        ),
    )

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[Any | None] = mapped_column(
        JSONB(none_as_null=True),
        nullable=True,
    )
    secret_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='SET NULL',
            name='fk_app_settings_updated_by',
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utcnow,
        onupdate=utcnow,
        server_default=func.now(),
    )
