import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, contains_eager

from models.database.user import User, UserProfile


class UserService:
    """Provides user lookup behavior for authenticated API workflows.

    Args:
        db: SQLAlchemy session used for user/profile queries.
    """

    def __init__(self, db: Session) -> None:
        """Initialize the service.

        Args:
            db: SQLAlchemy session used for database reads.
        """
        self.db = db

    def search_users(
        self,
        *,
        query: str,
        offset: int,
        limit: int,
        exclude_user_id: uuid.UUID | None = None,
    ) -> tuple[list[User], int]:
        """Search users by email/profile fields and return a page plus total.

        Args:
            query: Case-insensitive text matched against email and profile fields.
            offset: Number of matching rows to skip.
            limit: Maximum number of users to return.
            exclude_user_id: Optional user id to exclude from the results.

        Returns:
            A tuple containing the current page of users and total match count.
        """
        search_term = f'%{query}%'
        filters = [
            or_(
                User.email.ilike(search_term),
                UserProfile.username.ilike(search_term),
                UserProfile.first_name.ilike(search_term),
                UserProfile.last_name.ilike(search_term),
            )
        ]
        if exclude_user_id is not None:
            filters.append(User.id != exclude_user_id)

        total_statement = (
            select(func.count())
            .select_from(User)
            .outerjoin(UserProfile)
            .where(*filters)
        )
        statement = (
            select(User)
            .select_from(User)
            .outerjoin(UserProfile)
            .options(contains_eager(User.profile))
            .where(*filters)
            .order_by(User.email.asc(), User.id.asc())
            .offset(offset)
            .limit(limit)
        )

        total = self.db.execute(total_statement).scalar_one()
        users = list(self.db.execute(statement).scalars().all())

        return users, total
