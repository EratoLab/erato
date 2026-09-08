# Mock MCP Server

A standalone mock MCP server bundle for local/integration testing.

## Endpoints

The server exposes several MCP servers on different streamable HTTP endpoints:

- `GET /health` - health check
- `streamable HTTP /mcp/file` - file server (`list_files`, `read_file`)
- `streamable HTTP /mcp/error` - error simulation server (same tools, `read_file` errors)
- `streamable HTTP /mcp/progress` - progress simulation server (same tools, `read_file` emits progress notifications)
- `streamable HTTP /mcp/content-filter` - content-filter simulation server (`trigger_content_filter`, returns `is_error: true`)
- `streamable HTTP /mcp/image-generation` - image generation server (`generate_image`, returns the shared cat image fixture)
- `streamable HTTP /mcp/deep-research` - deep-research simulation (`deep_research_dispatch`, `deep_research_poll`); the first poll is pending and the next poll completes

Default bind: `127.0.0.1:44321`

## Run

```bash
cargo run --bin mock-mcp-server
```

With custom address:

```bash
HOST=0.0.0.0 PORT=3000 cargo run --bin mock-mcp-server
```

## Entra-like OAuth resource reproduction

The standalone server also exposes `/mcp/oauth`, backed by the file tools. Its
401 challenge points to `/.well-known/oauth-protected-resource`, which declares
`resource: https://api.example.com` and scope
`https://api.example.com/Mcp.Read`. This deliberately differs from the MCP URL.
`/.well-known/oauth-authorization-server` advertises `/oauth/authorize`,
`/oauth/token`, and `/oauth/register`. A static public client such as
`mock-oauth-client` or dynamic registration can be used. Authorization approves
automatically and enforces S256 PKCE during code exchange. Codes are single-use;
refresh tokens rotate. These are local test credentials, not a production OAuth server.

Use the following Erato configuration (and configure `server.encryption_key`):

```toml
[mcp_servers.entra_mock]
transport_type = "streamable_http"
url = "http://127.0.0.1:44321/mcp/oauth?transport=streamable"
[mcp_servers.entra_mock.authentication]
mode = "oauth2"
[mcp_servers.entra_mock.authentication.oauth2]
client_id = "mock-oauth-client"
scopes = ["https://api.example.com/Mcp.Read"]
```

Connect in Erato and call `list_files`. To reproduce the original error, set
`resource = "http://127.0.0.1:44321/mcp/oauth"`: authorization fails with
`invalid_resource` and `AADSTS9010010: The resource parameter provided in the request doesn't match with the requested scopes.`
Code exchange and refresh enforce the same expected resource. Removing the key
or overriding it with `https://api.example.com` makes all stages succeed.

If the server is accessed through another hostname or proxy, set `OAUTH_BASE_URL`
to its externally reachable origin; discovery URLs use this origin.

```sh
cd backend
cargo test -p mock-mcp-server --test oauth_resource
```

The regression suite starts ephemeral local listeners and covers the rejected
endpoint resource, successful authenticated MCP calls and refresh, distinct-host
PRM, transport queries, exact resource queries/trailing slashes, invalid resources,
override/omission precedence, and fallback when PRM is unavailable. Omission
requires the fixture's `OAuthConfig.expected_resource = None`; the default
Entra-like fixture requires the declared API resource. Without PRM, automatic
selection expects the endpoint with query/fragment removed.
