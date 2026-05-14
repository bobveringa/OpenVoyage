from __future__ import annotations

import uuid

from core.security import get_password_hash
from models.database.user import User, UserRole
from sqlalchemy.orm import Session


def create_user(
    db_session: Session,
    *,
    email: str | None = None,
    password: str = 'password123',
    role: UserRole = UserRole.USER,
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=(email or f'user-{uuid.uuid4().hex[:8]}@example.com').lower(),
        password_hash=get_password_hash(password),
        role=role.value,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user
