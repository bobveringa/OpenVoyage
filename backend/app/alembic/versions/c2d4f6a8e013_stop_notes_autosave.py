"""Track who last saved each stop's notes, and when.

Adds ``itinerary_stops.notes_updated_at`` and ``notes_updated_by``, set by the
notes route. Existing notes get ``notes_updated_at`` from the stop's
``updated_at`` so the first save after the upgrade can spot a replaced change.
"""

from alembic import op
import sqlalchemy as sa

revision = 'c2d4f6a8e013'
down_revision = 'b1c3e5a7d902'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'itinerary_stops',
        sa.Column('notes_updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'itinerary_stops', sa.Column('notes_updated_by', sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        'fk_itinerary_stops_notes_updated_by',
        'itinerary_stops',
        'users',
        ['notes_updated_by'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        'ix_itinerary_stops_notes_updated_by', 'itinerary_stops', ['notes_updated_by']
    )
    op.execute(
        "UPDATE itinerary_stops SET notes_updated_at = updated_at WHERE notes <> ''"
    )


def downgrade() -> None:
    op.drop_index('ix_itinerary_stops_notes_updated_by', table_name='itinerary_stops')
    op.drop_constraint(
        'fk_itinerary_stops_notes_updated_by', 'itinerary_stops', type_='foreignkey'
    )
    op.drop_column('itinerary_stops', 'notes_updated_by')
    op.drop_column('itinerary_stops', 'notes_updated_at')
