from typing import Literal

from pydantic import BaseModel, Field


class GeoJsonLineString(BaseModel):
    type: Literal['LineString'] = 'LineString'
    coordinates: list[tuple[float, float]] = Field(min_length=2)
