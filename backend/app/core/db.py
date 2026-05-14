from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from core.config import settings

_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
    return _engine
