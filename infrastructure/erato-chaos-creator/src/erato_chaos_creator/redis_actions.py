import base64
import re
from dataclasses import dataclass
from http.cookies import SimpleCookie
from typing import Protocol


class RedisKeyStore(Protocol):
    async def delete(self, *keys: str) -> int: ...


@dataclass(frozen=True)
class PurgeResult:
    key: str
    deleted: bool


def redis_key_from_oauth2_proxy_cookie(cookie: str) -> str:
    """Extract oauth2-proxy's Redis key from a cookie header or cookie value."""
    raw_cookie = cookie.strip()
    if raw_cookie.lower().startswith("cookie:"):
        raw_cookie = raw_cookie[7:].strip()

    # A Redis-backed oauth2-proxy cookie is usually wrapped as
    # base64(ticket)|timestamp|signature. Try the raw value first so the
    # padding `=` characters are not mistaken for a cookie name.
    try:
        return _redis_key_from_ticket_value(raw_cookie.split(";", 1)[0].strip())
    except ValueError:
        pass

    # Accept the complete `name=value` form copied from browser tooling.
    if "=" in raw_cookie:
        parsed = SimpleCookie()
        parsed.load(raw_cookie)
        if not parsed:
            raise ValueError("cookie is not a valid cookie")
        session_cookie = next(iter(parsed.values()))
        return _redis_key_from_ticket_value(session_cookie.value)
    else:
        raise ValueError("cookie is not a valid oauth2-proxy ticket")


def _redis_key_from_ticket_value(value: str) -> str:
    if "|" in value:
        encoded_ticket = value.split("|", 1)[0]
        try:
            value = base64.b64decode(encoded_ticket, validate=True).decode("ascii")
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("cookie contains an invalid encoded ticket") from error

    ticket_parts = value.split(".")
    if len(ticket_parts) == 3 and ticket_parts[0] == "v2":
        try:
            key = base64.urlsafe_b64decode(ticket_parts[1] + "===").decode("ascii")
        except (ValueError, UnicodeDecodeError) as error:
            raise ValueError("cookie contains an invalid ticket key") from error
        secret = ticket_parts[2]
    elif len(ticket_parts) == 2:
        key, secret = ticket_parts
    else:
        raise ValueError("cookie must contain an oauth2-proxy ticket")

    if not re.fullmatch(r"[A-Za-z0-9_-]+", key):
        raise ValueError("cookie contains an invalid oauth2-proxy ticket key")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", secret):
        raise ValueError("cookie contains an invalid oauth2-proxy ticket secret")
    return key


async def purge_oauth2_proxy_session(redis: RedisKeyStore, session_key: str) -> PurgeResult:
    """Delete exactly one oauth2-proxy session key.

    The key is intentionally passed straight to Redis. No pattern matching or
    key scanning is performed, so a typo cannot purge multiple sessions.
    """
    normalized_key = session_key.strip()
    if not normalized_key:
        raise ValueError("session_key must not be empty")
    if "*" in normalized_key or "?" in normalized_key:
        raise ValueError("session_key must be an exact Redis key")

    deleted = await redis.delete(normalized_key)
    return PurgeResult(key=normalized_key, deleted=bool(deleted))
