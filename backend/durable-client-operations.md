# Durable client operations

Status: dark shared mechanism with two kind families. Native local evidence is a
compiled kind, registered only when its separate disabled-by-default configuration
is enabled. The configured `client_tool.v1` kind (ERMAIN-911) is registered once per
client tool that opts in; its first opt-in is Outlook `fetch_availability`. Both stay
inactive until `client_tools.durable_operations_enabled` is on.

## Boundaries and compatibility

A returning client tool keeps its existing SSE/oneshot fast path. Only a compiled,
registered operation kind may escalate to a durable attempt. The feature flag alone
cannot make arbitrary configured client tools durable. Each kind validates inputs,
bindings and results on the server and determines consent and cross-device policy.
Configured tools have exactly one compiled kind, `client_tool.v1`. The registry
holds one instance per `[client_tools.tools.<id>.durable]` table, keyed by the
tool's qualified name. Configuration selects the tool and a compiled host family,
never an executor, realm or device. Its results pass the generic validator plus an
optional configured `result_schema`.
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

1. Dispatch assigns one attempt identity in memory. Successful fast calls create
   no attempt row. Eligibility requires a registered kind and a
   captured executor binding. For a configured kind, the #1268 per-tool decision
   gate runs first, and the binding must carry the kind's host family. Without one,
   the call keeps the in-memory path described under bindings below.
2. Loss of the originating stream or expiry of its execution window escalates the
   same attempt. In one transaction, verify generation ownership, persist settled
   message parts, pending calls and consumption, and insert the attempt. Only then
   may the generation release its lease as `awaiting_approval`.
3. Account-scoped discovery is read-only and excludes another account's attempts.
   Claim checks the executor registration, realm and host identity. A permitted
   change of device requires explicit user confirmation even for `consent: none`.
   Native consent remains the native kind's responsibility. `client_tool.v1` permits
   no change of device, so only the same device and mailbox can claim it. Claim
   re-reads the user's decision for the tool; `never_allow` withdraws the call.
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
introduced. The executor stream below is no relay either: a delegated child gets
configured client tools only through the grant its client task was launched with
(ERMAIN-1001, [design record](delegated-client-tools.md)). A granted call is never
a durable operation: it goes live over the executor stream or ends as
`context_unavailable`, even for a tool with a `durable` table.

## Rollout prerequisites and current limits

The generic coordinator is extracted alongside the native local evidence handler.
See [the sidecar integration record](local-evidence-operations.md) for the
adapter, trust boundaries and completed rebase checklist. The integration supplies
account-scoped discovery, claim/result/continuation, executor headers,
`client_tool_pending` presentation, shell lifecycle handling and native review.
Real-host qualification is still required before enablement.

The coordinator runs its built-in handlers (local evidence) beside a shared handler
registry that any shell may populate; today only the Outlook add-in registers one,
for `fetch_availability`. It picks a handler by `kind` and
the handler's optional `matches(request)`. The generic handler matches its tool's
bare name in any namespace, as the live call's executor lookup does, because the
namespace is deployment configuration. A handler's `defer(request)` skips the
claim while the same JS context still runs the live call or posts its result.
Panes and tabs of one browser share the device id, so the server would give them
the same claim token. A Web Lock named after the message and tool call keeps one
execution per browser: a coordinator takes it only when it is free, and the live
path holds it while a call with an operation executor runs and posts. Without Web
Locks every context runs, as before. A POST that settles the unclaimed attempt
through the fast path answers `stored: true`, and only then does the pane request
a sweep, so a drop on the same pane resumes without waiting for the 10 s poll. A
`client_tool_pending` part also requests a sweep, for a pane whose executor is not
running. That sweep can race the generation's release after the park; the server
refuses the claim (409) until the release lands, and the coordinator retries it
once after 1.5 s before leaving the attempt to the poll (a claim refused again,
for example one another pane holds, is not retried early). A pane without a
matching handler leaves the operation for another. The web app registers no
`client_tool.v1` handler, so only the add-in continues these attempts; a
continue-only fallback for other tabs would be a separate decision.

An interactive executor continues a settled `consent: none` operation with
`Accept: text/event-stream`, its `X-Erato-Executor` binding and current
`X-Erato-Client-Tools`. The coordinator consumes this SSE response and answers
later live calls even without an open chat view. Continuation uses the same
assistant message, generation pipeline and saved consumption. Clients without
the SSE Accept header retain detached JSON continuation; native/ask consent
remains inbox-only.
Expired pending/claimed operations use detached continuation even when the
original executor is unavailable or the observing pane has a different binding;
the server authors the expiry without executing the client tool. Ready/continuing
operations still require the matching executor for attached continuation.

`client_operation_transports` holds one logged ownership row per chat, fenced by
the active generation and a server-assigned transport UUID. Eligible configured
tools establish it before inference, so `resumestream` can acquire it on either
replica before the first call. A matching device, realm, host context and tool
registration may acquire a free or expired lease. The first successful claimant
owns durable execution; competing streams receive output but no durable client-call
events. Non-durable calls retain their existing delivery behavior.
The original stream's closure does not displace a successor. Existing per-call
Web Locks and attempt/result fences remain necessary.

The response body renews ownership every five seconds, with a twenty-second
expiry. Dropping it releases only its own token; replica loss expires the lease.
An eligible observer retries acquisition every second, so a reconnect that
arrives before the previous stream releases ownership can still take over.
Only acquired leases are renewed; ordinary streams do not arm a heartbeat timer.
While waiting for an eligible durable call the worker checks shared ownership
every 100 ms, and parks through the existing transaction if ownership is gone.
An ownership read error is retried rather than treated as a disconnect. Ownership
initialization still fails closed on a database error, since the write may have
committed and another stream could acquire that row.
Ownership adds one row initialization per eligible generation, heartbeat writes
and ownership reads around client-call delivery/waits. Generations without an
eligible durable tool retain their existing client-tool behavior. Word reads can
use the same ownership with a `word_document` binding. A live-only validated
submission in a generation using shared ownership is delivered only to the owner.
If no owner exists at dispatch, it ends immediately with an unresolved
`context_unavailable` outcome; prior validation refusals keep their own outcome.
Once dispatched, the result waiter survives a reconnect: ownership is checked
every second, and only fifteen seconds of continuously observed absence ends it
as `context_unavailable`. A recovered owner resets this grace period; result
delivery, explicit abort and the tool's original timeout remain effective during
it. Other non-durable calls retain their existing delivery and timeout behavior.

A kind with `requires_binding()` (local evidence and compiled test kinds) makes a
valid `X-Erato-Executor` binding mandatory when the flag is enabled; without one
the call fails. `client_tool.v1` does not require it. Its call keeps today's
in-memory path in these cases:

- no binding, from an older cached bundle, from Teams, or because conflicting
  executor bindings dropped the header;
- a binding of another realm or host family, such as a ready sidecar's;
- invalid input;
- an approval answered from another executor, with a different or no header.
  This keeps every decision-gated call of that continuation in memory, not only
  the approved one.

Roll out the coordinator/header support before enabling a kind. The live
`clienttoolresult` POST carries the tool's own executor header. An executor that
yields leaves the shared submit header to a non-yielding one, which keeps the
sidecar binding authoritative for local evidence. Synthetic kinds supply a binding
through their server-owned offer policy; they must derive it from authenticated
context, never model arguments. Kind registration is not permission to invent an
unbound device.

`user_confirmed` consent and device/host identifiers are client assertions, at the
same trust level as existing client actions. Kinds requiring stronger proof must
validate it themselves, as the native kind does with signed binding and receipts.
The Outlook mailbox binding is client-asserted routing that carries only a digest
of the mailbox address. Attempt expiry and claim lease are per kind, and the
lease is bounded by the expiry. Local evidence keeps 24 hours and five minutes,
which its signed plan requires. Configured tools use `attempt_expiry_secs` and
`claim_lease_secs` (defaults 3600 and 120; the lease is at least 60 seconds).
Expiry counts from dispatch, because the identity is persisted before the call
runs so that a crash resumes it; a timeout park therefore needs an expiry that
covers `timeout_ms` plus the lease.

Inbox `after` is a cursor for one sweep, ordered by random attempt UUID. Concurrent
inserts may sort before that cursor. A coordinator must restart every subsequent
sweep without `after`, and must not treat the cursor as a durable high-water mark.
Discovery is eventually complete across sweeps, not a snapshot or change feed.

Malformed fast results from the authenticated, bound executor become fixed
per-call validation feedback, including results racing escalation. Raw payloads
and validator errors are not echoed to the model. Wrong identities/bindings remain
HTTP refusals. Claimed durable results of a kind with `settle_invalid_claimed()`,
which `client_tool.v1` sets, also settle as fixed feedback, so an executor cannot
loop on its own malformed output. Local evidence keeps refusing them with 400.
An opted-in call's fast result passes the kind validator too, so the model sees
the kind's `{"status":"success","result":…}` wrapper on both paths.
`OperationError.message` (at most 1024 characters, control characters replaced)
is forwarded only by `client_tool.v1`, matching legacy client-tool errors. Like
them, it reaches tool-call telemetry. For Outlook, `rejected` carries only `validation_failed` and fixed text, on the
live path too. The Word family also accepts `error.validation` with `issues` and
optional `feedback`, using the existing client validation parser: at most 16 issues,
512 characters per path/message and 64 per code. The diagnostic envelope is capped
at 64 KiB. Lost-capture `cannot_continue` feedback on a parked recovery read stops
correction before any further inference; successful reads preserve its counters.
An expired recovery read stops correction with the same `timeout` reason as an
inline read timeout.
Continuation resolves original tool identities against current configuration and
re-prepares their schemas/timeouts. It retains consumed counters and never raises
the original submission limit or removes submission semantics during that turn.

## Consent, withdrawal and crash accounting

Only `consent: none` can use the in-memory fast path. `ask` and `native`
operations enter account discovery immediately without a client-call SSE. Neither
can accept an unclaimed legacy/fast result. `ask` requires claim confirmation;
`native` additionally requires the kind's proof validator, not a confirmation bit.

Per-tool decisions (#1268) interact with kinds in two ways. A compiled kind asks
through its own consent policy, so a saved `ask` decision runs it. A configured
kind keeps the user's decision: `ask` shows the approval card before dispatch,
and a call that runs (no decision, `always_allow`, or an approved `ask`) escalates
with consent `none` and keeps the live fast path. `never_allow` is filtered from
the offer and refused at dispatch. Saved while the live call waits, it settles the
call in memory as `withdrawn` on timeout or stream loss instead of parking it.
Saved after a park, it withdraws the call at claim, at the first claimed result
and at a late fast result. An `ask` or `always_allow` saved after an approved run
does not prompt again; the call may complete later on the same device and mailbox
(owner decision, 2026-10-11).

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
policy consumers. With the flag off no configured kind is registered. The add-in
still sends its hashed mailbox binding; nothing reads it.

`client_operations::joint_replay_*` runs the two-turn page/draft/rejection,
restart, duplicate-result and withdrawal scenarios on this branch and the combined
#1250 tree. Without replay configuration support it asserts full historical replay;
with #1250 it enables receipts and asserts earlier pages/drafts are compacted while
the current turn's pages, both drafts and diagnostics survive. The checkpoint crash
test separately kills a spawned generation immediately after its real charge write,
then recovers through the production lease and continuation path on another state.
These simulate worker loss; they do not claim OS-process-kill qualification.

`client_tool_operations::*` covers `fetch_availability` through the production
registry builder and the mock LLM:

- a dropped stream parks and a second tab on another replica resumes the turn;
- the timeout parks with the configured expiry and lease;
- a live result creates no attempt and is fenced by binding;
- claims require the same device and mailbox;
- duplicate and late results are fenced, and expiry continues as `expired`;
- malformed results settle as fixed feedback, and executor error text is bounded;
- `ask` shows the card and an approved call parks with consent `none`;
- a rejected call creates no attempt;
- an approval from another executor keeps the legacy path;
- `ask` saved after a park does not block the claim;
- `never_allow` is neither offered nor escalated, saved during the live wait it
  settles the call in memory as `withdrawn`, and it withdraws a parked call at
  claim, at its first claimed result and at a late fast result;
- a sidecar binding, a missing binding, a tool that does not opt in and the
  disabled flag all keep the in-memory path.

`client_operations::ask_decision_does_not_gate_a_compiled_kind` pins the compiled
side.

## Configured client tools (ERMAIN-911)

```toml
[client_tools.tools.<id>.durable]
host_context = "outlook_mailbox"   # required compiled host family
result_schema = """{ ... }"""      # optional JSON Schema string, type = "object"
attempt_expiry_secs = 3600         # 60..=86400, from dispatch; >= timeout_ms + lease
claim_lease_secs = 120             # 60..=900, at most attempt_expiry_secs
```

Load-time validation rejects a durable tool that also has `submission`, a result
schema that does not compile as an object schema, out-of-range durations, and an
expiry shorter than `timeout_ms` (default 60 s) plus the lease. The
`parameters` schema is not applied at dispatch; the generic kind checks only that
the input is a JSON object of at most 64 KiB. Results are JSON values of at most
1 MiB. `failed` carries `execution_failed` and an optional message; `rejected`
carries `validation_failed`. Anything else is malformed. `ClientToolConfig.durable`
is omitted from serialized rows when unset, so stored
`generation_parameters.client_tools` stay byte-identical.

The Outlook add-in's binding:

```json
{"device_id":"<per-origin id>","realm":"office-addin",
 "host_context":{"kind":"outlook_mailbox","identity":"<sha256 hex>"}}
```

`device_id` is a random UUID persisted in the origin's `localStorage`; without
storage there is no binding. `identity` is the SHA-256 hex digest of the trimmed,
lowercased `Office.context.mailbox.userProfile.emailAddress`. No raw address
reaches headers, request context, attempts or claims. Office.js asserts the
address; it is not authenticated. The security boundary remains the account, chat
authorization and the per-tool decision. Routing depends only on the device id
and the digest. Readiness to execute belongs to the handler. A pane without a
calendar fetcher still answers live calls with its error, and never claims.

The Word add-in's `word_document` binding uses the same per-origin device ID.
Its identity is SHA-256 of the JSON pair `[documentIdentity, paneInstance]`.
`documentIdentity` is the existing pane document URL or unsaved-document identity;
`paneInstance` is a random UUID held only in pane memory. No raw URL is included in this
binding, no identifier is written into the document, and a reload or another pane
cannot acquire the original transport or claim its reads.

Only `word/read_document_blocks` opts in. Its executor checks the existing
chat/message-owned capture before and after asynchronous work. A cleared, consumed
or replaced capture returns validation feedback, never an implicit recapture.
`word/submit_document_plan` remains a live-only validated submission. Its five
attempts and declared recovery reads come from the configuration overlay; durable
submissions remain forbidden until ERMAIN-944. Enablement still requires the
feature flag and host qualification (Word PC followed by Word on the web).

Decided open questions:

- **File results.** The generic kind carries only `OperationValue::Value`. Tools
  that return files (`fileUploadIds`) must not opt in. A future
  `References { Vec<Uuid> }` would need an ownership check at acceptance and
  attachment at `begin_continuation`. `OperationValue::Reference` stays unused.
- **Teams-originated calls (`needs_client`).** Teams sends no `X-Erato-Executor`,
  so its calls never escalate and `needs_client` is unchanged.
- **Approval from another executor.** The continuation captures the answering
  device's binding. A mismatch keeps the legacy path for every decision-gated
  call the continuation dispatches, not only the approved one: none of them parks
  for a device that did not approve it.
- **Flag off, header sent.** The add-in sends its binding whatever the server
  flag says. Nothing reads it, and it holds no raw address. Gating the header on
  `/me/client-operations` is not worth the coupling.

Every replica must load the same `durable` tables. A replica without the tool's
kind treats its open attempts as unauthorized and withdraws them at claim.

Turning the flag on has costs beyond configured tools. Generation starts take the
compare-and-set lease path with the lease identity guard. Every abort runs the
inbox abort transaction. Late results probe the logged inbox. For an opted-in tool,
a brief SSE drop now parks and detaches the turn instead of waiting out
`timeout_ms`. The sweep after a result POST that answers `stored`, the `client_tool_pending`
nudge or the 10 s inbox poll recovers it.

Production opt-in lives in the private configuration package
(`configuration-packages/erato-action-facets.toml`), next to
`[client_tools.tools.outlook_fetch_availability]`:

```toml
[client_tools.tools.outlook_fetch_availability.durable]
host_context = "outlook_mailbox"
attempt_expiry_secs = 3600
claim_lease_secs = 120
result_schema = """{"type":"object","required":["legend","timezone","now","busy","recentMeetings","degraded"],"properties":{"legend":{"type":"string"},"timezone":{"type":"string"},"now":{"type":"object"},"busy":{"type":"array"},"recentMeetings":{"type":"array"},"degraded":{"type":"array"}}}"""
```

Deployments also need `[client_tools] durable_operations_enabled = true`. Enable
it only after all of the following:

- The add-in build has shipped.
- Real-host qualification in Outlook, Windows first and then OWA, covers a drop,
  a transient drop on the same pane (the answer appears without a reload), a
  timeout, a second tab, `ask` approved on the same pane, `ask` approved in OWA
  (legacy path) and `never_allow`.
- The flag-wide costs above are accepted.

For local qualification, the backend auto-discovers `*.auto.erato.toml` files in
sorted order. After `just config-apply erato-action-facets`, put the block above
and `durable_operations_enabled = true` into an uncommitted
`backend/zz-ermain-911-durable.auto.erato.toml`. Check that the durable table
merges onto the overlay's tool. That file is not gitignored; never commit it.

## Executor streams (ERMAIN-1000)

`client_tools.executor_stream_enabled` (default off) adds a second channel for live
calls. With it off, the stream endpoint answers 404 and no row is written.

- **Stream.** `GET /me/client-operations/stream` (SSE, 1 s keep-alive), one per
  pane. It needs a valid `X-Erato-Executor` and a non-empty `X-Erato-Client-Tools`
  (else 400). `X-Erato-Child-Client-Tools` names the tools whose handlers accept
  grant calls; it is intersected with `X-Erato-Client-Tools` and never part of the
  binding, so older backends that refuse unknown binding fields are unaffected.
- **Presence.** UNLOGGED `client_executor_presence`, one row per stream: the
  account and binding, the pane's `X-Erato-Executor-Instance` (a UUIDv7 made
  when the pane opened, the same for all its streams), the advertised and
  child-capable tool names, and a 20 s lease renewed every 5 s, as for chat
  transports. No stream waits for another. Dropping the response body deletes
  the row.
- **Queue.** UNLOGGED `client_executor_calls`, addressed to the account and
  binding, not to a stream. Each replica runs one poll loop (200 ms) for its
  streams; it marks a due row delivered to the answering stream in the same
  statement, so exactly one stream gets it. A new call goes to the newest pane
  that serves its tool (for a grant call: takes grant calls for it), so a pane
  left open elsewhere never keeps calls from one opened since. A live call row
  belongs to the generation that handed it over and is due only while that
  generation is the chat's running one. Once delivered, it goes again only to a
  later stream of the same pane, which may have lost it while reconnecting;
  never to another pane, where it would run twice or unseen. The frontend runs
  a `tool_call_id` once per page. A nudge goes to the newest pane, once.
- **Hand-over.** Where the run emits `ClientToolCall`, a live-only call (no
  durable operation, not a submission, not inbox-only) with a binding is routed
  once, at dispatch:
  1. a stream of the calling chat can take it (the original stream, a resumed
     stream on the same replica, or the shared transport owner): the chat
     stream, unchanged;
  2. else the binding's executor streams: the newest pane that serves the tool
     gets it, at once or when one connects (see Outcomes). A chat resumed on
     another replica without a shared transport row is not seen in step 1, so
     its call takes this path.

  A handed-over call is neither broadcast nor written to the shared event log, so
  no chat stream runs it twice; proposal and status updates still are. The event
  is `client_tool_call {chat_id, message_id, tool_call_id, tool_name, input,
  lineage?}`. `lineage` is set only for grant calls (ERMAIN-1001), which always use
  the executor stream.
- **Results** use `clienttoolresult` with the calling chat and message ids. A
  handed-over call accepts only the binding it was sent to (409 otherwise), on the
  run's replica from memory and on another replica from the queue row.
- **Outcomes.** If no stream could answer the call for 15 s from the hand-over
  on (none serves its tool, or none of the pane it went to is left), it settles
  as `context_unavailable`. A pane that connects or reconnects within that grace
  resets it, so a network blip at dispatch no longer fails the call. The tool's
  own timeout still applies. Every exit deletes the queue row.
- **Nudge.** After a durable park commits, a `client_operation_available
  {attempt_id}` row for the binding is released once the attempt is claimable
  (pending, its chat no longer running). The frontend coordinator then sweeps the
  inbox at once; the 10 s poll stays the fallback.
- **Frontend.** `ClientOperationCoordinator` opens the stream when
  `ListClientOperationsResponse.executor_stream_enabled` is set and the pane has a
  binding, reopens it when the binding or tools change, and dispatches calls
  through the client tool executor registry with the stream's binding.

## Local evidence integration

The completed [rebase delta](local-evidence-operations.md) records the removed
private checkpoint, job lifecycle and continuation paths. The native kind uses the
shared attempts table, with a narrow export/binding extension. Its offer policy
retains the single-replica, async-leaf, exclusive-scope and depth-one restrictions.
Ordinary configured client tools remain suppressed in delegated children. Only a
client task's grant offers them, live over the executor stream (ERMAIN-1001, see
[delegated-client-tools.md](delegated-client-tools.md)).

Protocol 0.1.28 keeps its existing signed fields: native `jobId` is the generic
attempt UUID; native `attemptId` retains the original generation UUID. No native
consent, receipt or export format changed for the shared-operation integration.

References: Workflow contract v0 (Linear eb6c078d27a0), Operation attempts v0
§3.3, §5 and §6, Delegation Foundations (c7ac285ded0d), ERMAIN-854
counter/selection continuity, ERMAIN-911 configured client-tool kind. This does
not implement ERMAIN-759's general command queue, ERMAIN-762's orphan parent-card
reconciliation, or ERMAIN-765's general interrupted-tool reaper.
