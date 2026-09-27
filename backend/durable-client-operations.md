# Durable client operations

Status: dark foundation. There are no production operation kinds registered in this PR.
Baseline: main `de31f87c`; downstream sidecar branch `198f9272`.

## Boundaries and compatibility

A returning client tool keeps its existing SSE/oneshot fast path. Only a compiled,
registered operation kind may escalate to a durable attempt. The feature flag alone
cannot make arbitrary configured client tools durable. Each kind validates inputs,
bindings and results on the server and determines consent and cross-device policy.
Read-only/idempotent executors may retry; this mechanism does not authorize mutations.

A durable attempt is a logged database record, independent of a replica or browser
pane. The account comes from authentication. Device and host-context identifiers
come from the installed client, not model arguments. They prevent accidental
cross-context execution; they are not device attestation. A kind such as native
local research must additionally verify its own signed binding and native receipt.
Capability registration is an availability check, never authorization.

`operation_id`, `attempt_id`, `base_revision`, `input`, `outcome` and `executor`
follow the Workflow contract v0 envelope. Workflow instance/definition/dependency
fields are deliberately absent until a workflow owns them. The chat and assistant
message identify today's logical turn. Result payloads are `value`, `reference` or
`receipt`, accepted only through the registered kind's typed validator.

## Lifecycle

1. Dispatch assigns one attempt identity in memory. No new database round trip is
   added to a successful fast call. Eligibility requires a registered kind and a
   captured executor binding.
2. Loss of the originating stream or expiry of its execution window escalates the
   same attempt. In one transaction, verify generation ownership, persist settled
   message parts, pending calls and consumption, and insert the attempt. Only then
   may the generation release its lease as `awaiting_approval`.
3. Account-scoped discovery is read-only and excludes another account's attempts.
   Claim checks the executor registration, realm and host identity. A permitted
   change of device requires explicit user confirmation even for `consent: none`.
   Native consent remains the native kind's responsibility.
4. Result acceptance checks the claim fence, expiry, input revision and validator.
   Duplicate identical results are successful no-ops; different replacements fail.
   Committing the result makes continuation durable and discoverable. It does not
   imply that an inference call has started.
5. A returning authenticated frontend requests continuation. Any backend replica
   may acquire the existing generation lease and run the existing continuation
   pipeline on the same assistant message. Current authorization is rechecked. No
   access token, refresh token or long-lived principal is persisted.
6. A crash leaves either an open attempt or a committed result. Reconciliation
   uses the logged record and the existing generation identity/heartbeat fence,
   never the UNLOGGED command queue. Cancellation/expiry settles the pending part;
   late results cannot resurrect a terminal attempt.

The message row is the only derivation of model history: unresolved generation
input plus `replay_assistant_content`. Attempts never store composed ChatRequests.
The selected qualified client tools and submission policies, together with consumed
budgets/counters, are retained for the logical turn. Current allowlists, registration
requirements and delegated-child restrictions still apply on continuation. A kind
must explicitly authorize a bound child operation; no parent-to-child SSE relay is
introduced.

## Rollout prerequisites and current limits

The generic coordinator lands as an extraction during the #1237 rebase, alongside
its first actual handler. A separate neutral frontend PR is not required. Before
any production enablement that integration must provide authenticated-shell
list/claim/execute/result/continue handling, executor headers on submission,
`client_tool_pending` presentation, account/view lifecycle handling, and the
native consent/receipt flow. This PR supplies backend APIs and generated types;
it does not supply that UI or register a production kind.

After a durable park, continuation is detached. Further registered client calls
enter the inbox immediately. Attached continuation is still required before this
mechanism is suitable for Word-style sequences of fast client calls; the sidecar's
single-operation leaf is the first supported production shape.

Registering a configured operation kind makes a valid `X-Erato-Executor` binding
mandatory for that tool when the flag is enabled. Roll out the coordinator/header
support before enabling the kind. Synthetic kinds supply a binding through their
server-owned offer policy; they must derive it from authenticated context, never
model arguments. Kind registration is not permission to invent an unbound device.

`user_confirmed` consent and device/host identifiers are client assertions, at the
same trust level as existing client actions. Kinds requiring stronger proof must
validate it themselves, as the native kind does with signed binding and receipts.
The current attempt expiry is 24 hours and the claim lease is five minutes bounded
by that expiry; they are not yet configurable per kind.

Inbox `after` is a cursor for one sweep, ordered by random attempt UUID. Concurrent
inserts may sort before that cursor. A coordinator must restart every subsequent
sweep without `after`, and must not treat the cursor as a durable high-water mark.
Discovery is eventually complete across sweeps, not a snapshot or change feed.

Malformed fast results from the authenticated, bound executor become fixed
per-call validation feedback, including results racing escalation. Raw payloads
and validator errors are not echoed to the model. Wrong identities/bindings remain
HTTP refusals; claimed durable results continue to require kind validation.
Continuation resolves original tool identities against current configuration and
re-prepares their schemas/timeouts. It retains consumed counters and never raises
the original submission limit or removes submission semantics during that turn.

## Downstream sidecar rebase checklist

* Delete `message_streaming/local_jobs.rs`'s request reconstruction/launch path;
  its separate non-streaming model loop was already removed before this baseline.
* Delete `services/local_delegation::Checkpoint` and its composed ChatRequest.
* Replace `local_delegation_jobs` and generic portions of `local_delegation/store.rs`
  with operation attempts; keep native challenge/binding, export and receipt data
  in the local-evidence kind's payload/extension.
* Replace local-job recovery/launch hooks in `background_tasks.rs` with the generic
  lease/continuation path. Keep task-parent delivery using the existing lifecycle.
* Register `erato/local_collect_evidence` as the first kind using `tool_offer`.
  The compiled descriptor needs no `[client_tools.tools]` entry. Its async leaf,
  exclusive scope, depth-one restrictions and binding decision belong in that
  kind's offer policy, rechecked on continuation. The shared hook enforces the
  reserved namespace, exact registry identity, allowlist, binding shape/realm and
  name collisions. Ordinary configured client tools remain suppressed in children.
  Synthetic operations enter the inbox directly without emitting client-call SSE.
* Keep `contract.rs`, signing, export validation and upload authorization specific
  to local evidence. Reuse the already cached signer and transaction-aware uploads.
* Extract generic discovery/capability routing from `LocalTaskCoordinator`; keep
  challenge → bind → native start/status/review/read → complete/ack in its handler.
* Keep native consent gating of legacy RPCs and startup/settings metadata paths.
* Protocol 0.1.28 target: use the generic attempt UUID in the existing logical job
  identity field. No new native consent, receipt or export format is required.
* Renumber the downstream migration after this foundation and regenerate sources.
* Retain single-replica eligibility for the sidecar task kind; the neutral mechanism
  and ordinary-chat continuation use the existing cross-replica generation lease.

### Files to remove or reduce from the downstream diff

| File | Downstream change |
| --- | --- |
| `backend/erato/src/server/api/v1beta/message_streaming/local_jobs.rs` | Delete private checkpoint/reconstruction/launch; keep any small kind dispatch adapter with the kind. |
| `backend/erato/src/services/local_delegation/mod.rs` | Delete `Checkpoint` and private `Consumption`. |
| `backend/erato/src/services/local_delegation/store.rs` | Remove generic job state/recovery/continuation; retain only native binding, export, and receipt transactions. |
| `backend/erato/src/db/entity/local_delegation_jobs.rs` | Replace with a narrow sidecar extension keyed by the generic attempt, if required. |
| `backend/sqitch/{deploy,revert,verify}/0051_add_durable_local_delegation.sql` | Replace/renumber for that narrow extension; remove private checkpoint and job lifecycle columns. |
| `backend/erato/src/server/api/v1beta/local_delegation.rs` | Remove private list/cancel/resume routing; retain native challenge/binding and approved upload/receipt endpoints. |
| `backend/erato/src/server/api/v1beta/message_streaming.rs` | Remove local-checkpoint seed/persistence hooks; use generic park and message replay. |
| `backend/erato/src/services/background_tasks.rs` | Remove `ResumeLocalJob` takeover and local-table recovery hooks. |
| `backend/erato/src/models/chat.rs` | Remove private local-job liveness SQL. |
| `backend/erato/src/services/delegation.rs` | Use the shared durable-stop predicate, keeping the existing parent delivery lifecycle. |
| `frontend/src/lib/desktopSidecar/localTaskCoordinator.ts` | Move discovery, claim lifecycle and continuation into the generic coordinator; retain native handling as a kind. |
| `frontend/src/providers/LocalTaskCoordinator.tsx` | Share shell lifecycle/polling; retain the native review presentation in the kind. |
| Corresponding coordinator and delegation integration tests | Replace private job fixtures with attempts; keep native privacy/export regressions. |
| Backend OpenAPI and frontend generated API files | Regenerate to remove private lifecycle APIs and consume generic operation APIs. |

The protocol schemas, generated local RPC types, consent/export validators,
signer, and upload helpers are retained. The native binding currently distinguishes
`jobId` and `attemptId`; preserve their existing signed meanings at the adapter and
map the generic attempt UUID to the backend job identity. Do not rename signed
fields merely to match the database table. Verify the exact mapping against native
#68 before any protocol version change.

The foundation must land before #1237's final rebase. Publishing drafts is
independent of merging: this work does not authorize a merge or deployment.

References: Workflow contract v0 (Linear eb6c078d27a0), Delegation Foundations
(c7ac285ded0d), ERMAIN-854 counter/selection continuity. This does not implement
ERMAIN-759's general command queue, ERMAIN-762's orphan parent-card reconciliation,
or ERMAIN-765's general interrupted-tool reaper.
