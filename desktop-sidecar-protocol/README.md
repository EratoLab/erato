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

## Indexing configuration and statistics

Use `sidecar.configure.v1` to set nullable `indexing_parallelism` (default 1)
and `indexing_documents_per_minute` (default 40) in the existing user and
organization configuration layers. A non-null user value takes precedence.
The rate is shared by all workers; raising parallelism does not multiply it.

Discover `indexing.status.v1` to read resource consumption, per-kind speed,
backlog, ETA, chronological depth, coverage, discovery health, error counts,
rebuild progress and search performance. The result also reports the effective
indexing configuration and absolute local `indexingDirectory` path. See [the statistics contract](SPEC.md#15-indexing-statistics)
and [the example exchange](examples/indexing-statistics.json).

Package 0.1.23 accepts `teams_message` alongside `email` and `file` in indexing
statistics and search kind filters, matching the Teams values already emitted
by the Rust sidecar. Clients built from 0.1.22 or earlier reject Teams statistics
and lose readiness. Update those clients before deploying sidecars that emit
Teams segments; the package version does not negotiate payload compatibility.
Updated clients continue to accept earlier sidecars with only email/file rows.

`indexing.reset.v1` fully clears all managed indexing files, including every
generation, and returns only after cleanup completes with indexing stopped.
It preserves source Outlook data and configuration. See [full reset semantics](SPEC.md#16-full-indexing-reset).

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

if (client.supports("sidecar.restart.v1")) {
  await client.invoke("sidecar.restart.v1", {});
}

if (client.supports("outlook.list_mailboxes.v1")) {
  const { mailboxes } = await client.invoke("outlook.list_mailboxes.v1", {});
  if (mailboxes[0] && client.supports("outlook.list_emails.v1")) {
    await client.invoke("outlook.list_emails.v1", {
      mailboxId: mailboxes[0].id,
    });
  }
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
- [`DISTRIBUTION.md`](DISTRIBUTION.md) defines the backend artifact filesystem,
  manifest, and deployment contract.
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
documentation, including [`DISTRIBUTION.md`](DISTRIBUTION.md), OpenRPC document,
JSON Schemas, examples, and conformance fixtures. It deliberately excludes
JavaScript, TypeScript, generated declarations, and the mock/reference client
implementations. Archive entries use the stable `package/` root; the release
package version appears in the archive filename and package metadata, not in
its directory structure.

Production sidecar implementation and dynamic Origin enrollment are
intentionally outside this package's scope. Backend artifact discovery and
deployment are defined in [`DISTRIBUTION.md`](DISTRIBUTION.md).

Index lifecycle: `indexing.start.v1` resumes or requests a shadow rebuild;
`indexing.stop.v1` drains work and preserves files. Both return indexing statistics.
`search.query.v1` searches individual indexed emails, files and Teams messages.
See SPEC section 17.

## Outlook source references

Package 0.1.26 defines `OutlookFileProvenance`, `OutlookMessageReference`, and
`OutlookMailboxReference` for preserving an uploaded email's identity separately
from an attachment's containing message. The library also exports
`validateOutlookFileProvenance`. See [the source-reference contract](SPEC.md#201-outlook-identifier-formats-and-mailbox-scope)
for native EntryID/StoreID keys, mailbox scoping, and mapping from the existing
RPC results. This is a contract for subsequent persistence and navigation work;
existing RPC payloads are unchanged.
