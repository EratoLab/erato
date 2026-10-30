# Client tools in delegated tasks

A delegated task can read through the client its parent turn was sent from,
for example the Word pane, under a grant the server writes when the task
launches. This record describes the host-neutral core (ERMAIN-1001), the slow
path, where a task's call waits durably for a client (ERMAIN-1032), and approval
per document or response (ERMAIN-1033). The contract is the Linear document
"Contract: delegated tasks with client tools", sections 2 to 10 and 16. Hosts
implement their side separately (Word ERMAIN-1003, Outlook ERMAIN-1006, the
desktop sidecar ERMAIN-1034). Nothing is enabled by default: no shipped
configuration sets `child_access`, `child_host_context`, `child_dispatch` or
`approval_scope = "context"`, and `client_tools.durable_operations_enabled` is
off.

## Eligibility

- `client_tools.tools.<key>.child_access = "read"` marks a tool a task may be
  granted. The default is `none`. Load-time checks refuse:
  - `read` on a submission tool;
  - `read` without the top-level `host_context`. The `durable.host_context`
    alone is not enough, and when both are set they must match;
  - `child_context_arg` without `child_context_input` or the reverse, either one
    without `read`, and an empty or untrimmed value;
  - two `read` tools of one host that name different `child_context_arg` values,
    because a grant carries one context version;
  - `child_host_inputs` without `read`, or with an empty, untrimmed or repeated
    entry, or one that is the `child_context_input`;
  - `child_dispatch` without `read`, and `child_dispatch = "durable"` on a tool
    without a `durable` table or whose `host_context` does not outlive the pane
    session (`ClientToolHostContext::outlives_pane_session`: `outlook_mailbox`
    does, `word_document` does not).
- `client_tools.tools.<key>.child_dispatch = "live" | "durable"` says how a
  task's calls reach the device. Unset, the tool follows
  `delegation.tasks.child_dispatch` (default `live`), which applies `durable`
  only where it can, so it never fails a configuration.
- `facets.facets.<key>.child_host_context` marks a child facet. It is refused on
  a `hidden` facet and on one with a `tool_call_allowlist`. It restricts no tools;
  it carries the read instructions.
- Client actions, submissions and write tools are never child-eligible.

A task is a client task for host `H` when its `facet_ids` name a facet with
`child_host_context = H`. If several do, the first one wins.

## Grant

`launch_prepared_task` resolves the grant (`delegated_client_tools::resolve_grant`)
and `launch_delegation` writes it to `TaskSpec.client_grant` as
`{tools, durable_tools, binding, owner_chat_id, owner_message_id, context_ref}`.
`tools` are qualified names; `owner_message_id` is the parent's assistant row.
`durable_tools` lists the granted tools whose calls wait durably: those for which
`durable_eligible` holds at launch (`durable_operations_enabled`, an effective
`child_dispatch` of `durable`, a host context that outlives the pane session, a
`durable` table and a registered `client_tool.v1` kind). It is per tool because
one grant may mix live and durable tools of a host. Absent or empty means every
call is live, so grants written before it read as live. A listed tool whose
eligibility lapsed later (the flag turned off, the table removed) dispatches
live.

The grant is written only when all of these hold, checked in this order. The
first that fails becomes the fixed reason in `TaskSpec.client_task.unavailable`:

| Check | Reason when it fails |
| -- | -- |
| `client_tools.executor_stream_enabled` is on | client tools are not enabled for tasks |
| the parent's binding has host context `H` | the turn was not sent from the pane this task needs |
| the parent offered a `read` tool of host `H` on that binding | the turn offered no client tools that tasks may use |
| the user's decision for it is not Never | the user does not allow these client tools |
| an executor stream is present for the binding | the pane is not connected |
| the stream lists the tool in `X-Erato-Child-Client-Tools` | the pane does not take calls from tasks |

The grant lists exactly the tools that pass. `context_ref` is the parent turn's
persisted `action_facet_args[child_context_arg]`, opaque to the backend.
`TaskSpec.client_task {host_context, run_mode?, unavailable?}` is written for every
client task, with or without a grant. Retries and the @-mention route never get a
grant. A retried client task still gets the note, with the reason "a retried task
gets no client tools"; a mention run gets none.

## Offer predicate

`granted_tools` is the one predicate used on fresh turns and on continuations
(`append_granted_client_tools`). A granted tool is offered while:

- the run's executor equals the grant's binding. On a continuation that is the
  child's own persisted binding, never the deciding client's;
- the run is not adopted (`provenance.adopted_at` unset);
- the parent's turn holds the grant's context: the parent chat's running
  generation is `owner_message_id`, on this replica or on another
  (`background_tasks.try_active_generation`), or the turn is parked on this child
  (`parked_on_child`, below);
- the grant lists the tool, the current configuration still says `read` for host
  `H`, and the user's decision, read from the database, is not Never.

`parked_on_child` holds while the parent chat is not archived, `owner_message_id`
is its active-thread tip, and either the last stop has an open item for the child
or the child's slot still waits for a client outside any stop. Decision parts
after the stop do not end it, so a decision continuation that runs on another
replica, or crashed, keeps the calls it waits for. The slot clause covers a turn
that ended on a stop no child item can share (the tool-call limit, its own durable
operation) or on an error, or the user stopped the turn. The same owner clause
authorizes a claimed grant operation (Slow path), and
`origin_approval_covering_child` uses the tip check too, so once the parent moved
on a child's own card is answerable. An owner check that cannot read the shared
lease is an error, never "not running": the offer logs it and offers nothing, the
authorization answers without withdrawing.

Grant offers skip the facet allowlists and `requires_client_registration`, which
the grant implies, and give way to an MCP tool of the same name. Every other
delegated-run suppression stays.

## Dispatch and outcomes

A granted call to a tool that is not durable for the grant goes live and never
waits for the inbox, also with `durable_operations_enabled` on and a tool that
has a `durable` table. A durable one takes the slow path (below). A live call is
routed with `route_executor_call(grant_call = true)` and handed over with lineage
`{owner_chat_id, owner_message_id, requesting_chat_id, requesting_message_id,
context_ref}`. Before the hand-over the backend writes `context_ref` into the
tool's `child_context_input` field, or removes the field when the grant has none,
and drops the `child_host_inputs` fields, which the host fills from its own
context. The stored call keeps the model's input, so the child's model never sees
the context version. The schema offered to the task leaves both out, in every
`anyOf`/`oneOf`/`allOf` alternative, so the model is never asked for them.

| Situation | Stored output |
| -- | -- |
| Executor streams off, no binding, or the hand-over fails | `{"status":"cancelled","reason":"context_unavailable"}`, at once |
| No pane takes the call, or its pane went away | `context_unavailable` after the 15 s grace; a pane that connects in time gets it |
| No answer | `timeout`, after the tool's own timeout |
| Not granted, not offered, or set to Never | refused per call |
| The user declined an Ask (Reject, Never allow or Withdraw) | `{"status":"cancelled","reason":"declined","error":…}` |
| Durable: the user declined on the device | `{"status":"cancelled","reason":"declined","error":…}` |
| Durable: no client ran it before the attempt ended | `{"status":"cancelled","reason":"expired","error":…}` |
| Durable: the parent moved on, or the tool became Never or lost its grant | `{"status":"cancelled","reason":"withdrawn","error":…}` |

The host's own outcomes, such as Word's `capture-unavailable`, come back as tool
results. The durable texts tell the child's model that the task has no result
from the tool and to say in the answer what is missing.

## Slow path

A durable granted call parks the child at once (ERMAIN-1032). There is no live
first try and no 15 s grace.

- **The operation.** The call becomes a `client_tool.v1` operation for the
  grant's binding, whose realm comes from the tool's host context. The request
  carries `lineage {owner_chat_id, owner_message_id, requesting_chat_id,
  requesting_message_id, context_ref?}`, which only grant operations have, and the
  input the live hand-over would send (`context_ref` filled in, host inputs
  dropped). The stored call keeps the model's input.
- **Pickup.** The nudge goes only to an executor stream that lists the tool in
  `X-Erato-Child-Client-Tools`, and waits until one connects; the inbox poll is
  the fallback. A claim needs the same header (else 409 "Executor binding
  mismatch", nothing withdrawn). Every claim, renewal and result runs
  `authorize_grant_operation`: the grant still holds (binding, not adopted, the
  tool in `tools` and `durable_tools`, still `read` and durable-eligible, lineage
  ids match), the user's decision is not Never, and the owner clause holds. A
  definite refusal settles the call `withdrawn` (409 "Operation authorization
  withdrawn"); a read failure answers 500 and withdraws nothing. A result without
  a claim is refused (409 "Operation requires a claim").
- **Device prompts last the attempt.** A same-binding claim of a live claim
  renews it (same token, never past the attempt's end); a claim after it lapsed
  gets a new token. The claiming pane renews at half the remaining lease, retries
  a renewal lost on the way while the claim still holds, and aborts the prompt
  when a renewal is refused, the attempt ends or its coordinator goes away.
- **Continuing the child.** Any of the user's clients sends `/continue` for a
  ready or continuing grant operation, and for a pending or claimed one past its
  attempt end, which settles it `expired` first. Expiry therefore waits until a
  client next reads its inbox. A continuation that fails ends its call there
  (`completed`, the child chat `errored`), and `/continue` refuses a call left
  `continuing` on an errored child (409 "Operation continuation failed"). A
  crashed one is reaped to `awaiting_approval` and is continued again.
- **The waiting item.** The parent's join parks with one item per waiting child
  on the same `tool_approval_request` part as approval items (ERMAIN-1050 queue),
  marked `child.waiting_for {host_context, attempt_id}`. It is never decided: it
  is open while the parent's slot (the last `tool_use` with its id) is
  `in_progress`, and only on the last stop. The slot holds the suspended envelope
  (`input_required`, reason `client_pending`), so the interrupted-parts sweep
  leaves it alone. A turn that ends on a stop no child item can share leaves the
  child out; its slot still waits, `parked_on_child` still holds, and the child's
  own tail settles the slot (`reconcile_orphaned_parent_slot`).
- **Sync.** `sync_waiting_parent` brings the parent's last stop up to date under
  the parent chat's advisory lock, only while the message is the active-thread
  tip, its last stop has waiting items, and the chat is not archived and runs no
  generation. The chat's state is not asked beyond that: the heartbeat cleanup
  clears an ended turn's state a minute later, and a task may wait far longer.
  Per open waiting item: the child chat was archived, so the slot settles failed
  (nothing claims, continues or expires an archived chat's call); the child still
  runs or its call is not completed, so the item stays open (a call left
  `continuing` on an errored child counts as failed); the child parked on an Ask, so the item becomes an approval
  item in place (slot reason `approval_pending`); the child parked on another
  grant call, so the item is rewritten to that call and attempt; otherwise the
  slot settles with the task result. It is failed when the child's row still
  holds the call's pending part, which only a completed continuation drops, or
  ends on a stop; else completed, downgraded on a metadata error. An `errored`
  child chat alone does not mean failed: the stale-generation reap writes it for
  a replica that died after the answer was committed.
- **Who syncs.** Every tail of the child, whatever it ended on; the parent's own
  parking tail, for a child that finished while the parent's join still ran; an
  empty `continuestream` body; and the cleanup tick (`sweep_waiting_parents`),
  for a child whose tail never ran. The sweep scans the parents a sync is
  expected to move, on the tip's last stop only, the one a sync reads: a waiting
  item whose slot is open while its call completed, or failed on an errored
  child, or whose child was archived, on a child that no longer runs. A sync can
  still leave one as it was (a row it cannot read, a read that fails), so the
  sweep visits them in chat order, 100 a tick, and carries a cursor to the next
  tick.
- **Resume.** Once nothing is left to decide and every waiting item settled, the
  tail starts the parent's continuation in process (`WaitingSettled`) under
  `Takeover::ResumeParked {expected_generation}`, which takes only the generation
  that parked and only while the message is still the tip. A parent whose
  continuation crashed, so its message still carries the in-flight marker,
  resumes the same way (`ResumeCrashed`) and re-parks on what is still open. The
  marker says so, not the chat's `errored`: once the cleanup cleared the state,
  `ResumeParked` takes a chat with no state and no generation instead, under the
  same tip check. One that ended without answering on purpose (the content filter
  clears the marker) still has its slots settled, and runs again only when the
  user asks. The open parent chat sends the empty
  `continuestream` itself 5 s after it sees a settled stop no resume picked up,
  and holds its message queue until the turn answers.
- **Admission** (`continuestream`). A body naming a waiting item, or a lone
  legacy `decision` from a client that does not show child items while only
  waiting items are open, gets the plain-text 409 asking to reload. The same lone
  decision from a client that does (`shows_child_items`) gets 409
  `already_continued`: it answered a stop decided elsewhere. Decisions cover the
  decidable items only (400 `decisions_mismatch` otherwise). An empty body while
  only waiting items are open on a parked chat gets 409 `children_waiting`. A card
  on a stop with waiting items names even a single answer in `decisions`, so an
  item converted meanwhile comes back as `decisions_mismatch` and the card asks
  only the new question.
- **Mixed stops.** Decisions take effect at once; the continuation re-parks on a
  new stop with the items still open (re-stopped decided children, still waiting
  children, converted children), or calls the model when nothing waits. A child
  that finishes while approvals are open settles its slot and keeps the parent
  parked.
- **Moving on.** A new user turn makes the parked message no longer the tip. A
  waiting call is withdrawn at its next claim, renewal or result, the child
  answers without it, and its old slot is settled by
  `reconcile_orphaned_parent_slot` when the child finishes, also while the newer
  turn still runs: that check stands down only for a running turn that answers
  the old message.
- **Task result.** `client_tools` counts `declined` and `expired` granted calls,
  each left out when 0.

## Run mode

A client task runs in wait mode. `validate_task_tool_call` turns a requested
`async`, offered or not, and a missing `run_mode` into wait. An unknown value is
still refused, and so are other modes a deployment does not offer. When the model
asked for `async`, the task result says "wait (uses the open document)" or "wait
(uses the open mailbox)". The `AsyncOnly` dispatch-approval gate reads the raw
`facet_ids` and treats a client task as wait. Tasks without a child facet keep
the model's choice, so mixed batches stay allowed.

## Approvals

A child's client-tool Ask follows the MCP rule, `child_may_park_on_approval`: an
awaited task child with `delegation.tasks.propagate_child_mcp_approvals` on parks,
and anything else has the call refused. The parked child is one item on the
parent's approval part, or joins the parent's own `mcp_tool` or `client_tool`
part when the coordinator asked in the same batch (ERMAIN-1050 queue).
`ChildApprovalRef.kind` says the child asked about a client tool, so the queue
names this device and shows no MCP open-world warning. Always allow and Never
allow on such an item are saved as the user's client-tool preference. The MCP
`allow_always` policy does not bind them.

After the decision the parent's continuation resumes the child without an
executor of its own. The child's continuation offers and dispatches from the
grant, because the parent's continuation is the running generation on
`owner_message_id`. A child decided from its own chat after the parent's turn is
over gets no granted tools: the approved call is refused as not offered.

## Approval scope

A client tool may set `approval_scope = "context"` (default `call`). It loads
only on a `child_access = "read"` tool whose host context has an approval scope,
`ClientToolHostContext::supports_approval_scope()`: `word_document`, whose scope
is the document in one pane session, and `outlook_mailbox`, whose scope is the
parent turn. The desktop sidecar stays per call until it can name a thread and
count the items added since a position (ERMAIN-1034's follow-up N2).

When a task's granted call to such a tool asks (the user's decision is Ask), its
item on the parent's card carries `child.approval_scope {host_context, covers,
scope_id, changed}` (`covers` is `document` or `turn`; `changed` only when set),
and the card may answer it with `approve_context`. One click answers every open
item of the same tool and scope. The coordinator's own calls never offer it,
since only grant calls carry the lineage the scope travels in. `approve_context`
is a 400 on the coordinator's own item, an MCP task, an item without a scope and
a task's own card. Always allow and Never allow keep their meaning, and Never
refuses a call an approval covered.

The store is `client_tool_approval_scopes` (`services/approval_scope.rs`). The
key is the parent chat, the SHA-256 of the grant's executor binding, the host
context, a scope id and the tool's qualified name, and at most one row per key is
live. The server derives the scope id from the grant, never from the call: Word's
is the binding's `host_context.identity`, which is new on every pane load, and
Outlook's is the grant's `owner_message_id`. The parent's continuation makes the
row once per decision, before any task resumes. The decision is identified by the
parent message and the index of the stop's request part, so a crash retry finds
the same row and a decision never makes a second one. Each item's approval part
records `covers` and `scope_approval_id`; the task's continuation gets the row id
and its call passes the gate again under that row. Any later granted call of the
same key, in any task of the chat, runs without asking while the row is live.

A document scope is checked on the device:

- The approval is given only in the pane that holds the document. The decision
  item carries `scope_position`, the change-journal position the pane took at the
  click (`{journal, seq, events: true}`, at most 1 KiB), and the request's
  `X-Erato-Executor` must be the grant's binding. All items of one scope carry
  the same position. Otherwise `approve_context` is a 400.
- A pane lists the tools whose scope it checks in `X-Erato-Scoped-Client-Tools`,
  a subset of `X-Erato-Child-Client-Tools`. The scope is offered and used only
  while one stream of the binding lists the tool in both. A covered call
  (`client_executor_calls.scoped`) goes only to such a stream, re-delivery
  included, and ends as `context_unavailable` after the 15 s grace when none is
  left. A call the user allowed for the document is never turned into a plain
  Ask for want of such a stream.
- Every covered call carries `lineage.approval_scope {approval_id, scope_id,
  position}`. The host answers `ok: false` with the validation code
  `scope_changed`, without reading, when the document changed since the position.
  Word's journal leaves out the chat's own writes, formatting-only edits on
  Windows and Mac, Track Changes toggles and proofing; on Word for the web a
  formatting edit counts.
- On `scope_changed` the server ends the row by its id (`end_reason =
  scope_changed`), so a late answer for an older approval never ends a newer one.
  The task parks on a new Ask for the same call with `changed: true`. No tool
  part is written for the call, so it runs after the next decision. Tasks of the
  same decision that had not run yet find the row ended and ask again, marked
  changed, and no row is made from the old decision. A task that cannot park
  (`propagate_child_mcp_approvals` off) ends the call as `cancelled` with reason
  `scope_changed`. A `scope_changed` answer to a call without a scope is a plain
  validation failure.

Outlook's turn scope is kept by the server alone: no header, no position, no
`approval_scope` in the lineage, and the next turn asks again. Unarchiving the
parent chat ends its live rows (`chat_archived`); an archived chat's rows are
never used, and deleting the chat deletes them.

A context approval replaces the server's Ask for covered calls and nothing else
(CT-9): the host's own prompts, a native release review and local evidence never
pass through it.

## Freshness and the task result

`build_result_envelope` reads the child's `TaskSpec` and answer row and adds
`client_tools` to the task result, left out when empty:

- `run_mode` and `unavailable` from the note;
- `freshness`: the last `result.freshness` a successful granted call reported,
  cut to the contract's keys (`context_ref`, `capturedAt`, `readAt`, `changes`
  from its four values, integer `counts`, `sections`), each string at most 256
  characters and at most 64 sections, because the task result reaches the parent's
  model outside the untrusted framing;
- `declined`: the number of granted calls the user declined.

The parent's trace steps (`localTrace`) for granted reads carry the part read and
the freshness: `detail` is the call's receipt input fields
(`replay.keep_input_fields` without `child_context_input`) and the reported
`changes`, and `counts` are the freshness counts. Only short tokens and integers
are copied from the host. For Word the part stays empty until the overlay keeps a
part field in its receipt (ERMAIN-1003/1004). A resumed child's events are folded
into the trace its park left behind.

## Frontend

The executor stream hands a live grant call to its executor with
`ClientToolCallContext.hostGrant {ownerChatId, ownerMessageId, requestingChatId,
requestingMessageId, contextRef?}`; the coordinator's durable handler runs a
claimed grant operation with the same `hostGrant`, built from its `lineage`. Both
go through `runClientToolCall`, the only place a `hostGrant` is made. A call that
carries a grant is refused with an error, without running the handler, when the
executor was not registered with `acceptsGrantCalls`. Calls of the user's own
turn are unchanged. The host checks `hostGrant` against its local context
(contract §7). On the durable path a host's `declined` validation code becomes the
`rejected` outcome with error code `declined`.

The parent chat lists waiting items below the decisions, naming the host
("Waiting for Outlook on this device"), and reads the row again every 5 s while
one shows. A stop that only waits holds the chat's message queue as waiting only
and asks nothing of the user.

## Conformance

`erato/tests/integration_tests/api/messages/client_tool_operations/delegated/conformance.rs`
runs the host-facing cases once for each row in `delegated/rows.rs`, against a
test-driven pane: a fake host with a context version on `word_document`, the
same fake host without one on `outlook_mailbox`, and the `word_document` and
`outlook_mailbox` rows, which stay ignored until ERMAIN-1003 and ERMAIN-1006
enable them. A row marked `slow_path` also runs the slow-path cases
(`delegated/slow_path.rs`): the fake host on `outlook_mailbox` and the ignored
`outlook_mailbox` row. Every row has a guard case that holds `slow_path` to
whether its host's context outlives the pane session, so the `word_document`
rows never take it. Four cases of the core alone stay in `delegated.rs` on the fake
host: Always allow under a strict MCP policy, Never allow stored as the
client-tool preference, adoption by regenerate, and a turn without the context
version whose read is dispatched without one. No integration case covers the
@-mention route, which launches no client task and so never gets a grant.

`delegated/approval_scope.rs` adds five approval-scope cases to every row: a
document row takes the document scope and a turn row the turn scope. They cover
one approval for many tasks, a later turn, a new pane session, `scope_changed`
and a decision made before an outside change. The cases that need one host only
(refusals, routing to a stream that checks, Always and Never, crash retry, a
stale end, no surface, unarchive, the key's binding and tool) run once on the
fake host.

A host's handlers pass `clientToolHostAdapterConformanceFailures` from
`@erato/frontend/conformance`. The adapter checklist and templates are in
`office-addin/ARCHITECTURE.md`, "Client tools in delegated tasks".

## Not in this record

- The desktop sidecar's thread approval, which needs the sidecar to name a
  thread and count the items added since a position (ERMAIN-1034's follow-up
  N2).
- Showing a live document approval in the parent chat, or ending it early.
- ERMAIN-1034: the desktop sidecar host context; showing a device prompt of a
  grant call in the parent chat (registering it under `hostGrant.ownerChatId`);
  mapping a device decline on the live path; and a multi-executor envelope
  (ERMAIN-911), which a second host family with its own binding in one message
  needs.
- ERMAIN-1031: the child's model.
