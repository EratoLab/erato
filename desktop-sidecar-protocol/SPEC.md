# Erato desktop sidecar protocol 1.0

This document is normative. The terms MUST, MUST NOT, REQUIRED, SHOULD, SHOULD
NOT, and MAY are interpreted as described by BCP 14.

## 1. Contract and versioning

Protocol 1.0 uses [JSON-RPC 2.0](https://www.jsonrpc.org/specification) for its
envelope, [OpenRPC 1.4](https://spec.open-rpc.org/) for discovery, and JSON
Schema Draft 7 for payload contracts. JSON files in this directory are
canonical; generated language bindings are not.

Backend filesystem discovery and deployment of distributable sidecar artifacts
are separate from the JSON-RPC protocol and are defined in
[`DISTRIBUTION.md`](DISTRIBUTION.md).

The protocol version selected by `rpc.discover` governs envelopes, discovery,
errors, and cancellation. It does not version business methods. Protocol
versions are exact `major.minor` strings. The client MUST send its supported
versions in descending preference order, with no ranges. The sidecar MUST
choose the first version in that list that it supports. Build versions MUST NOT
be used as a compatibility shortcut.

Each application method has a stable capability identifier and major revision,
encoded in its name (for example, `diagnostics.echo.v1`). Within a method major,
changes MUST be additive: new fields are optional, new enum values are possible,
and existing required fields, types, and meanings do not change. A breaking
change creates a new method major. Sidecars MAY expose multiple majors. Clients
MUST invoke only an explicitly compiled and advertised major.

Receivers MUST ignore unknown object fields, capabilities, methods, and enum
values unless a security decision depends on them. A client MUST NOT
dynamically invoke an unknown method merely because discovery advertises it.

## 2. Request ownership and readiness

The client owns HTTP requests, deadlines, retries, and cancellation. A sidecar
MUST NOT connect back to or launch a client. Protocol 1.0 has no server-to-client
requests or notifications and no connection-scoped session.

The client readiness state machine is:

```text
unavailable -> discovering -> ready
      ^                         |
      +-------------------------+
        refresh or stale data
```

The `ready` state is client-side derived data containing the selected protocol,
sidecar information, sidecar instance ID, catalogue identity, and validated
compiled capability registry. It is not sent as a credential or proof of a
prior exchange. The sidecar does not store or validate client readiness.

Application requests are invalid in the client until `ready`. The sidecar still
validates and authorizes every application request independently against its
current state. Batching is disabled in 1.0; a top-level JSON array is an invalid
request. JSON request and response bodies MUST NOT exceed 262,144 bytes.
Implementations MUST reject duplicate object keys at their parsing boundary
when their JSON library exposes that distinction.

## 3. Discovery and protocol negotiation

1. The client sends `rpc.discover` with supported exact protocol versions,
   client name/build, host application/runtime, and OS diagnostics.
2. The sidecar selects the client's most-preferred mutually supported version.
   If there is no overlap, it returns error `-32010` with
   `kind: "incompatible_protocol"` and its supported versions.
3. The result contains the selected protocol, sidecar name/build, opaque
   sidecar instance ID, and live OpenRPC document for the current user and
   organization.
4. Implemented application methods in the document carry an
   `x-erato-capability` descriptor whose availability is `enabled` or
   `disabled`. A missing capability is not implemented.
5. The client validates the result, verifies the catalogue digest, intersects
   discovery with compiled method majors, and constructs ready data locally.

Discovery is informational and idempotent. It creates no server-side state and
MAY be repeated over any HTTP connection. A response lost to a transport error
can be retried with a new JSON-RPC request ID.

The catalogue digest is `sha256:` followed by lowercase SHA-256 of RFC 8785
canonical JSON for the discovery document after omitting
`x-erato-catalogue.digest`. The revision is an opaque non-empty string and MUST
change whenever effective capability availability or schemas change.

## 4. Capability changes

Protocol 1.0 has no capability-change push notification. The sidecar evaluates
each application request against current policy. If a method is absent or
disabled, it returns `-32011` with `kind: "capability_unavailable"` and a stable
`reasonCode`. Display text remains local to the client.

After that error, the client MUST mark its ready data stale and rerun
`rpc.discover` before invoking further application methods. Clients MAY also
refresh discovery after page resume, transport recovery, or a bounded interval.
A transient transport failure alone does not invalidate ready data.

## 5. Requests, deadlines, and cancellation

Request IDs are non-empty strings or integers. Clients SHOULD use unguessable
string IDs and MUST NOT reuse an ID while it is pending. Duplicate or late
responses are ignored and MUST NOT satisfy another request.

Application requests MAY contain the top-level extension
`x-erato-deadline-at`, an RFC 3339 UTC timestamp. Aborting an HTTP request stops
the client from waiting but does not prove that sidecar work stopped.

On abort or deadline, the client sends a separate `erato.cancel` JSON-RPC
request naming the original request ID and a machine-readable reason. Its
result contains `accepted: true` when matching work was still pending and the
cancellation signal was delivered, otherwise `accepted: false`. Cancellation
is best effort: the original request still ends with at most one response.
Cancellation is independently authorized using the same Origin, OS user, and
organization policy as the original request.

JSON-RPC bodies carry ordinary JSON only. Bulk or binary data MUST use an opaque
handle and a separately versioned transfer profile; base64 payloads are not
permitted in ordinary 1.0 RPC bodies.

## 6. Errors

Standard JSON-RPC codes retain their defined meanings. Protocol-specific codes
are:

|   Code | `data.kind`              | Meaning                                       |
| -----: | ------------------------ | --------------------------------------------- |
| -32010 | `incompatible_protocol`  | No common exact protocol version              |
| -32011 | `capability_unavailable` | Method absent, disabled, or currently denied  |
| -32012 | `invalid_result`         | A peer produced a result outside the contract |
| -32013 | `permission_denied`      | Local policy or user consent refused work     |
| -32014 | `request_cancelled`      | Work stopped after cancellation               |
| -32015 | `timeout`                | The sidecar deadline expired                  |
| -32016 | `sidecar_internal`       | Non-sensitive internal sidecar failure        |

`-32602` remains the code for invalid parameters and `-32601` for an unknown
method. Error `data` follows `schemas/bootstrap/error-data.schema.json`. Human
messages MUST NOT contain secrets, filesystem contents, or stack traces.

## 7. Validation boundary

The client validates outgoing parameters and incoming results against contracts
compiled into that client. A schema supplied by the sidecar is useful for
negotiation and diagnostics but never replaces the client's pinned boundary.
Malformed discovery or application results cause a typed client error. Invalid
application parameters fail locally without sending an HTTP request.

## 8. HTTP transport and security

Each JSON-RPC exchange uses an independent HTTP `POST`. HTTP connection reuse is
an implementation optimization and MUST NOT affect protocol behavior. The
candidate loopback profile, HTTP status mapping, CORS behavior, and platform
qualification are defined in `TRANSPORT.md`.

Origin validation is browser request-forgery protection, not caller
authentication. A native process can forge an Origin header. Privileged
capabilities therefore MUST also be constrained to the logged-in OS user and
organization policy, and SHOULD require explicit consent where appropriate.
An empty production Origin allowlist denies every request. Development origins
are accepted only in an explicit development mode.

## 9. Compatibility policy

Every protocol change adds fixtures for both rollout directions. Current
clients must communicate with the previous released sidecar, and previous
released clients must tolerate additive output from a current sidecar. Removing
a protocol or method major requires a separately communicated deprecation
window; it is never inferred from build versions.

## 10. Adding an application method

A new application method MUST be introduced as one coherent protocol change:

1. Choose a stable, unversioned capability ID, such as `documents.convert`, and
   expose the JSON-RPC method as `<capability-id>.v<major>`. A breaking change
   requires a new method major.
2. Add the canonical parameter and result schemas under `schemas/methods/` as
   `<capability-kebab>-v<major>-params.schema.json` and
   `<capability-kebab>-v<major>-result.schema.json`. Each schema MUST have a
   unique `title` and a stable `$id` below
   `https://schemas.erato.ai/desktop-sidecar/v1/methods/`. Schemas MUST follow
   the additive compatibility rules in this document.
3. Add the method to `openrpc.json`. Its parameters and result MUST reference
   those canonical schema files, and its `x-erato-capability` metadata MUST
   identify the capability ID, major, JSON-RPC method name, and default
   availability. Update the catalogue revision and recompute its digest.
4. Register both schemas in `typeTargets` in `scripts/generate.mjs`, including
   their generated filenames and exported TypeScript names. Also register both
   schema `$id` values in `validatorTargets` when the reference client needs
   standalone runtime validation.
5. Run `pnpm run generate`, then wire the generated parameter and result
   validators into the reference client's `builtInContracts` registry. Export
   the generated types from the public TypeScript entry point when they are
   part of the supported client API.
6. Add examples, mock-sidecar behavior, compatibility fixtures, and tests for
   both rollout directions, then run `pnpm run check` from
   `desktop-sidecar-protocol/`.

Placing a schema below `schemas/methods/` makes it part of repository-wide
schema and reference validation, but placement alone does **not** make the
bundled TypeScript generator emit client types or validators. Registration in
`typeTargets` and, where applicable, `validatorTargets` is therefore required.
`openrpc.json` remains the authoritative method catalogue for other client
generators, which MUST resolve the parameter and result schema references from
each method entry.

## 11. Sidecar restart

The `sidecar.restart.v1` capability requests a process restart for development
and operational workflows. A successful result contains `accepted: true`. The
sidecar MUST allow that in-flight response to complete during graceful shutdown
before the current process terminates. The replacement process MUST use the
same executable and command-line argument vector as the current process,
preserving bind-address overrides and future arguments without interpreting or
reconstructing them.

After acknowledging the request, the sidecar MUST stop accepting new work,
release its listener, start the replacement process, and terminate. The client
MUST treat the current ready data as stale and rediscover after the endpoint is
available again; the replacement sidecar has a new instance ID. Implementations
MUST reject the request with a protocol error rather than returning
`accepted: false` when restart cannot be scheduled.
