from pydantic import BaseModel


class TokenPayload(BaseModel):
    sub: str
    typ: str
    jti: str | None = None
    exp: int | None = None


class Token(BaseModel):
    id_token: str
    access_token: str
    refresh_token: str
    token_type: str = 'bearer'


class RefreshTokenRequest(BaseModel):
    refresh_token: str
