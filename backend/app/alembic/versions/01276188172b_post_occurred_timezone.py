"""Store the IANA time zone of where each post happened.

Adds ``posts.occurred_timezone`` and backfills it from each post's location
coordinates with timezonefinder, then makes it NOT NULL.

The lookup is a frozen copy of ``services.timezone_service.resolve_timezone``
as of this revision, so later changes to the app can't change or break this
backfill.
"""
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from alembic import op
import sqlalchemy as sa
from timezonefinder import TimezoneFinder

revision = '01276188172b'
down_revision = 'b7d3a9e1f260'
branch_labels = None
depends_on = None

BATCH_SIZE = 1000


def _fallback_timezone(longitude: float) -> str:
    # Nautical zone; the Etc sign is inverted on purpose (Etc/GMT-9 is UTC+9).
    offset_hours = max(-12, min(12, round(longitude / 15)))
    if offset_hours == 0:
        return 'Etc/GMT'
    return f'Etc/GMT{-offset_hours:+d}'


def _resolve_timezone(
    finder: TimezoneFinder, latitude: float, longitude: float
) -> str:
    zone = finder.timezone_at(lng=longitude, lat=latitude)
    if zone:
        try:
            ZoneInfo(zone)
        except ZoneInfoNotFoundError, ValueError:
            pass
        else:
            return zone
    return _fallback_timezone(longitude)


def upgrade() -> None:
    op.add_column(
        'posts',
        sa.Column('occurred_timezone', sa.String(64), nullable=True),
    )

    finder = TimezoneFinder()
    connection = op.get_bind()
    rows = connection.execute(
        sa.text(
            'SELECT posts.id, locations.latitude, locations.longitude '
            'FROM posts JOIN locations ON locations.id = posts.location_id'
        )
    ).all()
    posts = sa.table(
        'posts',
        sa.column('id', sa.Uuid()),
        sa.column('occurred_timezone', sa.String(64)),
    )
    statement = (
        posts.update()
        .where(posts.c.id == sa.bindparam('post_id'))
        .values(occurred_timezone=sa.bindparam('zone'))
    )
    values = [
        {'post_id': post_id, 'zone': _resolve_timezone(finder, latitude, longitude)}
        for post_id, latitude, longitude in rows
    ]
    for start in range(0, len(values), BATCH_SIZE):
        connection.execute(statement, values[start:start + BATCH_SIZE])

    op.alter_column('posts', 'occurred_timezone', nullable=False)


def downgrade() -> None:
    op.drop_column('posts', 'occurred_timezone')
