"""Run after upgrading: import GeoNames airports and backfill time zones on existing places."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'app'))

from sqlalchemy.orm import Session
from core.db import get_engine
from services.place_service import PlaceService


if __name__ == '__main__':
    with Session(get_engine()) as db:
        print(PlaceService(db).import_airport_reference_data())
