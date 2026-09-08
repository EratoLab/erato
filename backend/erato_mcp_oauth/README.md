# MCP OAuth resource compatibility

This crate wraps the registry release of **rmcp 3.2.0** through its public
`OAuthHttpClient` hook. No SDK code is vendored or patched. Both the Erato backend
and the mock-server regression tests use this implementation.

rmcp 3.2.0 includes PRM resource selection in authorization, code exchange, and
refresh, as well as query-insensitive endpoint/resource matching (#1177). Its
validator still requires matching resource and endpoint origins and offers no
public resource override or omission API. ERMAIN-747 needs those additional cases.

## Behavior

`AuthorizationManager::new(endpoint, resource, headers)` takes the configured MCP
endpoint, optional resource setting, and custom HTTP headers:

- `None`: retain the PRM resource verbatim; absent PRM/resource falls back to the
  endpoint without transport query or fragment.
- `Some(nonempty_uri)`: override PRM with that exact absolute URI.
- `Some("")`: omit `resource` entirely.

Nonempty resource identifiers must be absolute URIs with no fragment or control
characters. A trailing slash or query in an explicit/PRM identifier is preserved.

## Adapter boundaries

Discovery still starts at the actual MCP endpoint. The adapter recognizes PRM
JSON from that origin by its resource/authorization-server fields and excludes
AS documents containing authorization/token endpoints. It retains the advertised
resource and gives rmcp an internal PRM copy whose resource is the endpoint. This
relaxes only the SDK's endpoint/resource identity comparison and missing-resource
check. It never fetches the API resource URI itself, changes an authorization
server URL, or rewrites issuer metadata.

The selected resource is applied to the SDK-generated authorization URL and to
form POSTs **only at the configured token endpoint**. Other parameters (including
state, PKCE, scope and client authentication) retain their values. JSON dynamic
registration requests are unchanged. Rebuilding the wrapper for callback and
refresh repeats discovery and applies the same configuration. Erato's encrypted
credential/state formats continue to use the SDK's serde representations.

The HTTP adapter keeps SDK redirect policy and response-size limits: discovery
redirects remain subject to rmcp's same-origin checks, token requests do not
follow redirects, and responses are limited to 1 MiB. Custom HTTP headers are
preserved for discovery, registration, code exchange and refresh. PKCE, issuer
validation, credential storage and token refresh remain SDK responsibilities.
Erato forwards the optional callback `iss` parameter through the frontend and API
so providers advertising RFC 9207 support can pass the SDK's issuer checks.
The upgrade retains rmcp 3.2.0's stricter authorization-server metadata validation,
including its default requirement for an issuer.

Keep this wrapper's public surface small: do not expose the inner manager or a
way to replace its HTTP client, which would bypass resource adaptation. Remove
the adapter when an upstream SDK API covers these behaviors and the regression
suite passes against it.

## Verification

```sh
cd backend
cargo test -p erato_mcp_oauth -p mock-mcp-server -p erato_config
```

`mock-mcp-server/tests/oauth_resource.rs` tests the original Entra-like failure,
all three resource modes across authorization/exchange/MCP calls/refresh,
metadata fallback, resource and transport queries, dynamic registration,
configured headers, callback issuer validation and redirect boundaries. The
fixture requires no live Entra tenant. Its standalone configuration is documented
in `../mock-mcp-server/README.md`.
