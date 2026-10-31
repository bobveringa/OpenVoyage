"""Cache successfully verified software releases by channel."""
from alembic import op
import sqlalchemy as sa

revision = 'b7d3a9e1f260'
down_revision = 'a6e8f0123457'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'software_release_cache',
        sa.Column('channel', sa.String(32), nullable=False),
        sa.Column('version', sa.String(100)),
        sa.Column('release_url', sa.String(2048)),
        sa.Column('published_at', sa.DateTime(timezone=True)),
        sa.Column('etag', sa.String(512)),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("trim(channel) <> ''", name='ck_software_release_cache_channel'),
        sa.CheckConstraint(
            '(version IS NULL AND release_url IS NULL AND published_at IS NULL) OR '
            '(version IS NOT NULL AND release_url IS NOT NULL AND published_at IS NOT NULL)',
            name='ck_software_release_cache_release',
        ),
        sa.PrimaryKeyConstraint('channel'),
    )


def downgrade() -> None:
    op.drop_table('software_release_cache')
