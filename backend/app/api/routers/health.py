from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from api.deps import SessionDep

router = APIRouter()


@router.get('/health', include_in_schema=False)
def health_check(session: SessionDep) -> dict[str, str]:
    """Report ready only when the API can reach PostgreSQL."""
    try:
        session.execute(text('SELECT 1'))
    except SQLAlchemyError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Database unavailable',
        ) from error
    return {'status': 'ok'}
