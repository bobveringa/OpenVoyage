"""comment replies, likes, and media

Revision ID: 8b2c7d4e9f10
Revises: 7a9d3e5f1b2c
Create Date: 2026-09-19 00:00:00.000000+00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8b2c7d4e9f10'
down_revision: Union[str, Sequence[str], None] = '7a9d3e5f1b2c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('post_comments', sa.Column('parent_comment_id', sa.Uuid(), nullable=True))
    op.add_column('post_comments', sa.Column('media_id', sa.Uuid(), nullable=True))
    op.add_column('post_comments', sa.Column('depth', sa.Integer(), server_default='0', nullable=False))
    op.create_foreign_key(
        'fk_post_comments_parent_comment_id', 'post_comments', 'post_comments',
        ['parent_comment_id'], ['id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_post_comments_media_id', 'post_comments', 'media',
        ['media_id'], ['id'], ondelete='RESTRICT',
    )
    op.create_check_constraint('ck_post_comments_depth_non_negative', 'post_comments', 'depth >= 0')
    op.create_index(
        'ix_post_comments_post_parent_created_id', 'post_comments',
        ['post_id', 'parent_comment_id', 'created_at', 'id'],
    )
    op.create_table(
        'post_comment_likes',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('comment_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('share_link_id', sa.Uuid(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['comment_id'], ['post_comments.id'], name='fk_post_comment_likes_comment_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], name='fk_post_comment_likes_user_id', ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['share_link_id'], ['trip_share_links.id'], name='fk_post_comment_likes_share_link_id', ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('comment_id', 'user_id', name='uq_post_comment_likes_comment_user'),
        sa.UniqueConstraint('comment_id', 'share_link_id', name='uq_post_comment_likes_comment_link'),
        sa.CheckConstraint('(user_id IS NULL) <> (share_link_id IS NULL)', name='ck_post_comment_likes_one_actor'),
    )
    op.create_index('ix_post_comment_likes_comment_id', 'post_comment_likes', ['comment_id'])


def downgrade() -> None:
    op.drop_index('ix_post_comment_likes_comment_id', table_name='post_comment_likes')
    op.drop_table('post_comment_likes')
    op.drop_index('ix_post_comments_post_parent_created_id', table_name='post_comments')
    op.drop_constraint('ck_post_comments_depth_non_negative', 'post_comments', type_='check')
    op.drop_constraint('fk_post_comments_media_id', 'post_comments', type_='foreignkey')
    op.drop_constraint('fk_post_comments_parent_comment_id', 'post_comments', type_='foreignkey')
    op.drop_column('post_comments', 'depth')
    op.drop_column('post_comments', 'media_id')
    op.drop_column('post_comments', 'parent_comment_id')
