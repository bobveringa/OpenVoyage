"""Keep trip content when the user who created it is deleted.

Posts, itinerary stops, locations, trip viewer grants and share links belong
to their trip, not to whoever created them. Their creator columns become
nullable with ``ON DELETE SET NULL`` so deleting an account no longer fails on
these foreign keys; a null creator is shown as a deleted user.

Downgrading fails while any of these rows has a null creator.
"""

from alembic import op
import sqlalchemy as sa

revision = '5e7a9c1b3d24'
down_revision = '01276188172b'
branch_labels = None
depends_on = None

# (table, column, constraint name)
CREATOR_FOREIGN_KEYS = (
    ('posts', 'author_user_id', 'fk_posts_author_user_id'),
    ('itinerary_stops', 'created_by', 'fk_itinerary_stops_created_by'),
    ('locations', 'created_by', 'fk_locations_created_by'),
    ('trip_viewers', 'created_by', 'fk_trip_viewers_created_by'),
    ('trip_share_links', 'created_by', 'fk_trip_share_links_created_by'),
)


def _replace_foreign_keys(*, nullable: bool, ondelete: str | None) -> None:
    for table, column, constraint in CREATOR_FOREIGN_KEYS:
        op.drop_constraint(constraint, table, type_='foreignkey')
        op.alter_column(
            table, column, existing_type=sa.Uuid(), nullable=nullable
        )
        op.create_foreign_key(
            constraint,
            table,
            'users',
            [column],
            ['id'],
            ondelete=ondelete,
        )


def upgrade() -> None:
    _replace_foreign_keys(nullable=True, ondelete='SET NULL')


def downgrade() -> None:
    _replace_foreign_keys(nullable=False, ondelete=None)
