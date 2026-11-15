"""Place search names, Wikipedia titles and header photos.

- Enables ``pg_trgm`` (a trusted extension on Postgres 18, so no superuser).
- Adds ``places.search_names`` with one trigram index, filled here from the
  main name with the same normalise function the import and the search use.
  Other-language names arrive with the next place import.
- Adds ``places.wikipedia_title`` (filled by the next place import) and an
  index on ``places.latitude`` for the nearby-place lookups.
- Adds ``place_photos``.
"""

import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from app.models.search_names import build_search_names

revision = 'f5b7d9e1a346'
down_revision = 'd3e5a7c9f124'
branch_labels = None
depends_on = None

_BATCH = 10_000


def _fill_search_names() -> None:
    bind = op.get_bind()
    last_id = uuid.UUID(int=0)
    while True:
        rows = bind.execute(
            sa.text(
                'SELECT id, name FROM places WHERE id > :last ORDER BY id LIMIT :batch'
            ),
            {'last': last_id, 'batch': _BATCH},
        ).all()
        if not rows:
            return
        bind.execute(
            sa.text(
                'UPDATE places AS p SET search_names = v.search_names '
                'FROM (SELECT unnest(CAST(:ids AS uuid[])) AS id, '
                'unnest(CAST(:names AS text[])) AS search_names) AS v '
                'WHERE p.id = v.id'
            ),
            {
                'ids': [row.id for row in rows],
                'names': [build_search_names([row.name]) for row in rows],
            },
        )
        last_id = rows[-1].id


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
    op.add_column(
        'places',
        sa.Column('search_names', sa.Text(), nullable=False, server_default='||'),
    )
    op.add_column('places', sa.Column('wikipedia_title', sa.Text(), nullable=True))
    _fill_search_names()
    op.alter_column('places', 'search_names', server_default=None)
    op.create_index(
        'ix_places_search_names_trgm',
        'places',
        ['search_names'],
        postgresql_using='gin',
        postgresql_ops={'search_names': 'gin_trgm_ops'},
    )
    op.create_index('ix_places_latitude', 'places', ['latitude'])

    op.create_table(
        'place_photos',
        sa.Column('place_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('source_url', sa.Text(), nullable=True),
        sa.Column('credit', sa.String(255), nullable=True),
        sa.Column('license', sa.String(64), nullable=True),
        sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['place_id'], ['places.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('place_id'),
        sa.CheckConstraint(
            "status IN ('READY', 'NONE', 'FAILED')", name='ck_place_photos_status'
        ),
    )


def downgrade() -> None:
    op.drop_table('place_photos')
    op.drop_index('ix_places_latitude', table_name='places')
    op.drop_index('ix_places_search_names_trgm', table_name='places')
    op.drop_column('places', 'wikipedia_title')
    op.drop_column('places', 'search_names')
    # pg_trgm stays installed: dropping it could break other objects that use it.
