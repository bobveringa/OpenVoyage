"""add Immich connections and trip albums

Revision ID: 2f6b8a1c4d90
Revises: 8b2c7d4e9f10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '2f6b8a1c4d90'
down_revision: Union[str, Sequence[str], None] = '8b2c7d4e9f10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_immich_connections',
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('server_url', sa.String(length=2048), nullable=False),
        sa.Column('immich_user_id', sa.Uuid(), nullable=False),
        sa.Column('api_key_encrypted', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('user_id'),
    )
    op.create_table(
        'trip_immich_albums',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('connection_user_id', sa.Uuid(), nullable=False),
        sa.Column('album_id', sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(['trip_id'], ['trips.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['connection_user_id'],
            ['user_immich_connections.user_id'],
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'trip_id',
            'connection_user_id',
            'album_id',
            name='uq_trip_immich_albums_trip_connection_album',
        ),
    )
    op.create_index(
        'ix_trip_immich_albums_connection_user_id',
        'trip_immich_albums',
        ['connection_user_id'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_trip_immich_albums_connection_user_id',
        table_name='trip_immich_albums',
    )
    op.drop_table('trip_immich_albums')
    op.drop_table('user_immich_connections')
