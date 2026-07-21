# Transport profiles and qualification

The payload protocol is transport independent. This document outlines the
candidate loopback HTTP profile that replaces the earlier WebSocket proposal.
The HTTP request/response profile is implemented by the reference client but is
not a production default until the platform qualification below has passed.
Distribution of sidecar executables and installers is a separate backend
contract defined in [`DISTRIBUTION.md`](DISTRIBUTION.md).

## Request adapter contract

The HTTP adapter performs one JSON-RPC exchange at a time:

```text
request(JSON-RPC request, abort signal) -> JSON-RPC response
```

Each exchange is one HTTP request and, for a JSON-RPC request with an `id`, one
HTTP response. The adapter does not expose connect, receive-loop, reconnect, or
close operations. HTTP keep-alive is an optimization owned by the browser and
sidecar; protocol correctness MUST NOT depend on a TCP connection being reused.

The client owns request deadlines and retries. It MUST NOT automatically retry
an application request unless the method contract explicitly declares the
operation idempotent. A failed HTTP request affects only that request and does
not invalidate otherwise valid ready data.

## Candidate loopback HTTP profile (unqualified)

| Property              | Candidate value                                     |
| --------------------- | --------------------------------------------------- |
| URL                   | `http://127.0.0.1:23123/erato/sidecar/rpc`          |
| Methods               | `POST` for RPC; `OPTIONS` for browser preflight     |
| Request content type  | `application/json`                                  |
| Response content type | `application/json`                                  |
| Address               | IPv4 loopback only until IPv6 behavior is qualified |
| Maximum body          | 262,144 bytes for each request and response         |
| Discovery timeout     | 5 seconds                                           |
| Idle policy           | none; there is no persistent protocol connection    |

Each `POST` body contains exactly one JSON-RPC 2.0 request or notification.
Batch arrays remain disabled. A request with an `id` receives exactly one
JSON-RPC response with the same `id`, including when the result is an error. A
notification receives HTTP `204 No Content`. Discovery and cancellation use
requests rather than notifications because the client needs acknowledgement.

After the sidecar has accepted the HTTP request as JSON-RPC, both successful
results and JSON-RPC errors use HTTP `200 OK`. HTTP status codes describe only
the HTTP boundary: for example, `405` for a method other than `POST`, `413` for
an oversized body, `415` for an unsupported content type, and `429` or `503`
for a request that was not admitted. Clients MUST NOT try to interpret a
non-JSON HTTP error body as a JSON-RPC response.

`OPTIONS` is a transport-level preflight and never advances protocol state.
`GET` is not supported, so JSON-RPC payloads cannot appear in URLs, browser
history, or intermediary caches. RPC responses set `Cache-Control: no-store`.

## Request-composed readiness state machine

There is no connection-scoped session. The state machine is composed of
individual JSON-RPC HTTP requests:

```text
unavailable
    |
    | POST rpc.discover -> validated discovery result
    v
ready(ready data)
    |
    +-- sidecar instance or catalogue changed --> unavailable
```

The transition completes only after the HTTP response and its discovery
document have been validated. Discovery creates no server-side session state,
so a request with a lost response can be retried with a new request ID.
Application requests are permitted only in `ready`; a transport failure for one
request does not itself discard the ready data.

### Discover and become ready locally

The client sends `rpc.discover` with its supported exact protocol versions,
client build information, host application/runtime, and OS diagnostics. The
sidecar selects the client's most-preferred mutually supported protocol. If
there is no overlap, it returns `-32010` with the versions it supports.

The discovery result contains the selected protocol version, sidecar build
information, sidecar instance ID, and the live OpenRPC document. The client
validates the result and intersects its capability catalogue with method majors
compiled into the client. That produces the local ready data:

```json
{
  "protocolVersion": "1.0",
  "serverInfo": {
    "name": "erato-desktop-sidecar",
    "version": "0.1.0"
  },
  "instanceId": "sidecar-instance-id",
  "catalogue": {
    "revision": "1",
    "digest": "sha256:..."
  }
}
```

The ready data also contains the validated, compiled capability registry. It is
a client-side derived value, not a wire payload, credential, or proof of a
prior exchange. Neither `erato.initialize` nor `erato.initialized` is needed in
this profile because discovery returns all readiness information and the
sidecar does not maintain an initialized state.

## Ready-data lifetime and reuse

A client's ready data is reusable across sequential and concurrent HTTP requests,
regardless of whether they use the same HTTP/1.1 connection. It is not consumed
by a request, does not carry a sequence number, and does not become invalid
merely because a TCP connection closes, a request is aborted, or the browser
suspends and resumes the page.

Ready data is not sent with application requests and the sidecar does not bind,
store, expire, or validate it. Every application request is independently
validated and authorized against current sidecar state. A transient fetch
failure or HTTP `429` or `503` response does not discard ready data.

The client marks ready data stale when a fresh discovery response reports a
different sidecar instance or catalogue identity, or when an application
response reports that an advertised capability is no longer available. The
client then reruns discovery. Clients MAY also refresh after page resume,
transport recovery, or a bounded interval. Storage and sharing of this
non-secret derived data are client lifecycle decisions, not transport
semantics.

## Capability changes without server push

HTTP has no server-to-client notification channel in this profile, so
`erato.capabilitiesChanged` is not sent. The sidecar evaluates every application
request against its current capabilities. If a method is absent or disabled, it
returns `-32011` with a stable reason code. The client marks its ready data stale
and reruns discovery before invoking more application methods.

This makes capability freshness request-driven. A separate polling or event
transport can be specified later, but is not required for correctness and MUST
NOT introduce a server-side initialization session.

## Deadlines, cancellation, and request IDs

Request IDs are unique among a client's pending requests rather than within a
transport connection. Parallel requests MUST use different IDs while pending.
Clients SHOULD use unguessable string IDs so a cancellation request can identify
its target without relying on a connection.

Aborting `fetch` stops the client from waiting but does not prove that sidecar
work stopped. For cancellable methods, the client sends an acknowledged
`erato.cancel` JSON-RPC request in a separate HTTP `POST`, naming the original
request ID. Cancellation remains best effort; the original request still has at
most one response. Cancellation authorization is evaluated independently using
the same Origin, OS user, and organization policy as the original request.

## Origin, CORS, and loopback security

The production sidecar binds only to loopback and validates the exact request
path, `Host` including port, and browser-supplied `Origin` before processing a
preflight or RPC request. Host values other than configured loopback literals,
`Origin: null`, wildcard origins, absent origins, and unconfigured origins are
rejected.

For an accepted browser origin, preflight responses allow only `POST` and
`Content-Type`, return the exact Origin in `Access-Control-Allow-Origin`, and
include `Vary: Origin`. Wildcard origins and credentialed cookie access are not
used. Private-network access headers are returned only when requested by a
qualified host and only after the same Host and Origin validation.

The v1 deployment assumption is an installer/MDM-provided list of normalized
Erato base origins. Each entry is lowercase scheme plus IDNA ASCII host plus
explicit non-default port, with no path, query, fragment, wildcard, or trailing
slash. Default ports are omitted. Comparison occurs after standards-compliant
URL parsing and normalization, never by suffix or substring.

An empty production allowlist refuses all requests. `http://localhost` and
other development origins require an explicit development-mode setting.
Dynamic enrollment and trust-on-first-use are out of scope and require a
separate security design.

Origin validation is browser request-forgery protection, not native caller
authentication: a native process can forge an Origin header. Privileged
capabilities still require OS-user and organization-policy authorization and,
where appropriate, explicit consent.

## Required platform qualification

As of 2026-07-21, this environment cannot execute the required Outlook desktop
hosts. No row below is claimed as qualified, so the candidate URL is opt-in and
there is no built-in production endpoint.

| Platform/host             | Runtime                 | `http://`  | `https://` | Origin observed | Permissions/prerequisites                                      | Status  |
| ------------------------- | ----------------------- | ---------- | ---------- | --------------- | -------------------------------------------------------------- | ------- |
| Windows classic Outlook   | embedded Office browser | Not tested | Not tested | Not captured    | WebView2/legacy runtime must be recorded                       | Pending |
| Windows new Outlook       | WebView2                | Not tested | Not tested | Not captured    | Loopback exemption and private-network prompts must be checked | Pending |
| macOS Outlook             | WKWebView               | Not tested | Not tested | Not captured    | Local-network permission and certificate trust must be checked | Pending |
| Office on the web, Edge   | Chromium                | Not tested | Not tested | Not captured    | Mixed-content and private-network policy must be checked       | Pending |
| Office on the web, Chrome | Chromium                | Not tested | Not tested | Not captured    | Mixed-content and private-network policy must be checked       | Pending |
| Office on the web, Safari | WebKit                  | Not tested | Not tested | Not captured    | Local-network permission and certificate trust must be checked | Pending |

Qualification records, for every row:

1. CORS preflight and one JSON-RPC request;
2. discovery and local construction of ready data on a fresh TCP connection;
3. sequential and concurrent reuse of ready data across connections;
4. recovery after sidecar restart and catalogue change;
5. exact Origin and Host values;
6. mixed-content behavior from the production HTTPS origin;
7. local/private-network prompts and managed-policy controls;
8. WebView2 loopback-exemption requirements;
9. installer-managed certificate trust if TLS is required; and
10. hostile Origin, `Origin: null`, absent Origin, and DNS-rebinding-style Host
    rejection.

The acceptance outcome is either one loopback profile that passes every row or
multiple named profiles behind the unchanged request semantics. Results replace
the `Pending` cells with tested application/runtime/OS versions, date, outcome,
and installer prerequisites.
