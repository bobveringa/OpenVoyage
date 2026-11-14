"""Add stays: where trip members sleep during a stop.

Stays belong to a stop and are deleted with it. Only trip members can see
them; route overviews for viewers never include them.
"""

from alembic import op
import sqlalchemy as sa

revision = 'd3e5a7c9f124'
down_revision = 'c2d4f6a8e013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'itinerary_stays',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('trip_id', sa.Uuid(), nullable=False),
        sa.Column('stop_id', sa.Uuid(), nullable=False),
        sa.Column('stay_type', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('location_id', sa.Uuid(), nullable=True),
        sa.Column('check_in_date', sa.Date(), nullable=False),
        sa.Column('check_out_date', sa.Date(), nullable=False),
        sa.Column('check_in_time', sa.Time(), nullable=True),
        sa.Column('check_out_time', sa.Time(), nullable=True),
        sa.Column('booking_reference', sa.String(length=255), nullable=True),
        sa.Column('booking_url', sa.Text(), nullable=True),
        sa.Column('contact_phone', sa.String(length=64), nullable=True),
        sa.Column('contact_email', sa.String(length=255), nullable=True),
        sa.Column('created_by', sa.Uuid(), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "stay_type IN ('HOTEL', 'RENTAL', 'HOSTEL', 'CAMPING', 'FRIENDS', "
            "'OVERNIGHT_TRAVEL', 'OTHER')",
            name='ck_itinerary_stays_stay_type',
        ),
        sa.CheckConstraint(
            "(stay_type IN ('FRIENDS', 'OVERNIGHT_TRAVEL')) = (status IS NULL)",
            name='ck_itinerary_stays_status_needs_booking',
        ),
        sa.CheckConstraint(
            "status IS NULL OR status IN ('IDEA', 'BOOKED')",
            name='ck_itinerary_stays_status',
        ),
        sa.CheckConstraint(
            'check_out_date > check_in_date', name='ck_itinerary_stays_dates'
        ),
        sa.ForeignKeyConstraint(
            ['trip_id'], ['trips.id'], name='fk_itinerary_stays_trip_id', ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['trip_id', 'stop_id'],
            ['itinerary_stops.trip_id', 'itinerary_stops.id'],
            name='fk_itinerary_stays_trip_stop_id',
            ondelete='CASCADE',
        ),
        sa.ForeignKeyConstraint(
            ['trip_id', 'location_id'],
            ['locations.trip_id', 'locations.id'],
            name='fk_itinerary_stays_trip_location_id',
        ),
        sa.ForeignKeyConstraint(
            ['created_by'], ['users.id'], name='fk_itinerary_stays_created_by', ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id', name='pk_itinerary_stays'),
    )
    op.create_index('ix_itinerary_stays_trip_stop_id', 'itinerary_stays', ['trip_id', 'stop_id'])
    op.create_index(
        'ix_itinerary_stays_trip_location_id', 'itinerary_stays', ['trip_id', 'location_id']
    )
    op.create_index('ix_itinerary_stays_created_by', 'itinerary_stays', ['created_by'])


def downgrade() -> None:
    op.drop_index('ix_itinerary_stays_created_by', table_name='itinerary_stays')
    op.drop_index('ix_itinerary_stays_trip_location_id', table_name='itinerary_stays')
    op.drop_index('ix_itinerary_stays_trip_stop_id', table_name='itinerary_stays')
    op.drop_table('itinerary_stays')
