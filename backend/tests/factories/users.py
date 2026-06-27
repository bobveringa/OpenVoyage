from __future__ import annotations

import uuid

from core.security import get_password_hash
from models.database.user import User, UserProfile, UserRole
from sqlalchemy.orm import Session


def create_user(
    db_session: Session,
    *,
    email: str | None = None,
    password: str = 'password123',
    role: UserRole = UserRole.USER,
    username: str | None = None,
    first_name: str | None = None,
    last_name: str | None = None,
    slug: str | None = None,
) -> User:
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=(email or f'user-{uuid.uuid4().hex[:8]}@example.com').lower(),
        password_hash=get_password_hash(password),
        role=role.value,
    )
    db_session.add(user)
    if any([username, first_name, last_name, slug]):
        db_session.add(
            UserProfile(
                user_id=user_id,
                username=username or f'user-{user_id.hex[:8]}',
                first_name=first_name or 'Test',
                last_name=last_name or 'User',
                slug=slug or f'user-{user_id.hex[:8]}',
                profile_picture_media_id=None,
                biography='',
            )
        )
    db_session.commit()
    db_session.refresh(user)
    return user
