"""add selected map bubble media to posts

Revision ID: 7a9d3e5f1b2c
Revises: 3d7e9c2a1f45
Create Date: 2026-09-18 00:00:00.000000+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7a9d3e5f1b2c'
down_revision: Union[str, Sequence[str], None] = '3d7e9c2a1f45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    connection = op.get_bind()
    empty_post_ids = (
        connection.execute(
            sa.text(
                """
                SELECT posts.id
                FROM posts
                LEFT JOIN post_media ON post_media.post_id = posts.id
                GROUP BY posts.id
                HAVING COUNT(post_media.id) = 0
                """
            )
        )
        .scalars()
        .all()
    )
    if empty_post_ids:
        post_ids = ', '.join(str(post_id) for post_id in empty_post_ids)
        raise RuntimeError(
            'Posts require at least one media item before the bubble-media '
            f'migration: {post_ids}'
        )

    op.add_column('posts', sa.Column('bubble_media_id', sa.UUID(), nullable=True))
    op.execute(
        """
        WITH ranked_post_media AS (
            SELECT
                post_media.post_id,
                post_media.media_id,
                ROW_NUMBER() OVER (
                    PARTITION BY post_media.post_id
                    ORDER BY
                        CASE WHEN media.media_type = 'IMAGE' THEN 0 ELSE 1 END,
                        post_media.sort_order ASC,
                        post_media.id ASC
                ) AS row_number
            FROM post_media
            JOIN media ON media.id = post_media.media_id
        )
        UPDATE posts
        SET bubble_media_id = ranked_post_media.media_id
        FROM ranked_post_media
        WHERE posts.id = ranked_post_media.post_id
          AND ranked_post_media.row_number = 1
        """
    )
    op.alter_column('posts', 'bubble_media_id', nullable=False)
    op.create_foreign_key(
        'fk_posts_bubble_media',
        'posts',
        'post_media',
        ['id', 'bubble_media_id'],
        ['post_id', 'media_id'],
        deferrable=True,
        initially='DEFERRED',
    )


def downgrade() -> None:
    op.drop_constraint('fk_posts_bubble_media', 'posts', type_='foreignkey')
    op.drop_column('posts', 'bubble_media_id')
