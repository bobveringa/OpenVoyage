import enum
import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from models.api.geojson import GeoJsonLineString
from models.api.locations import LocationInput, LocationResponse
from models.api.media import MediaResponse
from models.api.users import UserDisplaySummaryResponse
from models.database.travel import TravelMode
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


class PostCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(min_length=1)
    location: LocationInput
    occurred_at: datetime
    media_ids: list[uuid.UUID] = Field(min_length=1)
    bubble_media_id: uuid.UUID | None = None
    publish: bool = False


class PostUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    body: str | None = Field(default=None, min_length=1)
    location: LocationInput | None = None
    occurred_at: datetime | None = None
    media_ids: list[uuid.UUID] | None = None
    bubble_media_id: uuid.UUID | None = None


class PostSocialSummaryResponse(BaseModel):
    like_count: int = Field(ge=0)
    comment_count: int = Field(ge=0)
    viewer_has_liked: bool
    can_interact: bool
    can_like: bool


class PostResponse(BaseModel):
    id: uuid.UUID
    trip_id: uuid.UUID
    revision: int
    author: UserDisplaySummaryResponse
    location: LocationResponse
    title: str
    body: str
    occurred_at: datetime
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    media: list[MediaResponse]
    bubble_media_id: uuid.UUID
    social: PostSocialSummaryResponse

    @classmethod
    def from_model(
        cls,
        post: Post,
        media_base_url: str,
        *,
        media_token_factory: Callable[[uuid.UUID], str | None] | None = None,
        social: PostSocialSummaryResponse,
    ) -> Self:
        if post.bubble_media_id is None:
            raise ValueError(f'Post {post.id} has no selected bubble media')

        return cls(
            id=post.id,
            trip_id=post.trip_id,
            revision=post.revision,
            author=UserDisplaySummaryResponse.from_model(
                post.author,
                media_base_url=media_base_url,
                media_token=(
                    media_token_factory(post.author.profile.profile_picture.id)
                    if media_token_factory
                    and post.author.profile
                    and post.author.profile.profile_picture
                    else None
                ),
            ),
            location=LocationResponse.from_model(post.location),
            title=post.title,
            body=post.body,
            occurred_at=post.occurred_at,
            published_at=post.published_at,
            created_at=post.created_at,
            updated_at=post.updated_at,
            media=[
                MediaResponse.from_model(
                    link.media,
                    media_base_url=media_base_url,
                    media_token=(
                        media_token_factory(link.media.id)
                        if media_token_factory
                        else None
                    ),
                )
                for link in post.media_links
            ],
            bubble_media_id=post.bubble_media_id,
            social=social,
        )


class PostCommentCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')

    body: str | None = None
    parent_comment_id: uuid.UUID | None = None
    media_id: uuid.UUID | None = None

    @field_validator('body')
    @classmethod
    def normalize_body(cls, value: str | None) -> str:
        return value.strip() if value else ''

    @model_validator(mode='after')
    def require_content(self) -> Self:
        if len(self.body or '') > 2000:
            raise ValueError('body must be at most 2000 characters')
        if not self.body and self.media_id is None:
            raise ValueError('A comment requires text or an image')
        return self


class UserCommentAuthorResponse(BaseModel):
    type: Literal['user'] = 'user'
    user: UserDisplaySummaryResponse


class ShareLinkCommentAuthorResponse(BaseModel):
    type: Literal['share_link'] = 'share_link'
    display_name: str


PostCommentAuthorResponse = Annotated[
    UserCommentAuthorResponse | ShareLinkCommentAuthorResponse,
    Field(discriminator='type'),
]


class PostCommentResponse(BaseModel):
    id: uuid.UUID
    post_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    author: PostCommentAuthorResponse
    body: str
    media: MediaResponse | None
    replies: list['PostCommentResponse'] = Field(default_factory=list)
    reply_count: int = Field(ge=0)
    like_count: int = Field(ge=0)
    viewer_has_liked: bool
    created_at: datetime
    authored_by_viewer: bool
    can_delete: bool
    can_like: bool
    can_reply: bool


class PostCommentLikeSummaryResponse(BaseModel):
    comment_id: uuid.UUID
    like_count: int = Field(ge=0)
    viewer_has_liked: bool
    can_like: bool


class PostCommentDeleteResponse(BaseModel):
    deleted_comment_count: int = Field(ge=1)
    social: PostSocialSummaryResponse


class PostTimelineRouteSegmentResponse(BaseModel):
    travel_mode: TravelMode
    geometry: GeoJsonLineString
    visible_to_members_only: bool = False


class PostTimelineRouteResponse(BaseModel):
    duration_seconds: int | None = Field(ge=0)
    segments: list[PostTimelineRouteSegmentResponse] = Field(min_length=1)


class PostTimelineEntryResponse(BaseModel):
    post: PostResponse
    route_after: PostTimelineRouteResponse | None


class PostTimelineOpeningRouteResponse(BaseModel):
    """Geometry before the first visible post.

    It carries no ``duration_seconds`` because there is no preceding post to
    define a public timeline duration.
    """

    segments: list[PostTimelineRouteSegmentResponse] = Field(min_length=1)


class PostTimelineResponse(BaseModel):
    opening_route: PostTimelineOpeningRouteResponse | None
    entries: list[PostTimelineEntryResponse]
