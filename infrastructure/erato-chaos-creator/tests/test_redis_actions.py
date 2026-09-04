import pytest

from erato_chaos_creator.redis_actions import (
    purge_oauth2_proxy_session,
    redis_key_from_oauth2_proxy_cookie,
)


class FakeRedis:
    def __init__(self, deleted: int = 1):
        self.deleted = deleted
        self.keys: list[str] = []

    async def delete(self, *keys: str) -> int:
        self.keys.extend(keys)
        return self.deleted


@pytest.mark.parametrize("session_key", ["", "   ", "session:*"])
async def test_purge_rejects_non_exact_keys(session_key: str):
    with pytest.raises(ValueError):
        await purge_oauth2_proxy_session(FakeRedis(), session_key)


async def test_purge_deletes_only_the_requested_key():
    redis = FakeRedis()
    result = await purge_oauth2_proxy_session(redis, "  session:oauth2-proxy-abc  ")

    assert result.key == "session:oauth2-proxy-abc"
    assert result.deleted is True
    assert redis.keys == ["session:oauth2-proxy-abc"]


async def test_purge_reports_missing_key():
    result = await purge_oauth2_proxy_session(FakeRedis(deleted=0), "session:missing")

    assert result.deleted is False


@pytest.mark.parametrize(
    ("cookie", "expected"),
    [
        ("_oauth2_proxy-0123456789abcdef0123456789abcdef.ABC_def-123", "_oauth2_proxy-0123456789abcdef0123456789abcdef"),
        ("_oauth2_proxy=_oauth2_proxy-0123456789abcdef0123456789abcdef.ABC_def-123", "_oauth2_proxy-0123456789abcdef0123456789abcdef"),
        ("Cookie: _oauth2_proxy=_oauth2_proxy-0123456789abcdef0123456789abcdef.ABC_def-123; Path=/", "_oauth2_proxy-0123456789abcdef0123456789abcdef"),
        ("djIuWDI5aGRYUm9NbDl3Y205NGVTMHpOakl5TlRneU9ETTBPV0ZoTjJKbE1qQTVORE5oWW1RNU1UY3hZVGd3T1EuYmVvWC02Y1VoNFJKeFBUMEFMclhHZw==|1788512453|lZwE96TlQYf2emH5eJ2RZa5XIFwAehv9FLmDsB4-yOM=", "_oauth2_proxy-36225828349aa7be20943abd9171a809"),
    ],
)
def test_extracts_redis_key_from_cookie(cookie: str, expected: str):
    assert redis_key_from_oauth2_proxy_cookie(cookie) == expected


@pytest.mark.parametrize("cookie", ["", "not-a-ticket", "key.secret.with-extra-dot", "key.bad secret"])
def test_rejects_invalid_cookie(cookie: str):
    with pytest.raises(ValueError):
        redis_key_from_oauth2_proxy_cookie(cookie)
