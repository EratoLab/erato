# Strict snapshot delegation, contract v1

Status: reserved, disabled. ERMAIN-862 / ERDSCAR-9. Package 0.1.26 extends
0.1.25; the latter is identical in both repositories and retains `external_ids`
and `topLevelParent`. Transport protocol remains 1.0. This document is the
shared design record. It does not certify a security implementation.

## Trust and rollout

Trust the OS, signed native broker/reviewer, pinned backend verification keys,
and authenticated backend. Source documents and network-facing frontend scripts
cannot authorize export. No native component stores backend access/refresh
tokens or opens a backend connection. A locally verified signed assertion is
an input, not a credential permitting native cloud access.

Before approval, content and derived metadata remain in confined native
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
alone is insufficient. The reference server cannot claim native confinement.
Production enablement additionally requires qualified signed native artifacts,
durable backend checkpoints/results and the shared authenticated coordinator.
No platform is qualified by this contract change.

A strict-required installation refuses startup if confinement is unavailable.
It must never downgrade to legacy on a command-line mode, reset, restart,
missing helper, signature failure or unsupported OS. The RPC boundary denies
legacy content, metadata, configuration, progress and diagnostic methods before
running them. The process launch boundary must independently cover cache readers,
extractors/descendants, native UI, crash handlers and alternate executable modes.
A CSP, Origin allowlist or frontend approval boolean is not this boundary.

## Account and device authentication

`local_contexts.challenge.v1` creates a random 256-bit challenge with a five-minute
expiry and returns an opaque stable installation device ID (not discovery's
restart-specific instance ID). Device ID and challenge remain local except for
the authenticated pairing API's explicitly user-initiated device registration.
The challenge is bound to the caller's exact canonical Origin and OS user. The
frontend obtains a compact JWS assertion from its authenticated backend session.
It calls `local_contexts.bind.v1`; native UI confirms the backend/account when
first pairing. This is not evidence-export approval. Binding returns a random
256-bit context handle, scoped to the OS user, Origin, backend/account and device.

JWS profile: EdDSA/Ed25519 only, `kid` selects an exact public key installed in
signed organization bootstrap; reject unknown keys, algorithms, headers, remote
key URLs and duplicate JSON keys. Never fetch a JWK URL from native. Claims use
`LocalContextClaims`, with canonical HTTPS `iss` and Origin, stable backend
subject `sub` (not email), exact audience, device, single-use challenge and `jti`.
Check all bindings and `iat <= now < exp <= iat + 300`. Consume the challenge
atomically with context issuance. Handles expire no later than the assertion;
renew through fresh authentication, and revoke on unpairing. Lost bind responses
require a new challenge. Persist device identity in protected per-OS-user storage;
never clone it via a shared index or include it in general discovery telemetry.

Account changes discard frontend handles immediately. A newly authenticated
context can recover only its own backend/account/device jobs. Native must check
all context fields on every method. A guessed handle, wrong context, missing job
or cross-account lookup returns the same fixed permission-denied response.
Public RPC has no approve, grant creation or account-switch method.

## Start, identity and limits

The backend commits a logical job and execution checkpoint before exposing a
plan. `LocalTaskBinding` binds canonical backend origin, account, installation,
task, logical job, attempt, logical tool call and plan digest. IDs originating in
the backend are not derived from private sources. `local_tasks.start.v1` requires
a fresh signed `LocalJobClaims` assertion with the same issuer, subject, Origin,
binding, audience and five-minute time window. A context handle or forged binding
alone cannot start or adopt a job. The native worker verifies the immutable plan
against its signed digest before reading a source.

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

## Native state and consent

Persist acceptance transactionally before returning a handle. Store job records
and immutable snapshots separately from replaceable search indexes. A killed
worker recovers queued/running work within its remaining persisted execution
budget; snapshot creation uses a temp file, fsync, atomic rename and database
commit before making it reviewable. Keep snapshot files private to the OS user;
no public file URLs. At-rest encryption/key storage, quotas and retention cleanup
must be qualified with the platform implementation before availability is enabled.

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
reviewing an excerpt cannot authorize a full thread. Selection/redaction creates
a new immutable snapshot for review. Treat links, clipboard, download and
external-open as explicit separate releases. No remote resources or document
scripts. Public RPC never receives preview bytes or a private selection manifest.

The private reviewer-to-store channel authenticates the signed process and OS
session. Only it creates a grant for the binding, snapshot/version, exact selection,
manifest digest, nonce, expiry and recipient. Grant identifiers exposed after
approval are not bearer authority. Existing always-allow settings never substitute
for this decision. Native grant validation and read/cancel/expiry must serialize.

## Export, receipt and recovery

`local_exports.status.v1` returns only the same closed job status. `read.v1`
requires a valid current context plus the persisted private grant. It returns
`ApprovedLocalExport` only after authorization, with the same export ID and bytes
on every retry. No grant parameter, browser approval bit or source re-read.
A decline, cancellation, revocation or expiry rejects every subsequent read.
Already released bytes cannot be recalled.

The frontend uploads the entire approved package through normal backend auth.
Any replica revalidates ownership, exact job/attempt/device, current permissions,
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

## Backend continuation authorization decision

Choose **live re-authentication on resume** for v1. ERMAIN-759's stored-principal
design is not assumed implemented. No access/refresh token is persisted. Receipt
acceptance leaves a logged continuation intent, even if no generation can start.
An authenticated frontend's later resume request can reach any replica, freshly
revalidate subject/permissions and claim the intent plus chat lease atomically.
A worker runs under that live authorized context. After process loss or expired
lease it returns to `awaiting_authenticated_resume`; a database-only sweeper must
not reconstruct authority from a user ID. Upload and cloud continuation can wait
for an authenticated frontend to return, as the issues explicitly allow.

Checkpoint before releasing generation: model replay context, assistant message
and pending tool call, completed sibling calls/results, pending batch order,
effective facets/tool policy, origin/child ownership, consumed model/tool budgets,
logical attempt and expiry. Resume never replays completed side effects or resets
budgets. Use monotonically increasing fencing tokens; every checkpoint/result,
message write and terminal commit checks the current token and chat lease.
Persisted progress after a crash advances the same checkpoint. Never use live
oneshots or UNLOGGED generation commands as the source of truth.

Coordinate parent result delivery with `task_delivery.rs` and ERMAIN-762.
ERMAIN-765's orphan reconciliation must recognize this durable parked state as
live pending work. Archive/cancel/withdraw atomically fence continuation and
reject late results; do not reinterpret them as current attempts. A dedicated
read-only child tool requires explicit scope/depth/budget authorization; generic
client tools remain suppressed. The shared shell coordinator, independent of
selected chat, reconciles auth/account/focus/reconnect and uses backend claims
plus native idempotency across browsers and Office views.

## Qualification gate

Require native secret-marker/RPC and TCP/UDP/DNS/local-proxy/accepted-socket
escape tests, descendants, malicious previews and every executable mode. Run
packaged Windows/macOS cache access and review tests; Linux remains unavailable
without equivalent enforcement. Sign nested helpers before the personalized
outer app; validate identities and entitlements and notarize production macOS
artifacts. A URI launcher carries no content, token or export credentials.

Then qualify native process death at every persistence boundary, immutable
selection/source mutation, account/device/job mismatch, expiry/cancel races,
lost receipts, duplicate uploads, pane closure and two-replica fenced recovery.
Contract/mock tests alone do not meet these exit conditions. Strict delegation
stays disabled until both issues' implementation and qualification are complete.
