"""trip viewers and share links

Revision ID: f18c2a7d9b31
Revises: 7c1f9a3d2b4e
Create Date: 2026-07-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f18c2a7d9b31'
down_revision: Union[str, Sequence[str], None] = '7c1f9a3d2b4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'trip_viewers',
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['created_by'],
            ['users.id'],
            name='fk_trip_viewers_created_by',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id'],
            ['trips.id'],
            name='fk_trip_viewers_trip_id',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['user_id'],
            ['users.id'],
            name='fk_trip_viewers_user_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('trip_id', 'user_id'),
    )

    op.execute(
        sa.text(
            """
            INSERT INTO trip_viewers (trip_id, user_id, created_by, created_at)
            SELECT
                viewer.trip_id,
                viewer.user_id,
                COALESCE(
                    (
                        SELECT owner.user_id
                        FROM trip_members owner
                        WHERE owner.trip_id = viewer.trip_id
                          AND owner.role = 'OWNER'
                        ORDER BY owner.user_id
                        LIMIT 1
                    ),
                    viewer.user_id
                ) AS created_by,
                now() AS created_at
            FROM trip_members viewer
            WHERE viewer.role = 'VIEWER'
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.execute(sa.text("DELETE FROM trip_members WHERE role = 'VIEWER'"))

    op.create_table(
        'trip_share_links',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('token_hash', sa.String(length=64), nullable=False),
        sa.Column('created_by', sa.Uuid(), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ['created_by'],
            ['users.id'],
            name='fk_trip_share_links_created_by',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id'],
            ['trips.id'],
            name='fk_trip_share_links_trip_id',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_trip_share_links_token_hash',
        'trip_share_links',
        ['token_hash'],
        unique=True,
    )
    op.create_index(
        'ix_trip_share_links_trip_id',
        'trip_share_links',
        ['trip_id'],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        sa.text(
            """
            INSERT INTO trip_members (trip_id, user_id, role)
            SELECT trip_id, user_id, 'VIEWER'
            FROM trip_viewers
            ON CONFLICT DO NOTHING
            """
        )
    )
    op.drop_index('ix_trip_share_links_trip_id', table_name='trip_share_links')
    op.drop_index('ix_trip_share_links_token_hash', table_name='trip_share_links')
    op.drop_table('trip_share_links')
    op.drop_table('trip_viewers')
