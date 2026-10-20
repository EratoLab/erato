# Client tools in delegated tasks

A delegated task can read through the client its parent turn was sent from,
for example the Word pane, under a grant the server writes when the task
launches. This record describes the host-neutral core (ERMAIN-1001). The
contract is the Linear document "Contract: delegated tasks with client tools",
sections 2 to 10. Hosts implement their side separately (Word ERMAIN-1003,
Outlook ERMAIN-1006). Nothing is enabled by default: no shipped configuration
sets `child_access` or `child_host_context`.

## Eligibility

- `client_tools.tools.<key>.child_access = "read"` marks a tool a task may be
  granted. The default is `none`. Load-time checks refuse:
  - `read` on a submission tool;
  - `read` without the top-level `host_context`. The `durable.host_context`
    alone is not enough, and when both are set they must match;
  - `child_context_arg` without `child_context_input` or the reverse, either one
    without `read`, and an empty or untrimmed value;
  - two `read` tools of one host that name different `child_context_arg` values,
    because a grant carries one context version.
- `facets.facets.<key>.child_host_context` marks a child facet. It is refused on
  a `hidden` facet and on one with a `tool_call_allowlist`. It restricts no tools;
  it carries the read instructions.
- Client actions, submissions and write tools are never child-eligible.

A task is a client task for host `H` when its `facet_ids` name a facet with
`child_host_context = H`. If several do, the first one wins.

## Grant

`launch_prepared_task` resolves the grant (`delegated_client_tools::resolve_grant`)
and `launch_delegation` writes it to `TaskSpec.client_grant` as
`{tools, binding, owner_chat_id, owner_message_id, context_ref}`. `tools` are
qualified names; `owner_message_id` is the parent's assistant row. There is no
`dispatch` field yet: ERMAIN-1032 adds it, and a grant without one is live-only.

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
- the parent chat's running generation is `owner_message_id`, on this replica or
  on another (`background_tasks.active_generation`);
- the grant lists the tool, the current configuration still says `read` for host
  `H`, and the user's decision, read from the database, is not Never.

The "parent is parked on this child" clause of the contract is left to ERMAIN-1032:
on the fast path the parent is running again whenever a child resumes. Grant offers
skip the facet allowlists and `requires_client_registration`, which the grant
implies, and give way to an MCP tool of the same name. Every other delegated-run
suppression stays.

## Dispatch and outcomes

A granted call is never a durable operation and never waits for the inbox, also
with `durable_operations_enabled` on and a tool that has a `durable` table. It is
routed with `route_executor_call(grant_call = true)` and handed over with lineage
`{owner_chat_id, owner_message_id, requesting_chat_id, requesting_message_id,
context_ref}`. Before the hand-over the backend writes `context_ref` into the
tool's `child_context_input` field, or removes the field when the grant has none.
The stored call keeps the model's input, so the child's model never sees the
context version.

| Situation | Stored output |
| -- | -- |
| Executor streams off, no stream, or the hand-over fails | `{"status":"cancelled","reason":"context_unavailable"}`, at once |
| The stream went away during the call | `context_unavailable` after the 15 s grace |
| No answer | `timeout`, after the tool's own timeout |
| Not granted, not offered, or set to Never | refused per call |
| The user declined an Ask (Reject, Never allow or Withdraw) | `{"status":"cancelled","reason":"declined","error":…}` |

The host's own outcomes, such as Word's `capture-unavailable`, come back as tool
results.

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

## Freshness and the task result

`build_result_envelope` reads the child's `TaskSpec` and answer row and adds
`client_tools` to the task result, left out when empty:

- `run_mode` and `unavailable` from the note;
- `freshness`: the last `result.freshness` a successful granted call reported;
- `declined`: the number of granted calls the user declined.

The parent's trace steps (`localTrace`) for granted reads carry the part read and
the freshness: `detail` is the call's receipt input fields
(`replay.keep_input_fields` without `child_context_input`) and the reported
`changes`, and `counts` are the freshness counts. Only short tokens and integers
are copied from the host. For Word the part stays empty until the overlay keeps a
part field in its receipt (ERMAIN-1003/1004). A resumed child's events are folded
into the trace its park left behind.

## Frontend

The executor stream hands a grant call to its executor with
`ClientToolCallContext.hostGrant {ownerChatId, ownerMessageId, requestingChatId,
requestingMessageId, contextRef?}`. A call that carries a grant is refused with an
error, without running the handler, when the executor was not registered with
`acceptsGrantCalls`. Calls of the user's own turn are unchanged. The host checks
`hostGrant` against its local context (contract §7).

## Conformance

`erato/tests/integration_tests/api/messages/client_tool_operations/delegated/conformance.rs`
runs every case above for each host row in `delegated/rows.rs`: a fake host on
a test-driven pane, and the `word_document` and `outlook_mailbox` rows, which
stay ignored until ERMAIN-1003 and ERMAIN-1006 enable them. A host's handlers
pass `clientToolHostAdapterConformanceFailures` from
`@erato/frontend/conformance`. The adapter checklist and templates are in
`office-addin/ARCHITECTURE.md`, "Client tools in delegated tasks".

## Not in this record

- ERMAIN-1032: the slow path, where a child's call waits durably for a client
  and for an approval on the device, the grant's `dispatch` field and the
  "parked on this child" owner clause.
- ERMAIN-1033: approving once per document or thread.
- ERMAIN-1034: the desktop sidecar host context.
- ERMAIN-1031: the child's model.
