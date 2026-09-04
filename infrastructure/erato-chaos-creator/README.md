# Erato Chaos Creator

`erato-chaos-creator` is a small, local-only FastAPI service for controlled
failure injection during development and end-to-end testing. It is intentionally
not a general Redis administration API.

## Setup

```bash
cd infrastructure/erato-chaos-creator
uv sync
```

The service defaults to `redis://localhost:6379`, matching the frontend
`local-auth` oauth2-proxy configuration, and binds to `127.0.0.1:8000`,
and can be configured with `ERATO_CHAOS_REDIS_URL`, `ERATO_CHAOS_HOST`, and
`ERATO_CHAOS_PORT`.

## Run

```bash
uv run erato-chaos-creator serve
uv run erato-chaos-creator purge-session 'oauth2-proxy-session-key'
uv run erato-chaos-creator interactive
```

The interactive CLI uses the local-auth Redis URL by default. Override it with
`--redis-url redis://host:6379/0`; `ERATO_CHAOS_REDIS_URL` is also supported.

The HTTP action is:

```bash
curl -X POST http://127.0.0.1:8000/actions/oauth2-proxy/purge-session \
  -H 'content-type: application/json' \
  -d '{"session_key":"oauth2-proxy-session-key"}'
```

The action performs one exact Redis `DEL`. It does not scan, glob, or delete
keys by prefix. The caller must provide the exact key stored by oauth2-proxy.

### Purging from a browser cookie

When Redis session storage is enabled, oauth2-proxy sets a signed cookie whose
payload contains a v2 ticket. The decoded ticket is `v2.<base64-ticket-id>.<secret>`;
the Redis key is the decoded ticket ID (for example,
`_oauth2_proxy-36225828349aa7be20943abd9171a809`). You can paste either the
complete `name=value` cookie or just its value:

```bash
uv run erato-chaos-creator purge-cookie '_oauth2_proxy=_oauth2_proxy-0123456789abcdef0123456789abcdef.ABC_def-123'
```

The equivalent HTTP action is `POST /actions/oauth2-proxy/purge-cookie` with
`{"cookie":"..."}`. This extracts only the ticket handle; the secret is not
used or stored.

## Test

```bash
uv run pytest
uv run ruff check .
```
