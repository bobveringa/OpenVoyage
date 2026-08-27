from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, TYPE_CHECKING

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, utcnow

if TYPE_CHECKING:
    from .user import User


class UserPreferences(Base):
    __tablename__ = 'user_preferences'
    __table_args__ = (
        CheckConstraint(
            "time_format IN ('12-hour', '24-hour')",
            name='ck_user_preferences_time_format',
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(
            'users.id',
            ondelete='CASCADE',
            name='fk_user_preferences_user_id',
        ),
        primary_key=True,
    )
    time_format: Mapped[str] = mapped_column(String(16), nullable=False)
    theme_palette: Mapped[dict[str, Any] | None] = mapped_column(
        JSONB(none_as_null=True),
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

    user: Mapped['User'] = relationship('User', back_populates='preferences')
