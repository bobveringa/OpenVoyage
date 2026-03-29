from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()


class Item(BaseModel):
    name: str
    description: str | None = None
    price: float
    tax: float | None = None
    tags: list[str] = []


@app.get('/')
async def root():
    return {'message': 'Hello World'}


@app.get('/items/{item_id}')
def read_item(item: Item):
    return item
