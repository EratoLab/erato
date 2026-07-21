# Erato desktop sidecar protocol

This directory is the language-neutral source of truth for communication
between an Erato client and a desktop sidecar. The JSON schemas and
`openrpc.json` are canonical. Generated TypeScript files in `typescript/src/generated`
and compiled files in `dist` must not be edited by hand.

The protocol uses JSON-RPC 2.0 envelopes, OpenRPC 1.4 discovery, and JSON
Schema Draft 7 payload contracts. Product build versions are diagnostic only:
compatibility is established by negotiating an exact protocol version and then
intersecting the live capability catalogue with methods compiled into the
client.

## Quick start

```sh
cd desktop-sidecar-protocol
pnpm install
pnpm run check
```

The host-neutral client is exported as `@erato/desktop-sidecar-protocol`. The
deterministic Node.js mock sidecar is exported from
`@erato/desktop-sidecar-protocol/test-server`.

```ts
import {
  DesktopSidecarClient,
  HttpTransport,
} from "@erato/desktop-sidecar-protocol";

const client = new DesktopSidecarClient({
  transport: new HttpTransport("http://127.0.0.1:23123/erato/sidecar/rpc"),
  clientInfo: {
    name: "erato-web",
    version: "2026.07.21",
    host: { application: "browser", runtime: "Chromium" },
    os: { name: "Windows" },
  },
});

await client.discover();
if (client.supports("diagnostics.echo.v1")) {
  await client.invoke("diagnostics.echo.v1", { message: "hello" });
}
```

The candidate loopback URL above is not a production default. Consumers only
send discovery or application requests when an endpoint has been explicitly
configured. See `TRANSPORT.md` for qualification status and deployment
requirements.

The shared frontend provider reads `VITE_DESKTOP_SIDECAR_URL` at build time or
`window.DESKTOP_SIDECAR_URL` at runtime. With neither value set, it remains
unavailable and performs no loopback requests. Both the web application and
Office add-in expose the negotiated snapshot and client through
`useDesktopSidecar()`.

## Authoritative files and generation

- `SPEC.md` defines normative readiness, compatibility, error, and security
  behavior.
- `TRANSPORT.md` defines transport profiles and records platform qualification.
- `schemas/` defines bootstrap, discovery, capability, error, and application
  payloads.
- `openrpc.json` is the canonical method catalogue.
- `examples/` contains complete protocol transcripts.
- `conformance/fixtures/` contains implementation-neutral positive and negative
  cases.
- `typescript/` contains the reference client and generated validators/types.
- `test-server/` contains the deterministic mock implementation.

Run `pnpm run generate` after changing a schema. CI runs `pnpm run check`, which
validates all references and examples, checks the OpenRPC document against the
official meta-schema, regenerates code in a temporary directory, type-checks,
and runs the compatibility/conformance tests.

## Release process

1. Make only backwards-compatible additions within the current protocol and
   method major versions. A breaking payload change requires a new method major;
   a breaking bootstrap/envelope change requires a new protocol version.
2. Add both rollout-direction fixtures: new client/previous sidecar and previous
   client/new sidecar.
3. Update the package version and run `pnpm run package-spec`. This writes an
   immutable, language-neutral specification archive and SHA-256 checksum under
   `release/`.
4. Run `pnpm run package-library` when publishing the compiled JavaScript
   reference client and its TypeScript declarations. This writes a separate
   library archive and checksum under `release/`.
5. Publish the required archive and its checksum. Consumers, including the
   external Rust implementation, pin the artifact version and checksum rather
   than a moving branch.

The specification archive is language-neutral: it contains the Markdown
documentation, OpenRPC document, JSON Schemas, examples, and conformance
fixtures. It deliberately excludes JavaScript, TypeScript, generated
declarations, and the mock/reference client implementations. Archive entries
use the stable `package/` root; the release package version appears in the
archive filename and package metadata, not in its directory structure.

Production sidecar implementation/distribution, dynamic Origin enrollment, and
bulk or binary transfer are intentionally outside this package's scope.
