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

JSON-RPC request bodies carry ordinary JSON only and are capped at 262,144
bytes. Response bodies MAY carry inline base64 bytes — for example the message
bodies and attachments of `outlook.get_conversation.v1` — and are bounded by a
separate, larger response cap. A dedicated transfer profile for very large
payloads may be introduced later, but is not part of 1.0.

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

## 11. Sidecar configuration

The `sidecar.configure.v1` capability replaces the current
`user_configuration` and `organization_configuration` layers. Both layers are
extensible objects. Sidecars MUST accept and persist unknown properties so that
future configuration additions do not require a new method major.

Each layer has a nullable `show_tray_icon` property. A non-null user value takes
precedence over a non-null organization value. When both values are null or
absent, the sidecar default is to show the tray icon. Applying configuration
that is identical to the persisted configuration is a no-op.

The complete configuration payload MUST be persisted in the current user's
platform-default configuration directory and restored on process startup.
Applying a changed effective `show_tray_icon` value MUST update the running
sidecar without requiring a restart.

### Indexing configuration

`indexing_mailboxes` is a nullable array of `{mailbox_id, enabled, priority}`
overrides. IDs are UUIDs from `outlook.list_mailboxes.v1` and MUST be unique
(case-insensitive). Priority is a nonnegative safe integer; lower numbers are
processed first, with canonical mailbox ID breaking ties. Array order has no
effect. Unlisted mailboxes are enabled at priority `9007199254740991`. A non-null
user array replaces the organization array as a whole; null inherits and an
empty array uses defaults. Disabling prevents new discovery and processing,
including queued work, without deleting searchable data. In-flight work may
finish. Priority changes apply to subsequent work without restarting.

Updated status responses include `configuration` containing both persisted
layers so clients can preserve unrelated properties when editing. Clients must
not overwrite saved settings on connection. If both mailbox arrays are null or
absent, clients should match the signed-in user's email case-insensitively to a
discovered mailbox and send a configure request assigning it priority `0`.
Explicit arrays, including empty arrays, must not be initialized again.

Both existing configuration layers accept nullable positive safe integers:

| Property                        | Default | Meaning                                                                                                     |
| ------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------- |
| `indexing_parallelism`          | `1`     | Maximum documents concurrently processed across all kinds and generations, including extraction and commit. |
| `indexing_documents_per_minute` | `40`    | Global document-processing start budget per minute, shared by all workers and document kinds.               |

For each setting independently, use the non-null user value, then the non-null
organization value, then the default. Null is inheritance, not a pause command.
Zero, negative numbers, fractions and values above `9007199254740991` are invalid.
These fields follow the existing whole-layer replacement and persistence rules;
omitting a previously set property removes that override. Invalid requests MUST
fail atomically with `invalid_params` without changing either persisted layer.

Changes MUST apply without a restart. Reducing parallelism lets in-flight work
finish; new documents MUST NOT start until the count falls below the new limit.
No active extraction is killed merely to apply a lower limit. Starts MUST be
paced globally, with at least `60 / indexing_documents_per_minute` seconds between
starts under an unchanged effective setting. Changing the speed resets future
spacing using the last start time, without banking idle time for a later burst.
Parallelism MUST NOT multiply the configured rate. Retries consume the start
budget. Deletion-only cleanup does not, but still consumes a concurrency slot.
One extraction reused by active and building generations consumes one start
and one slot; independent extraction/reweighting work consumes its own.

`indexing.status.v1.effectiveConfiguration` reports the resolved values. Existing
`sidecar.configure.v1` retains its empty success result for compatibility.

## 12. Sidecar restart

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

## 13. Local Outlook actions

`outlook.list_mailboxes.v1` returns mailboxes and message stores exposed by the
logged-in user's local Outlook installation. When the platform exposes an
Outlook profile concept, the mailbox includes its `profileName`; standalone
stores and platforms without profiles omit that field.

Each mailbox has a short opaque `id` that the client MUST return unchanged as
`mailboxId` to `outlook.list_emails.v1`. The ID MUST be unique among mailboxes
advertised by one sidecar runtime and stable for that runtime. It SHOULD remain
stable across sidecar restarts while the logical profile and store identity are
unchanged. Implementations SHOULD derive it from a versioned hash of normalized
profile, address, source, and private store identity. Clients MUST NOT parse the
ID or use it after current ready data becomes stale.

A search result MAY include a `trace` object: the sidecar's own on-device
step log for that request, with the metadata-only content and append-only
event-log semantics defined in §14. The complete log always arrives with the
result, and a client MAY additionally observe the same log mid-flight by
polling `sidecar.progress.v1` with the search request's ID (§14); applying
steps by `sequence` makes both deliveries render identically.

`outlook.list_emails.v1` returns at most 50 of the newest locally indexed
messages for the selected mailbox. Results are metadata summaries; neither
action returns message bodies or attachments. Implementations MUST use
read-only storage access. A mailbox enumeration MAY succeed partially and
report inaccessible local sources in `warnings`; a failure to enumerate the
active platform's Outlook profile is a `sidecar_internal` error.

## 14. Incremental progress

Protocol 1.0 has no server-to-client push (§2), so observing a long-running
request while it runs is a poll pair: the client MAY call
`sidecar.progress.v1` with the JSON-RPC request ID of a pending application
request and receives that request's `state` and step log so far. Polling is
read-only observation and MUST NOT affect the observed request; a client that
never polls sees exactly the behavior it sees today.

`state` is an open string. Known values are `running`, `finished`, and
`unknown`; receivers MUST treat unrecognized values as `running`. Polling an
ID the sidecar does not recognize — never seen, not tracked by that method, or
already past retention — is a successful result with `state: "unknown"`, never
an error.

The `trace` is the sidecar's own on-device step log, shaped as an append-only
event log. It carries metadata only — step identifiers, statuses, durations,
local model identifiers, and item counts — and MUST NOT contain message
content, snippets, or file names, so a client may display it even when the
user declines to share the result itself. Each step carries a `sequence` that
identifies it within the request and orders it; a step MUST NOT change its
`sequence`, and a later step with an existing `sequence` supersedes the
earlier one. Clients MUST apply steps by `sequence` rather than by position,
so that a log delivered complete with a result and a log delivered in parts
through polling render identically. A method's result MAY still embed the
complete log; polling only changes when steps become visible, not what they
mean.

Progress is authorized like cancellation (§5): a request's progress is visible
only to the same Origin, OS user, and organization policy as the original
request, and request IDs are unguessable. Each poll returns the whole log so
far — the schema's step cap keeps the response bounded within §2's body caps,
so no cursor is needed. A sidecar SHOULD keep a finished request observable
for a short retention window so a poll racing completion still sees
`finished`, and MUST NOT persist anything about the request beyond that
window.

Cancellation composes with progress: `erato.cancel` (§5) sets a flag that
running work observes at step boundaries. Work that stops early answers the
original request with `request_cancelled` (-32014), and its final step log
stays observable through the poll for the retention window.

For testing without a long-running application capability,
`diagnostics.echo.v1` accepts an optional `delayMs` parameter (at most 60,000
ms; sidecars MAY cap it lower) and reports the pause as a `delay` step, so
the poll pair and both rollout directions can be exercised against a delayed
echo alone.

## 15. Indexing statistics

`indexing.status.v1` returns a read-only statistics snapshot. It is separate
from per-request `sidecar.progress.v1`. Clients discover support before invoking
it; old sidecars may preserve the new configuration keys without applying them.
Servers advertising `indexing.status.v1` MUST implement both indexing controls
above. This is an additive capability; the protocol version remains `1.0`.

The request can set `includeSourceBreakdowns` and `includeFileTypeBreakdowns`
to false to reduce payload size; each defaults to true. These only omit extra
segment rows. Global resource measurements, discovery and aggregate rows are
unchanged. The server MUST include aggregate `email` and `file` rows for each
reported generation, even when a kind has zero documents. Source rows include
mailbox IDs when known. File type groups are mutually exclusive: PDF, Office,
text, image, embedded email, archive and other; `fileType: null` means all types.
An embedded `.eml` attachment is a `file` with `fileType: "email"`. A standalone
file and an attachment are both `file`; attachment age derives from its parent.
Clients MUST NOT sum aggregate rows together with their breakdowns.

### Local indexing directory

Updated implementations MUST include `indexingDirectory`: the absolute local
filesystem path of the managed indexing root on the sidecar machine. This is
an OS-native path, not a `file://` URI or a client-relative path. Preserve native
separators and spaces. Report the resolved root even before initialization,
while stopped, and after reset; reporting it MUST NOT create the directory or
any indexing files. The path identifies the root, not an individual generation;
indexing-owned temporary files may also exist outside that root.

The field is optional in the v1 wire schema so updated clients can still read
status from earlier sidecars. Its absence means an older server did not report
the path; it does not mean no indexing directory is configured. The path is
local to the sidecar machine and is informational; clients MUST NOT interpret
it as a browser URL or interpolate it into shell commands.

### Sampling and availability

The top-level `sampledAt` is snapshot assembly time. Nested timestamps identify
when independently sampled data was collected; clients can calculate its age.
Each rate/latency section specifies its actual observation duration and sample
count. Monotonic clocks MUST determine elapsed durations; UTC date-time strings
are for display. Samples are volatile and restart with `sessionId`; no historical
series is persisted or returned in v1. Durable inventory/receipt counts survive
restarts. Clients may retain their own history, separating process sessions and
index generation IDs.

Unknown or unsupported measurements MUST be null, with the associated reason;
zero MUST represent an observed zero. Common reasons include `warming_up`,
`not_supported`, `not_observed`, `paused`, `blocked`, `discovery_incomplete`, and
`no_observed_throughput`. Reason strings are extensible. A section containing
some available metrics may also explain unavailable fields. On OSes without a
particular resource measurement, the rest of the snapshot remains available.
Resource sections enumerate unavailable metric paths explicitly.

Polling MUST read cached/background-maintained aggregates rather than initiate
full mailbox scans or extraction. Implementations SHOULD refresh process
resources about every five seconds and inventory aggregates about every ten
seconds. Each section's timestamp exposes delays. Historical throughput windows
MUST NOT be erased by polling, configuration changes, or stop/start indexing
within a process session. Fresh samples after changes gradually replace old
ones, so an ETA may temporarily reflect the previous scheduling allocation.

### Resources

CPU usage is CPU seconds divided by wall-clock seconds: `1.0` is one busy core;
values above one are valid. Sidecar CPU includes indexing, search and discovery,
and MUST NOT be presented as precisely attributable indexing CPU. Extraction
worker aggregates include short-lived children that exit between samples.
`liveExtractionWorkers` also exposes per-worker measurements for currently live
children (each has processCount = 1); process IDs can be reused, so clients MUST
NOT treat them as durable identities. Resident memory sums can double-count shared pages. Aggregate peak resident
memory is the largest simultaneously sampled sum, not the sum of individual
process peaks. Peaks are session-scoped; processCount counts currently live
processes. Disk I/O rates are process I/O where the platform supports them.

Allocated disk bytes describe filesystem allocation; logical bytes describe
file lengths. Control, catalog, active index, building index, retired indexes,
WAL and temporary-file buckets MUST be disjoint. Totals equal their sums when
all buckets are known. Account for known temporary storage outside the index
folder too. Available bytes describe free space on the index volume. Resource
usage is process-wide, even when only selected segment breakdowns are returned.

### Throughput, backlog and ETA

Each segment has exactly one 60-second and one 300-second trailing window.
During warm-up, observationSeconds is the shorter actual duration since process
startup. Zero-duration windows report null rates. `sampleCount` counts committed
non-deletion revision completions; `completedPerMinute` is indexed + empty +
unindexable. Failed retry attempts are attempts, not completions. Rate denominators
include waiting, throttling and paused time. Rates count revision work, not unique
lifetime document IDs. Deletion throughput is separate. Text bytes count UTF-8
bytes actually analyzed, not source attachment bytes. Reweighting from stored
counts does not add extracted bytes or a new search-freshness sample.

A backlog compares known eligible current catalog revisions against committed
receipts. Only enabled source documents are eligible. Missing sources make
inventory completeness uncertain; disabled sources are excluded. Remaining work
is partitioned into ready (including work outside the bounded queue), inProgress,
retryDeferred and blocked. It is independently partitioned into firstTime
(no previous receipt) and updates (a stale receipt exists). Both partitions MUST
sum to remaining. Completed terminal failures and deletion-only cleanup are not
remaining work. When inventory cannot be read, counts are null; an incomplete
scan can still report exact counts for already discovered documents.

ETA uses remaining divided by the observed completed rate, normally the 300-second
window, reflecting that kind's actual scheduler share. Report the selected window,
actual duration and sample count. It estimates only the known backlog under
unchanged conditions and no future arrivals, not an undiscovered mailbox total.
`discoveryComplete: false` does not invalidate that narrower estimate. A zero
backlog has zero remaining seconds, including while paused. A nonzero backlog
with paused processing, blocked work, missing counts or no positive observed rate
has an unavailable ETA with a reason. Retry delays and a changing scheduler share
can make an estimate inaccurate; do not label it a completion guarantee. Absolute
completion time is snapshot time plus estimated seconds. ETA to complete processing
includes terminal failures and is not ETA to make every document searchable.

### Coverage, depth and health

Coverage partitions knownEligible into indexedCurrent, emptyCurrent,
unindexableCurrent, stale and neverProcessed; each document occurs in one state.
An older failed receipt is stale if its revision no longer matches. Pending
deletions are separate. Failed documents never increase searchable coverage.

Depth applies only when the scheduler prioritizes the relevant kind by source
age. Email ordering uses received-at with sent-at as fallback; attachments inherit
that date. Other chronological sources name their field through sourceDefined.
Other kinds report notApplicable. Depth considers current revisions, not an older
successful receipt. oldestIndexedDocumentAt reports reach without a continuity
claim. fullyIndexedSince requires indexed/empty current receipts throughout the
interval; processedSince also accepts terminal failures. Boundaries have explicit
inclusivity so timestamp ties and pending records do not overstate coverage.
Return null if no nonempty covered interval can be established. Undated documents
are counted and excluded; discoveryComplete and gap counts accompany the boundary.
Aggregate depth is unknown when contributing sources have incompatible date
bases. Aggregate boundaries MUST honor gaps in every contributing source; incomplete
source discovery MUST NOT be described as complete mailbox coverage.

Freshness measures discovery-to-first-searchable-commit latency (p50/p95 in
seconds), excluding failed/empty/deleted work. Building generations report null
freshness percentiles with `not_active`; a building commit does not make data
searchable. Search statistics measure wall-clock
query latency in milliseconds (p50/p95), query/error counts and current in-flight
queries. Query counts include all completed queries, including failures; latency
percentiles cover successful queries only. An empty latency sample reports null
percentiles and a reason. Discovery reports accessibility, scan progress and last
successful scan. Recent bounded error histograms expose codes and counts without
message content, attachment names or local paths; truncation is explicit.

Active and building generations have separate segments and receipts. Clients
MUST NOT sum them as distinct mailbox documents. The same extraction committed
to both generations may count as progress in both; process resources are counted
once. `chunks`, `terms`, indexedAvgdl and observedAvgdl expose index shape and BM25
normalization drift. Retired generations contribute disk usage but not current
indexing progress. At most one active and one building generation are reported.

The conformance fixture `indexing-statistics.json` is synthetic sample data,
including a rebuild; the mock server returns it deterministically with effective
settings resolved from the most recent configure call. It does not simulate
resource consumption, scheduling or persisted configuration across mock restarts.

## 16. Full indexing reset

`indexing.reset.v1` takes `{}` and deletes all indexing storage managed by this
sidecar for the current OS user on the machine, across every mailbox/source and
index generation. It does not accept a caller-selected path or generation scope.
Source Outlook stores, original emails and attachments, application configuration,
TLS/bootstrap material and unrelated application files MUST NOT be deleted.
Other operating-system users' data is outside this sidecar's scope.

The reset MUST include control/catalog databases, all active/building/retired/failed
index generations (including embedding indexes when present), WAL/journal files,
checkpoints, extraction caches, and indexing-owned temporary files. Unregistered
leftover generations and indexing-owned temporary files outside the main index
directory MUST also be removed. Merely creating a new concurrent generation,
clearing database rows, renaming files, or moving them to trash is not a reset.
Deleting the files is required; forensic secure erasure is not promised.

Before deletion, implementations MUST:

1. Exclude other indexing processes operating on the same storage and block new
   discovery, extraction, retries, maintenance and generation activation.
2. Stop/cancel and join all indexing workers and extraction children; drain or
   cancel searches holding index references, including generation-pinned readers.
3. Close all database/file handles and invalidate caches, queues, retry state,
   discovery cursors and generation pointers so no stale worker can recreate or
   serve the deleted index.
4. Remove every managed indexing artifact and verify cleanup succeeded before
   responding. Do not instantiate replacement databases as part of reset.

A success result is `{ "completed": true, "completedAt": <UTC timestamp>,
"state": "stopped" }`. It is a completion acknowledgement, not an accepted/job
response. Missing indexing files are already reset; repeated calls succeed.
Concurrent reset calls MUST be serialized or coalesced so they cannot race with
creation, indexing or activation. No separate confirmation RPC is required.

While resetting, status reports `state: "stopping"` and
`resetInProgress: true`; clients compiled before this optional field was added
still understand stopping. Index-dependent searches MUST fail with
`capability_unavailable` and `reasonCode: "index_reset_in_progress"` until
cleanup completes; they MUST NOT return stale or partially cleared results.
After success, status reports stopped, no generations, no discovered inventory,
no extraction workers and zero indexing disk usage. Reading status or searching
MUST NOT recreate the databases. Index-dependent searches fail with
`reasonCode: "index_not_initialized"` until indexing is initialized again.
Live Outlook actions that directly read source data may continue to work.

Reset discards indexing-progress samples tied to the removed generations. Process
identity/uptime, process resource peaks and process-wide query statistics remain
session-scoped. Effective configuration, including speed and parallelism, remains
unchanged. Configure MUST NOT implicitly resume indexing after reset. Indexing
stays stopped for the current process until an explicit resume action; an explicit
sidecar restart may apply normal startup indexing policy and build from scratch.

If deletion or handle shutdown fails, return the existing `sidecar_internal`
error with `reasonCode: "index_reset_incomplete"`, keep indexing stopped, and do
not report completed. Deleted files cannot be rolled back. A subsequent reset
retries cleanup. This error MAY set the additive error-data field
`resetIncomplete: true`. Avoid disclosing source paths in errors. Known
permission denials before any mutation may return `permission_denied`.

Cancellation/deadline expiry before quiescing or deletion begins may return the
usual request_cancelled/timeout response without changes. Once the destructive
reset has begun, cancellation or a disconnected/timed-out caller MUST NOT allow
old work to restart; cleanup proceeds to completion or a stopped incomplete state.
Client timeout alone does not establish whether reset completed. Clients can
query status or retry reset. Implementations MUST durably record an in-progress
reset outside the index files being removed and finish/verify cleanup on process
recovery before allowing indexing or search to resume. Remove this operational
marker once cleanup is complete; it contains no indexed document data. A recovery
that finishes an interrupted reset leaves indexing stopped for that process.

The reference mock models the post-reset status and configuration preservation
in memory. It does not delete files or implement process coordination; production
implementations must test those lifecycle and filesystem guarantees separately.

## 17. Index lifecycle and lexical search

`indexing.start.v1` starts or resumes indexing. Empty params use the effective
`sidecar.configure.v1` settings (parallelism 1 and 40 documents/minute by default).
It does not overwrite configuration. An optional `rebuild` object starts a shadow
rebuild; omitted fields use the implementation's current index settings. The
active generation remains searchable until verified atomic activation. Only one
rebuild may run; conflicting rebuild requests return `capability_unavailable`.
Repeated starts without a rebuild are idempotent. Start is the explicit opt-in
that may recreate indexing files after a completed reset. During reset it fails
with `capability_unavailable` and reason `index_reset_in_progress`.

`indexing.stop.v1` stops admitting work and drains current work before returning.
It is idempotent, preserves all index files, and leaves search available. Both
start and stop return the same complete statistics shape as `indexing.status.v1`.
Stop does not change persistent configuration. Configure alone does not resume a
stopped index. A successful stop returns state `stopped`.

`search.query.v1` searches individual indexed emails and files across sources.
It complements `outlook.search_emails.v1`; attachments are independent results,
and conversationKey associates results without indexing grouped conversations.
Filters are combined with AND: sender is a case-insensitive exact address or name,
mailboxId identifies a mailbox, kind selects email/file, fileType matches MIME type
or filename extension, and dateFrom/dateTo are Unix seconds with an inclusive lower bound and exclusive upper bound. Reversed
date bounds are invalid params. Files inherit available sender/mailbox/date/thread
metadata from their parent email. Missing metadata does not satisfy a filter.
The optional `metadata_filters` array expresses source- and implementation-specific
metadata predicates. Each entry has a `field`, `operator`, and `value`; entries are
combined with AND semantics. Values may be arrays for operators such as `in`, and
the sidecar may expose virtual fields whose predicates are rewritten to an
implementation-specific query.
Empty text performs a filtered listing. Text searches use exact BM25, one result
per document using its highest scoring chunk, descending score then documentId
for deterministic ties. limit defaults to 20 and is capped at 100. Scores are
relative ranking values, not probabilities. The response contains result metadata
and execution counters; it does not contain extracted document contents.
Search uses a consistent active generation and never creates an index. With no
active index it returns `capability_unavailable`, reason `index_not_initialized`;
during reset the reason is `index_reset_in_progress`. The mock returns an empty
synthetic search result and models lifecycle state, not actual BM25 or rebuilding.

`search.metadata_fields.v1` lists the metadata fields exposed by the sidecar for
these filters. Each field describes its supported operators, value type, human-
readable description, and applicable document kinds.

## Mailbox indexing benchmarks

`indexing.benchmark.start.v1` accepts a discovered `mailboxId` and an optional
`mode` (`fiveMinutes`, the default, or `fullMailbox`). It returns a durably persisted
`runId` and snapshot. `indexing.benchmark.status.v1` accepts that ID and returns
current/final statistics. Mailbox IDs accept the compact IDs from mailbox discovery
and their equivalent hyphenated UUID representation.
Unknown mailboxes, unknown run IDs, and overlapping starts are invalid
parameters. RPC run IDs and final results survive process restarts.

The sidecar drains normal indexing before timing the benchmark, creates a fresh
temporary index, and runs one mailbox scan with CPU-count parallelism and no
normal indexing rate limit. States are `preparing`, `running`, `completed`, and
`failed`. Full-mailbox mode attempts each discovered document once; extraction
failures are counted without retries. Five-minute mode cancels work at 300
seconds; in-flight source/database operations must drain before completion. Runs
may finish earlier when the mailbox is exhausted. The temporary index is deleted
on completion/failure, and the runtime index is preserved. Normal indexing resumes
if it was running before the benchmark; ordinary stop/start requests during a run
update whether indexing should resume. Rebuilds are rejected during a benchmark.

Snapshots report chosen parallelism, elapsed seconds, discovered/indexed/failed
document counts, counts by email/attachment MIME type, discovery completion, and
time-limit status. `completed` does not imply zero extraction failures or a fully
scanned mailbox. `mailboxBytes` sums source sizes represented by successful work:
PST/OST email message sizes include attachments and are counted once; macOS OLK
email and separately indexed attachment files contribute their file sizes.
`emailsWithUnknownSize` explicitly counts indexed emails omitted from the byte
sum. Sizes are not allocated disk usage or index size. Terminal failures carry an
`error`; timed-out runs can complete successfully with partial statistics.

`indexing.benchmark.list.v1` rediscovers run IDs after frontend state loss. It
accepts optional `limit` (1–100, default 50) and `offset` (nonnegative, default 0).
The result contains `runs` and `nextOffset` (null at the end). Summaries contain
`runId`, `mailboxId`, `mode`, `state`, `startedAt`, and nullable `finishedAt`, sorted
by start time descending with run ID as a descending tie-breaker. Use the status
RPC for full results. New runs can shift offset pages; refresh from offset zero
when polling. Empty history or an offset beyond the end returns an empty page.

The sidecar atomically persists each RPC run before acknowledging its start and
persists its final snapshot after completion. History has no automatic 32-run
expiry and is independent of the disposable benchmark index. On startup,
previously preparing/running records are marked failed with an interruption error
and finish timestamp; partial volatile counters are not restored. Standalone CLI
runs continue to return their results directly without writing runtime history.
