"""post social interactions

Revision ID: 4a9d2e7b1c53
Revises: 1b4d9e2a7c6f
Create Date: 2026-08-29 00:00:00.000000+00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4a9d2e7b1c53'
down_revision: Union[str, Sequence[str], None] = '1b4d9e2a7c6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('trip_share_links', sa.Column('display_name', sa.String(80)))
    op.add_column(
        'trip_share_links',
        sa.Column('display_name_locked', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'trip_share_links',
        sa.Column('interactions_enabled', sa.Boolean(), server_default=sa.text('true'), nullable=False),
    )
    op.create_table(
        'post_likes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('share_link_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], name='fk_post_likes_post_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_post_likes_user_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['share_link_id'], ['trip_share_links.id'], name='fk_post_likes_share_link_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('post_id', 'user_id', name='uq_post_likes_post_user'),
        sa.UniqueConstraint('post_id', 'share_link_id', name='uq_post_likes_post_link'),
        sa.CheckConstraint('(user_id IS NULL) <> (share_link_id IS NULL)', name='ck_post_likes_one_actor'),
    )
    op.create_index('ix_post_likes_post_id', 'post_likes', ['post_id'])
    op.create_table(
        'post_comments',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('post_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('share_link_id', sa.Uuid(), nullable=True),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], name='fk_post_comments_post_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_post_comments_user_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['share_link_id'], ['trip_share_links.id'], name='fk_post_comments_share_link_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.CheckConstraint('(user_id IS NULL) <> (share_link_id IS NULL)', name='ck_post_comments_one_actor'),
    )
    op.create_index('ix_post_comments_post_created_id', 'post_comments', ['post_id', 'created_at', 'id'])


def downgrade() -> None:
    op.drop_index('ix_post_comments_post_created_id', table_name='post_comments')
    op.drop_table('post_comments')
    op.drop_index('ix_post_likes_post_id', table_name='post_likes')
    op.drop_table('post_likes')
    op.drop_column('trip_share_links', 'interactions_enabled')
    op.drop_column('trip_share_links', 'display_name_locked')
    op.drop_column('trip_share_links', 'display_name')
