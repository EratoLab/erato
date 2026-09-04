import os
from dataclasses import dataclass

# Keep this in sync with the frontend/local-auth oauth2-proxy configuration.
LOCAL_AUTH_REDIS_URL = "redis://localhost:6379"


@dataclass(frozen=True)
class Settings:
    redis_url: str = LOCAL_AUTH_REDIS_URL
    host: str = "127.0.0.1"
    port: int = 8000

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            redis_url=os.getenv("ERATO_CHAOS_REDIS_URL", cls.redis_url),
            host=os.getenv("ERATO_CHAOS_HOST", cls.host),
            port=int(os.getenv("ERATO_CHAOS_PORT", str(cls.port))),
        )
