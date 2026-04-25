import uuid

from pydantic import BaseModel, Field


class Trips(BaseModel):
    trip_id: uuid.UUID = Field(alias='id')
    name: str
    description: str
