# Strict mode and the job envelope

Status: package 0.1.44 adds the job envelope (`jobs.*`) for normal mode and
reserves its strict review. Strict review on jobs, the egress rules and the
removal of the transitional strict path are stage 2. Transport protocol remains
1.0. This document is the shared design record. It does not certify a security
implementation.

## Trust model

The frontend (the web app and the Office add-in) is trusted to relay faithfully;
hardening against a malicious frontend is out of scope. The perimeter is the
native sidecar process: content the user has not approved never reaches web
code. Under strict mode, content RPCs are denied and the job envelope is the
only content path besides the transitional path below; the native plain-text
review starts with an empty selection and no RPC can approve it; the tool
enumeration is closed; and the mode comes only from the installed bootstrap. The
Origin allowlist is the single trust anchor: bootstrap `allowed_origins` admits
only canonical `http` or `https` origins without userinfo, path, query, fragment
or default port, and the `--allow-origin` opt-in stays development-only. Backend
plan signing, context binding, installed verification keys, `backend_origin`
pinning and signed receipts belong to the transitional path below and are
removed in stage 2.

## Job envelope

The six `desktop/*` client tools (`list_sidecar_mailboxes`,
`get_sidecar_folder_hierarchy`, `get_sidecar_search_fields`,
`search_sidecar_index`, `get_sidecar_document`, `read_sidecar_conversation`) are
the tool catalogue in both modes. Strict mode changes how the desktop app runs
them, never which tools exist or their arguments, results and errors.

`jobs.start.v1` takes a batch of independent calls, each `{server, name,
arguments}`. `server: "sidecar"` is reserved for the six built-ins; other ids are
reserved for local MCP servers. The sidecar maps a call to internal read-only
operations, never by re-entering its RPC dispatcher, through the closed table in
[`providers/sidecar.json`](providers/sidecar.json) (exported as
`SIDECAR_PROVIDER`), which lists the RPC methods whose work each tool composes.
Administrative and operational methods are human-only and never tools:
`sidecar.configure.v1`, `indexing.*` control and benchmarks,
`sidecar.restart.v1`, `sidecar.request_permission.v1`,
`sidecar.open_data_directory.v1`, `sidecar.status.v1`, diagnostics and
`sidecar.progress.v1`. `outlook.list_emails.v1` and `outlook.search_emails.v1`
are RPCs, not tools. Opening an item in Outlook stays a human-initiated action.

States: `queued -> running -> completed -> read -> acked`. Under strict, a
read-only tool's job passes `ready_for_review -> approved` after running, and an
effectful tool will wait in the reserved `awaiting_approval` before running.
`declined`, `cancelled`, `expired` and `failed` are terminal. A response that
reports `completed` or `approved` carries `results`, one entry per call in call
order, and the job is `read` from then on; `jobs.read.v1` returns them again
until `jobs.ack.v1` discards them, and answers InvalidParams for a job without
results. `jobs.cancel.v1` ends a job that has not ended and is idempotent.
`jobs.review.v1` only opens or focuses the native review of a job in
`ready_for_review`. An unknown handle, or one issued to another Origin, reports
`expired`.

`jobs.start.v1` and `jobs.status.v1` take `wait_ms`: the sidecar holds the
response while the job is pending and answers as soon as it has results or ends,
up to discovery's `jobs.maxWaitMs`. A normal-mode call keeps one round trip, and a
status long-poll replaces polling quantization; adaptive polling remains the
fallback. A call that fails gets an `error`, the JSON-RPC error object a direct
RPC returns, and the other calls are unaffected. Same-turn sidecar calls may be
coalesced into one job, with one review under strict. See
[the example exchange](examples/jobs.json).

Direct content RPCs stay served in normal mode for clients that are not a model
(the add-in's message fetcher, the settings pane, the CLI). A client runs tools
as jobs when discovery reports `jobs` and the `sidecar` provider; otherwise it
keeps its direct-RPC mapping until the supported sidecar floor allows removing
it. Until stage 2, a strict sidecar fails a call to a content tool (one with a
selection, below) without running it, with `capability_unavailable` and
`reasonCode: "strict_review_unavailable"`, and keeps `jobs.review.v1` disabled
with that reason. Mailboxes and search fields run with the account-level
reduction under "Settings under strict mode".

## Results and selection

A call's result is the MCP `CallToolResult` for every provider: `content`
blocks (text, image, audio, embedded resource, resource link) with
`annotations {audience, priority, lastModified}` and `_meta`, and
`structuredContent`, `isError` and `_meta`. `_meta` keys are reverse-DNS
namespaced; MCP reserves its own prefixes such as `modelcontextprotocol.io/`, and
Erato uses `ai.erato/`. For the built-ins, `structuredContent` is the tool's JSON
result, byte-compatible with the normal-mode result, and `content` carries the
plain-text review rendering and the files as embedded resources:
`get_sidecar_document` bytes become a `resource {blob, mimeType}` block the
frontend uploads, as it uploads `contentBase64` today.

Each built-in declares its selection in the provider table: `items`, a JSON
pointer into `structuredContent` or `content`, and `resultMetadata`, pointers to
result-level metadata. `search_sidecar_index` selects `/hits`,
`read_sidecar_conversation` `/messages`, `get_sidecar_folder_hierarchy`
`/nodes` and `get_sidecar_document` its `content`; mailboxes and search fields
select nothing (account-level). Result-level metadata is account-level for the
built-ins; another provider's `_meta` crosses only through an organization
allowlist of keys. Item-level metadata travels only with its approved item and
drives review headers, file provenance (the general case of
`outlookProvenance`) and policy input. Job-level metadata is the sidecar's own,
apart from the tool's `_meta`; policy findings stay native. Under strict,
`isError` text exports as a code with a fixed message, `priority` orders review
and windowing, `audience` is honored on export, and a `resource_link` exports as
a reference only.

## Egress under strict mode (stage 2)

Not implemented in 0.1.44. An export is the normal-mode result filtered to the
approved items: bytes for files, text bodies for conversation messages and
metadata for hits. An `.eml` embeds approved attachments and replaces each
unapproved one with an `X-Erato-Stripped-Attachment` marker; an attachment
approved alone exports on its own with its parent's provenance; nothing exports
twice; inline files are separate items, unselected by default. Approval pins a
digest and export re-reads the source, failing if it changed; the strict store
keeps no byte copies. Mailboxes and search fields need no review; folders, hits,
documents and conversations do (organization policy may later tune the folder
class). Upload policy runs on the selected set, over text extracted on click,
loaded per item and batched for select-all, after input shaping (formatting
stripped, a structured metadata preamble, windowing with a stated aggregation
rule) and before the decision request; the backend checks the received bytes
again. The current remote demo decision endpoint is a documented exception until
the embedded model lands. Review starts from catalogue metadata and extracts on
click; indexing persists no text. `declined`, `cancelled` and `expired` end a
call with a terminal tool error, shaped like the existing "do not retry" errors.

## Versioning

There is no profile string; `strict_snapshot_v1` has no successor. A client
reads the protocol package version and the discovery capabilities `strict`,
`jobs` and `providers` (`{id, tools, readOnly, egress, available}`); distribution
filters targets by minimum protocol version, replacing the transitional
`local_delegation_profile` gate. Strict mode is installed by the bootstrap's
`mode: "strict" | "standard"`; `sidecar.configure.v1` never sets or relaxes it.
Until stage 2, a strict bootstrap also carries the transitional `content_release:
"strict_snapshot_v1"`, which the sidecar honors when `mode` is absent, and the
`local_contexts.*`, `local_tasks.*` and `local_exports.*` methods, deprecated in
0.1.44, serve the transitional path below.

## Local MCP servers (reserved)

Not implemented. A `server` other than `sidecar` names a local MCP server the
organization declares; the device adds none to the catalogue on its own. Under
strict, an effectful tool (one without `readOnlyHint`) waits in
`awaiting_approval` before it runs, and an open-world server is refused unless
the organization marks its egress trusted. Its results are `content` blocks, the
general case of the built-ins' items. Package 0.1.44 reserves `server`,
`providers` and `awaiting_approval` only.

## Settings under strict mode

Settings stay available through their fixed methods, behind the same Origin
allowlist: `sidecar.configure.v1`, `indexing.status.v1`, `indexing.reset.v1`,
`sources.list.v1`, `outlook.list_mailboxes.v1`, `sidecar.status.v1`,
`sidecar.request_permission.v1` and `sidecar.open_data_directory.v1`. A strict
sidecar marks exactly these and `jobs.*` (not yet `jobs.review.v1`) enabled in
its live catalogue. Clients gate each settings view on that availability, so an
earlier strict sidecar that refuses them keeps a connection-only view. The calls
are not bound to a local context.

Their results carry account-level data only: account and store names and
addresses, Teams tenant and user identities, on/off, priority, indexing progress,
coverage counts and dates, permission status and codes. Message subjects,
senders, bodies, folder names, search results, documents and conversations never
appear. Local paths and free-text errors stay native: `indexing.status.v1` omits
`indexingDirectory` and returns only the documented discovery fields;
`sources.list.v1` returns the source ID as `sourceKey`, a null `discoveryCursor`
and a locator reduced to `mailboxId`, `tenantId` and `userId`;
`outlook.list_mailboxes.v1` reports an unreadable data file with a fixed message
and no path.

Configuration cannot relax strict mode. Allowed origins, TLS, the mode, the
transitional content release and the delegation trust policy come only from the
installed bootstrap; a strict sidecar drops these keys from submitted
configuration rather than persisting them. `signed_in_user` still selects the
work-account defaults. `search.*`, `sources.get_document.v1`,
`sources.get_folder_hierarchy.v1`, `outlook.get_conversation.v1`,
`outlook.list_emails.v1`, `outlook.search_emails.v1`, `sidecar.progress.v1`,
`indexing.benchmark.*` and `diagnostics.echo.v1` remain refused, as do the
unused `indexing.start.v1`, `indexing.stop.v1`, `sidecar.restart.v1` and
`erato.cancel`.

## Transitional strict snapshot path

The sections below describe the strict path of packages 0.1.28 to 0.1.43:
`local_contexts.*`, `local_tasks.*` and `local_exports.*`, the
`local_collect_evidence` tool, backend-signed plans and receipts and context
binding. It keeps working in stage 1 and is removed in stage 2, when strict
review on the job envelope replaces it. Where it differs from the sections
above, the sections above are the design.

### Execution scope

This profile trusts the installed native implementation and does not require a
new signed macOS sandbox application or OS/process confinement. Enforce exact
approval in native review/export APIs and
keep unapproved content out of the ordinary frontend and backend through those
checks. This profile does not claim OS-enforced egress prevention or protection
from compromised native code. Sandbox probes are not a delivery prerequisite.

Future dynamic/untrusted local code must run in WASM with explicitly controlled
host capabilities. The initial workflow executes bounded deterministic search
using existing native readers; it does not execute generated code or introduce
a WASM runtime. Build durable native jobs, native review/export, backend recovery
and the shared frontend in that order. Enable only after consent/ownership,
immutable export and recovery checks pass.

### Trust and rollout

Trust the OS, installed native broker/reviewer, pinned backend verification keys,
and authenticated backend. Source documents and network-facing frontend scripts
cannot authorize export. No native component stores backend access/refresh
tokens or opens a backend connection. A locally verified signed assertion is
an input, not a credential permitting native cloud access.

Before approval, content and derived metadata remain in trusted native
processes: subjects, senders, folders, filenames, snippets, documents, summaries,
counts, digests, traces and errors. Public status is exactly `handle` plus a
closed lifecycle `state`. No device-derived status, handle, error or timing is
submitted as a client-tool result or backend telemetry. The backend renders its
own persisted `waiting_for_local_result`; only local UI shows native progress.

After exact approval, plaintext enters the authenticated frontend. Recipient
binding then relies on that frontend; it is not cryptographic destination
control. OS/admin compromise and covert channels are outside this guarantee.

All `local_*` capabilities are disabled in the canonical catalogue and reference
server. A client must require `localDelegation.enforcement = enforced`, the exact
security profile and every v1 method enabled. Missing/unknown declarations or
partial catalogues fail closed, without raw RPC fallback. Advertising methods
alone is insufficient. The declaration identifies `trustModel = installed_native_code`; it does not
claim OS isolation. The reference server cannot issue native grants.
Production enablement additionally requires tested native consent/export,
durable backend checkpoints/results and the shared authenticated coordinator.
No platform is qualified by this contract change.

A strict-required installation refuses startup if native consent is unavailable.
It must never downgrade to legacy on a command-line mode, reset, restart,
missing helper, signature failure or unsupported OS. The RPC boundary denies
legacy content, progress, benchmark and diagnostic methods, and every method
outside the settings list and `jobs.*`, before running them. Native code must
route every public path through these checks, including alternate modes and
diagnostic serialization. Origin allowlisting or a frontend approval boolean
does not authorize an export.

Configuration delivery is an exception: clients do not use `localDelegation` to
gate `sidecar.configure.v1`. The installed sidecar decides whether it trusts outside
configuration calls and whether to take their values into account; it may reject
or ignore them. Sending configuration does not weaken native content/export
checks, and clients must respect sidecar rejection. See SPEC section 11 for
configuration replacement and preservation of saved user settings.

### Account and device authentication

`local_contexts.challenge.v1` creates a random 256-bit challenge with a five-minute
expiry and returns the opaque stable installation device ID: the value discovery
reports as `installationId` since package 0.1.43, not its restart-specific
instance ID. The challenge remains local. The device ID leaves the device as the
routing device of the executor bindings an Erato client sends its backend in
normal mode (ERMAIN-1086) and through the authenticated pairing API's explicitly
user-initiated device registration.
The challenge is bound to the caller's exact canonical Origin and OS user. The
frontend obtains a compact JWS assertion from its authenticated backend session.
It calls `local_contexts.bind.v1`; the installed backend key authenticates the
account assertion. Native export review always shows that backend/account.
Binding is not evidence-export approval. Binding returns a random
256-bit context handle, scoped to the OS user, Origin, backend/account and device.

JWS profile: EdDSA/Ed25519 only, `kid` selects an exact public key installed in
installed organization bootstrap; reject unknown keys, algorithms, headers, remote
key URLs and duplicate JSON keys. Never fetch a JWK URL from native. Claims use
`LocalContextClaims`, with canonical `http` or `https` `iss` and Origin, stable
backend subject `sub` (not email), exact audience, device, single-use challenge
and `jti`.
Check all bindings and `iat <= now < exp <= iat + 300`. Consume the challenge
atomically with context issuance. Handles expire no later than the assertion;
renew through fresh authentication, and revoke on unpairing. Lost bind responses
require a new challenge. Persist device identity in protected per-OS-user storage;
never clone it via a shared index, and keep it out of logs and diagnostics.
Discovery reports it to allowed origins only, as every discovery field.

Account changes discard frontend handles immediately. A newly authenticated
context can recover only its own backend/account/device jobs. Native must check
all context fields on every method. A guessed handle, wrong context, missing job
or cross-account lookup returns the same fixed permission-denied response.
Public RPC has no approve, grant creation or account-switch method.

### Start, identity and limits

The backend commits a generic operation attempt and the parked assistant
message before exposing a plan. `LocalTaskBinding` binds canonical backend origin, account, installation,
task, logical job, attempt, logical tool call and plan digest. IDs originating in
the backend are not derived from private sources. `local_tasks.start.v1` requires
a fresh signed `LocalJobClaims` assertion with the same issuer, subject, Origin,
binding, audience and five-minute time window. A context handle or forged binding
alone cannot start or adopt a job. The native worker verifies the immutable plan
against its signed digest before reading a source.

In the backend adapter, `jobId` is the generic operation attempt UUID and
`attemptId` is the original generation UUID captured when native authorization
is first issued. `taskId` is the delegated child chat UUID. Continuation may
acquire a new generation UUID without changing this frozen native binding.
The protocol wire version and signed field meanings remain unchanged.

The durable idempotency key is `(backendOrigin, accountId, deviceId, jobId,
attemptId)`. Identical binding/plan retries return the same handle; changed input
under that key is a fixed conflict. Retain terminal tombstones through the job's
expiry plus seven days so retries cannot silently recreate completed jobs. A new
attempt requires a new backend authorization; it never adopts an older export.

Plan v1 permits only deterministic `collect_evidence`: up to eight bounded
query variants, 100 hits, 20 artifacts, 12 MiB of decoded artifact bytes, and
300 seconds of execution. Native may impose lower limits, and must enforce the
aggregate byte limit, deduplication, elapsed time, memory and work limits itself.
No cloud fallback, local inference, arbitrary code, paths, URLs or Office writes.
Job review expiry is at most seven days after acceptance. Execution time excludes
review wait; expiry does not. UTC times are integer epoch seconds. Clock rollback
must not extend authorization: use persisted last-observed time as a lower bound.

Digests are SHA-256 over UTF-8 canonical JSON with recursively sorted keys,
compact punctuation, unchanged string values, no floats/NaN or duplicate keys.
Plan digest covers the complete `LocalTaskPlan`. Artifact digests cover decoded
bytes. Manifest digest covers the complete approved-export object with only
`manifestDigest` and every `contentBase64` member omitted. Arrays retain order.
Validate byte lengths, digests, unique artifact IDs and total decoded size in
addition to schema validation. Generated Rust types are not schema validators.

An artifact may carry `outlookProvenance`: the version 1 `OutlookFileProvenance`
of the message it came from, the email itself as `document` or an attachment's
containing message as `topLevelParent`. Native builds it from the hit's catalog
ID, external IDs and mailbox. The backend validates it as that contract, stores
it on the uploaded file so clients can offer **Open in Outlook**, and gives the
model the reference with the evidence, by identifiers only. It is a navigation
hint, never a grant. The approved-export schema declares it as an optional
artifact member referencing `outlook/file-provenance.schema.json`, so a malformed
member fails validation like any other; a member that passes the schema but names
no usable identity is dropped and the export stays valid.

### Native state and consent

Persist acceptance transactionally before returning a handle. Store job records
and immutable snapshots separately from replaceable search indexes. A killed
worker recovers queued/running work within its remaining persisted execution
budget. The native implementation commits snapshot bytes and their state together
in a separate SQLite database using WAL and FULL synchronization. Keep its directory
private to the OS user; expose no public file URLs. Unix permissions are 0700/0600;
Windows uses the installed user's private profile directory and inherited ACLs.
At-rest protection relies on those OS permissions and deployment-managed disk
encryption, not an application encryption key. Administrators, backups and other
code running as that OS user are within the stated trust assumptions. Enforce
storage quotas and expiry cleanup; do not claim forensic erasure from backups or
old filesystem pages.

Transitions:

- `queued -> running -> ready_for_review -> approved -> acknowledged`.
- `queued/running -> failed`; failures expose no source-bearing details.
- `ready_for_review -> declined` through private native UI only.
- Any unacknowledged active state may become `cancelled` or `expired`.
- Terminal states do not transition back; retry is a new authorized attempt.

`status` is read-only. `cancel` is durable and idempotent, fencing workers and
revoking grants. `review` merely opens the trusted native window. Pane closure
neither cancels an accepted job nor resolves consent. Repeated review requests
focus the existing window and do not mint grants. Sources are read and frozen
before review; source mutation cannot change the reviewed/exported bytes.

Native text-first review shows the authenticated backend/account and the exact
selected artifacts, metadata and bytes. EML approval includes all nested content;
reviewing an excerpt cannot authorize a full thread. Selection binds a private grant to artifact IDs in the frozen snapshot; omitted
items never enter the package. Editing/redaction is not supported in v1. Treat links, clipboard, download and
external-open as explicit separate releases. No remote resources or document
scripts. Public RPC never receives preview bytes or a private selection manifest.

The reviewer and store use an in-process private channel, or authenticated native
IPC when separated. No network RPC is capable of submitting a review decision. Only it creates a grant for the binding, snapshot/version, exact selection,
manifest digest, nonce, expiry and recipient. Grant identifiers exposed after
approval are not bearer authority. Existing always-allow settings never substitute
for this decision. Native grant validation and read/cancel/expiry must serialize.

### Export, receipt and recovery

`local_exports.status.v1` returns only the same closed job status. `read.v1`
requires a valid current context plus the persisted private grant. It returns
`ApprovedLocalExport` only after authorization, with the same export ID and bytes
on every retry. No grant parameter, browser approval bit or source re-read.
A decline, cancellation, revocation or expiry rejects every subsequent read.
Already released bytes cannot be recalled.

The frontend uploads the entire approved package through normal backend auth.
The single backend revalidates ownership, exact job/attempt/device, current permissions,
expiry and terminal state. It recomputes all hashes and enforces size limits.
A logged PostgreSQL transaction commits immutable result identity, attachment
finalization references, a durable receipt and continuation intent together.
An exact duplicate returns the original receipt; conflicting payload, export ID
or stale attempt is rejected. Attachment staging/finalization uses the same job,
export and artifact IDs so a lost upload response cannot create duplicate files.

`local_exports.ack.v1` accepts a backend-signed JWS `LocalExportReceiptClaims`,
verified using the pinned issuer key and exact binding/export/manifest. It does
not trust a frontend `uploaded: true`. Return `acknowledged` only after storing
the receipt; lost ACKs are safely retried. Delete package bytes only after that
commit, retaining the tombstone. Retain retired receipt verification keys through
the maximum job/tombstone lifetime. Receipts are durable facts, not expiring
bearer tokens; their signatures confer no backend API access.

### Backend continuation authorization decision

The task feature supports **one backend replica only**. Multiple concurrent
backend replicas and their qualification are outside this profile. Reuse the existing task lifecycle and generation ownership;
multiple frontend panes still require idempotent requests.

Choose **live re-authentication on resume** for v1. The stored-principal
design is not assumed implemented. No access/refresh token is persisted. Receipt
acceptance leaves a logged continuation intent, even if no generation can start.
An authenticated frontend's later resume request freshly revalidates the
subject/permissions and resumes through the existing chat-generation lifecycle.
The existing streaming generation loop runs under that live authorized context,
preserving normal stream events, guardrails, accounting and tracing. After
process loss the logged operation remains recoverable under the existing
generation lease. A database-only sweeper must
not reconstruct authority from a user ID. Upload and cloud continuation can wait
for an authenticated frontend to return.

Before releasing generation, persist the assistant message with a
`client_tool_pending` marker, unresolved calls, completed sibling results,
original tool selection/policies and consumed budgets. Reconstruct model context
through the shared approval-continuation replay; never persist a composed
`ChatRequest` or run a separate local-job generation loop. The generic operation
states are `pending -> claimed -> ready -> continuing -> completed`. Cancellation,
expiry and withdrawal create fixed server outcomes that become ready for the
same authenticated continuation. The local evidence kind withdraws further
collection for that logical turn after those outcomes.

Result acceptance, message writes and terminal commits check the existing
generation and attempt fences. The sidecar extension contains only immutable
native binding/plan and receipt data. No separate continuation lease, heartbeat
or scheduler is introduced. Live oneshots and UNLOGGED generation commands are
never the durable authority. Receipt delivery stays recoverable for seven days
after expiry, including after cloud completion; native acknowledgements and
native lifecycle statuses are not uploaded as backend telemetry.

Coordinate parent result delivery with `task_delivery.rs`.
Orphan reconciliation must recognize this durable parked state as
live pending work. Archive/cancel/withdraw atomically fence continuation and
reject late results; do not reinterpret them as current attempts. A dedicated
read-only child tool requires explicit scope/depth/budget authorization; generic
client tools remain suppressed. The shared shell coordinator, independent of
selected chat, reconciles auth/account/focus/reconnect and uses backend claims
plus native idempotency across browsers and Office views.

### Qualification gate

Require native secret-marker/RPC tests, inert text-only previews and coverage
of every public content/metadata path. Qualify existing Windows/macOS packaging,
cache access and native review invocation; report untested Office hosts honestly.
A URI launcher carries no content, token or export credentials. OS sandbox,
network/IPC confinement and new macOS signing work are outside this scope.

Then qualify native process death at every persistence boundary, immutable
selection/source mutation, account/device/job mismatch, expiry/cancel races,
lost receipts, duplicate uploads, pane closure and single-backend restart recovery.
Contract/mock tests alone do not meet these exit conditions. Strict delegation
stays disabled until the paired implementations and qualification are complete.

### Initial backend execution scope

The first integration offers `local_collect_evidence` only to explicitly opted-in
asynchronous task children at depth one, with a positive frozen client-call
budget and an exclusive local-research tool scope. The task's selected facet must
name `erato/local_collect_evidence` exactly. Wildcards, ordinary chats, assistant mentions,
awaited children, adopted runs, MCP tools and general Office actions do not acquire
this capability. Async results use the existing durable parent-delivery/rearm path.
This initial scope avoids claiming restart-safe execution of arbitrary external
tool effects. It can be widened only with matching checkpoint/approval recovery.

Approved artifacts use immutable storage keys derived from job/export/artifact
identity and content hash. SQL attachment links, exact package, signed receipt and
continuation intent commit together. A crash before SQL commit can leave an
unreferenced approved blob; retry reuses its key. Deployment storage lifecycle
must account for these orphan blobs without deleting committed attachments.

Cancellation may name either the native handle or the cloud-known binding and
plan. The latter atomically creates a cancelled tombstone without executing the
plan, so a lost start response or closed pane cannot prevent cancellation or let
a delayed start resurrect the job. Never implement this as start-then-cancel.
Completed cloud jobs retain receipts for reconciliation through paginated owner
queries, covering a lost native acknowledgement after continuation has finished.

Backend validators use the generated `backend/generated/local_delegation_schemas.json`
bundle so the existing backend Docker build context remains self-contained.
`pnpm run generate` refreshes it from these canonical schemas, and
`pnpm run check:generated` detects drift.
