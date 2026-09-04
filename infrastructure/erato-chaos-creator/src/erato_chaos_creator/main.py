from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from redis.asyncio import Redis
from redis.exceptions import RedisError

from .config import Settings
from .redis_actions import purge_oauth2_proxy_session, redis_key_from_oauth2_proxy_cookie


class PurgeSessionRequest(BaseModel):
    session_key: str = Field(min_length=1, description="Exact oauth2-proxy Redis session key")


class PurgeSessionResponse(BaseModel):
    session_key: str
    deleted: bool


class PurgeCookieRequest(BaseModel):
    cookie: str = Field(min_length=1, description="Complete oauth2-proxy cookie or ticket value")


class PurgeCookieResponse(PurgeSessionResponse):
    pass


def create_app(settings: Settings | None = None, redis: Redis | None = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    redis = redis or Redis.from_url(resolved_settings.redis_url, decode_responses=False)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        await redis.aclose()

    app = FastAPI(
        title="Erato Chaos Creator",
        description="Controlled failure-injection actions for development and test environments.",
        version="0.1.0",
        lifespan=lifespan,
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "erato-chaos-creator"}

    @app.post("/actions/oauth2-proxy/purge-session", response_model=PurgeSessionResponse)
    async def purge_session(payload: PurgeSessionRequest) -> PurgeSessionResponse:
        try:
            result = await purge_oauth2_proxy_session(redis, payload.session_key)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except RedisError as error:
            raise HTTPException(status_code=503, detail="Redis is unavailable") from error
        return PurgeSessionResponse(session_key=result.key, deleted=result.deleted)

    @app.post("/actions/oauth2-proxy/purge-cookie", response_model=PurgeCookieResponse)
    async def purge_cookie(payload: PurgeCookieRequest) -> PurgeCookieResponse:
        try:
            session_key = redis_key_from_oauth2_proxy_cookie(payload.cookie)
            result = await purge_oauth2_proxy_session(redis, session_key)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except RedisError as error:
            raise HTTPException(status_code=503, detail="Redis is unavailable") from error
        return PurgeCookieResponse(session_key=result.key, deleted=result.deleted)

    return app


app = create_app()
