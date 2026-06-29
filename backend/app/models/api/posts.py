import enum
import uuid
from datetime import datetime
from typing import Self, TypeAlias

from pydantic import BaseModel, ConfigDict, Field

from models.api.media import MediaResponse
from models.api.users import UserSummaryResponse
from models.database.locations import Location
from models.database.posts import Post


class PostSortField(str, enum.Enum):
    OCCURRED_AT = 'occurred_at'
    PUBLISHED_AT = 'published_at'
    CREATED_AT = 'created_at'
    UPDATED_AT = 'updated_at'


class PostStatusFilter(str, enum.Enum):
    PUBLISHED = 'published'
    DRAFT = 'draft'
    ALL = 'all'


class PostPlaceLocationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    place_id: uuid.UUID


class PostCoordinatesLocationInput(BaseModel):
    model_config = ConfigDict(extra='forbid')

    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


PostLocationInput: TypeAlias = PostPlaceLocationInput | PostCoordinatesLocationInput


class PostCreateRequest(BaseModel):
    body: str = Field(min_length=1)
    location: PostLocationInput
    occurred_at: datetime
    media_ids: list[uuid.UUID] = Field(default_factory=list)
    publish: bool = False


class PostUpdateRequest(BaseModel):
    body: str | None = Field(default=None, min_length=1)
    location: PostLocationInput | None = None
    occurred_at: datetime | None = None
    media_ids: list[uuid.UUID] | None = None


class LocationResponse(BaseModel):
    id: uuid.UUID
    name: str
    latitude: float
    longitude: float
    country_code: str
    region: str
    full_name: str

    @classmethod
    def from_model(cls, location: Location) -> Self:
        return cls(
            id=location.id,
            name=location.name,
            latitude=location.latitude,
            longitude=location.longitude,
            country_code=location.country_code,
            region=location.region,
            full_name=location.full_name,
        )


class PostResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    author: UserSummaryResponse
    location: LocationResponse
    body: str
    occurred_at: datetime
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    media: list[MediaResponse]

    @classmethod
    def from_model(cls, post: Post, media_base_url: str) -> Self:
        return cls(
            id=post.id,
            trip_id=post.trip_id,
            author=UserSummaryResponse.from_model(post.author),
            location=LocationResponse.from_model(post.location),
            body=post.body,
            occurred_at=post.occurred_at,
            published_at=post.published_at,
            created_at=post.created_at,
            updated_at=post.updated_at,
            media=[
                MediaResponse.from_model(link.media, media_base_url=media_base_url)
                for link in post.media_links
            ],
        )
