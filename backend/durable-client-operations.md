# Durable client operations

Status: dark shared mechanism. Native local evidence is its first compiled kind,
registered only when its separate disabled-by-default configuration is enabled.

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

The generic coordinator is extracted alongside the native local evidence handler.
See [the sidecar integration record](local-evidence-operations.md) for the
adapter, trust boundaries and completed rebase checklist. The integration supplies
account-scoped discovery, claim/result/continuation, executor headers,
`client_tool_pending` presentation, shell lifecycle handling and native review.
Real-host qualification is still required before enablement.

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

## Consent, withdrawal and crash accounting

Only `consent: none` can use the in-memory fast path. `ask` and `native`
operations enter account discovery immediately without a client-call SSE. Neither
can accept an unclaimed legacy/fast result. `ask` requires claim confirmation;
`native` additionally requires the kind's proof validator, not a confirmation bit.

Claim and first durable-result acceptance share current authorization checks:
account/chat access, recorded qualified identity, current configuration and facet
allowlist, registration requirements, and the synthetic kind's offer policy.
Withdrawing an open operation settles a fixed `withdrawn` outcome; unaccepted
executor content is discarded. Results committed before withdrawal remain history
and support identical retries, even if the kind was removed. Continuation may
replay those results but will not re-offer the withdrawn tool. Authorization is
checked against the handling replica's configuration; replicas must receive the
same policy updates. A claim cannot retract execution already started on a client.

Each logical tool call has a persisted charge record. Recovery reuses its tool and
submission charges, task-budget decision, operation UUID and expiry; it does not
mint another correction attempt or charge the parked loop iteration twice. Charges
and pending calls commit together before dispatch. This is not an exactly-once
external-effects guarantee: executors still need idempotency under the stable call
or attempt identity. The initial kinds remain read-only/idempotent.

The disabled durable flag does **not** disable changes shared with existing
approval continuation: original client tools are restored, logical-turn counters,
task budgets and the one-client-action flag are retained, and the original model
must still be configured and authorized. Delegation stop detection now validates
the complete message schema; malformed rows are not classified as approval stops.
The named client-tool map remains `generation_parameters.client_tools` for replay
policy consumers.

`client_operations::joint_replay_*` runs the two-turn page/draft/rejection,
restart, duplicate-result and withdrawal scenarios on this branch and the combined
#1250 tree. Without replay configuration support it asserts full historical replay;
with #1250 it enables receipts and asserts earlier pages/drafts are compacted while
the current turn's pages, both drafts and diagnostics survive. The checkpoint crash
test separately kills a spawned generation immediately after its real charge write,
then recovers through the production lease and continuation path on another state.
These simulate worker loss; they do not claim OS-process-kill qualification.

## Local evidence integration

The completed [rebase delta](local-evidence-operations.md) records the removed
private checkpoint, job lifecycle and continuation paths. The native kind uses the
shared attempts table, with a narrow export/binding extension. Its offer policy
retains the single-replica, async-leaf, exclusive-scope and depth-one restrictions.
Ordinary configured client tools remain suppressed in delegated children.

Protocol 0.1.28 keeps its existing signed fields: native `jobId` is the generic
attempt UUID; native `attemptId` retains the original generation UUID. No native
consent, receipt or export format changed for the shared-operation integration.

References: Workflow contract v0 (Linear eb6c078d27a0), Delegation Foundations
(c7ac285ded0d), ERMAIN-854 counter/selection continuity. This does not implement
ERMAIN-759's general command queue, ERMAIN-762's orphan parent-card reconciliation,
or ERMAIN-765's general interrupted-tool reaper.
