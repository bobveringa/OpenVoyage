from typing import Literal

from pydantic import BaseModel


class GeoJsonLineString(BaseModel):
    type: Literal['LineString'] = 'LineString'
    coordinates: list[tuple[float, float]]
