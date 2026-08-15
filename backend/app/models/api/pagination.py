import enum
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
T = TypeVar('T')


class SortDirection(str, enum.Enum):
    ASC = 'asc'
    DESC = 'desc'


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class CursorPaginatedResponse(BaseModel, Generic[T]):
    """A keyset-paginated page for append-heavy or frequently changing data."""

    items: list[T]
    next_cursor: str | None
