# Validated client submissions

A submission is an opt-in client tool that validates and stages a structured draft for review. A successful result ends generation immediately, unless a server-called tool follows it (see "Applying an accepted submission"). Ordinary client tools still return their results to the model and continue generation.

This is infrastructure for hosts that need a typed artifact. It does not implement an editor, an artifact schema or a review UI. Domain schemas and model instructions remain deployment configuration; the host owns semantic validation and user confirmation.

## Contract

1. The model calls the submission tool with an object matching its parameter schema. The artifact is the tool arguments themselves, not JSON encoded inside a string.
2. The backend validates those arguments against the configured JSON Schema before dispatching to the client. Schemas compile offline; local `$defs`/`$ref` references are supported, external retrieval is disabled. Two parts of the schema that a check applies to the same value must not lead back to the same subschema through the same property (or both through array items, or one through `additionalProperties`/`patternProperties`): two alternatives of an `anyOf` or `oneOf`, an alternative and a keyword next to the choice such as shared `properties`, or two `allOf` members. A failed check collects the errors of every alternative and every keyword, so it would repeat at every nesting level of the value, and a small input could take minutes. Keep the recursive property in one place, for example next to the `anyOf`, and set it to `true` in the alternatives. The backend refuses such a submission or part tool schema at startup. Some models send a large array or object argument as a JSON string. Where no schema alternative admits a string and one admits the decoded value, the backend decodes it first; the decoded arguments are what the model's replayed call, the stored message and the client see. The string's first JSON value is decoded when only whitespace and at most two closing brackets or braces follow it (some models end such a string with an extra `}]`); anything else after it, including a longer run of closers, leaves the string as sent. The same applies to the whole arguments object when the provider delivers it as one JSON string.
3. The host validates domain rules using its authoritative parser: references, current state, supported operations, permissions, and so on. The executor may stage a draft but must not apply it.
4. On failure, the tool result contains compact `validation_errors` and the remaining attempt count. Only a failed submission resumes inference. The default allows three attempts total (the initial attempt plus two corrections), configurable from one to ten. Submission attempts are reserved before ordinary tool-budget admission and do not consume that budget. Prose-only and unrelated-tool replies while correction is pending consume an unsuccessful attempt.
5. On success, the host returns a small receipt such as `{ "draft_id": "draft-1" }`. The backend records the call and result and emits the normal tool update. Without a tool that follows it, it emits the message completion and makes no further model request. With one, the server calls that tool next, and the rules below decide whether the model is asked again. It does not generate a confirmation or echo the artifact in the result.
6. The host displays its review UI from the accepted call's arguments and receipt. Without a tool that follows it, applying the draft is a separate user-confirmed action with the host's normal undo/recovery behavior; with one, the apply is the server's call and the user decides on it as on any client tool call.

Executors remain idempotent by tool-call ID. A result POST may be retried after a transport failure. Cancellation and a client timeout terminate a submission without an automatic retry, because the host may still have staged it. Existing result ownership/message checks and cross-instance delivery are unchanged; structured diagnostics are preserved on both delivery paths.

Submit a single draft in a model response, after other tools have completed. A submission mixed with other tool calls, or multiple parallel submissions, is rejected before its host executor runs. Ordinary sibling tools retain their existing behavior. A server-owned editing step selects the first offered submission tool and shares one allowance across calls; switching tools, draft IDs or snapshots cannot reset it. Switching submission tools is rejected. Charges and correction state live in `TurnConsumption` and `ToolCallCharge`, survive approval continuation, and are unchanged by result redelivery or SSE reconnects. A mixed task/submission batch is charged before task approval and remains mixed after continuation.

Starting a new user turn currently starts fresh accounting. Whether an unfinished editing step should cross that boundary remains an open policy question; this change does not decide it. Durable parking and backend-restart recovery are tracked separately in ERMAIN-944.

## Configuration

Existing tools are unaffected unless `submission` is configured:

```toml
[client_tools.tools.submit_draft]
name = "submit_draft"
namespace = "editor"
description = "Validate and stage a draft for user review. Call alone after reading the required context."
parameters = '''
{
  "type": "object",
  "properties": {
    "title": { "type": "string" },
    "items": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["title", "items"],
  "additionalProperties": false
}
'''
timeout_ms = 60000

[client_tools.tools.submit_draft.submission]
max_attempts = 5
recovery_read_tools = ["editor/read_context"]
max_recovery_reads = 32
native_schema = "auto"

[facets]
tool_call_allowlist = ["editor/submit_draft"]
```

The example's `editor/read_context` must be a separately configured non-submission client tool. Recovery names do not grant access: each read must still be offered and authorized in the current request. `max_recovery_reads` bounds calls, including pagination, separately from submission attempts (0–128; default 32). Declared reads preserve submission attempts after any rejection. They use the separate read allowance only when the host requests `read_current_context`; otherwise they still spend the ordinary tool budget. Ordinary tools and unrelated work retain their usual budgets.

The same tool selection works in regular facets and action facets. `submission` is an optional table, not a new tool type or hardcoded name.

## Parts of a submission

A large draft can be staged in parts before the submission call finishes it. `part_tools` names the configured non-submission tools whose calls stage parts; each belongs to one submission, is not durable, is no submission's recovery read, and never sets `child_access = "read"`, since a delegated task never gets the submission that finishes the draft.

```toml
[client_tools.tools.submit_draft.submission]
max_attempts = 5
part_tools = ["editor/plan_sections", "editor/write_section"]
max_part_calls = 40   # per request, across all part tools (1–200)
max_row_tries = 3     # per part (1–10)
part_key = "/row"     # JSON Pointer to the argument that names the part
```

- A part call gets the submission's checks against its own schema (string decoding, then validation) and goes to the same client as the submission. It continues generation, uses neither a submission attempt nor the ordinary tool budget, and opens the editing step if none is open.
- Its tries are counted per part: the part tool and the value of its `part_key` argument, where `2`, `2.0` and `"2"` name the same part. Calls without that argument, such as a section plan, count as one part of their tool. Every call uses one of its part's tries and one part call, accepted or not, and never a submission attempt. A part past its tries is refused before dispatch with `part_tries_exhausted` at the key's path; a keyed part is told to go on with the other parts, a keyless one to finish.
- The part calls past `max_part_calls` in the model turn that reached the limit are refused with `part_calls_exhausted`, which asks for the submission call; a part call in a later turn ends the step unresolved with `part_calls_exhausted`.
- Part results add `{ "part": { "tries_remaining": 2, "calls_remaining": 35 } }`. They carry `submission_outcome` only when the part ended the step: a timeout, a lost client, a client error, `cannot_continue` or a terminal rejection end it as they end a submission. A part refused before dispatch (no client, or the tool is not on the device) ends the step as a submission does, with the outcome in the message metadata only. `read_current_context` admits recovery reads as for a submission.
- Only the submission call can finish the draft; acceptance ends generation as before. While parts are staged and no submission call was made, the first text reply gets one reminder without using an attempt, and a second one ends the step unresolved with `model_stopped`; other tool calls are ordinary calls. After a submission call, replies without progress use attempts as before, and part calls count as progress; the reminder then asks to resend the parts the rejection names.
- Until the first submission call, the message carries no `submission_outcome` while the step is open, so staged parts show no correction notice, also at an approval or budget prompt. Once the step ends, the outcome is stored as for a submission.
- A part call of a submission other than the open one is charged and routed as an ordinary client call. Without `part_tools`, nothing changes.

## Applying an accepted submission

The model hands in a proposal: a submission the client checks. A `called_by = "server"` tool that names the submission in `follows_tool` is the operation the server then calls to apply it:

```toml
[client_tools.tools.submit_draft.submission]
more_steps_key = "/more_changes"

[client_tools.tools.apply_draft]
name = "apply_draft"
namespace = "editor"
description = "Change the open document"
parameters = '{"type":"object"}'
called_by = "server"
requires_client_registration = true
timeout_ms = 120000
follows_tool = "editor/submit_draft"
max_calls_per_message = 5
```

At most one tool follows a submission. `max_calls_per_message` and `invalidated_read_tools` are allowed only together with `follows_tool`. A config that still has a `[client_tools.tools.<id>.submission.apply]` table does not load.

- **Offer.** The apply tool is never in the model's tool list. It is offered (allowed for dispatch) only to a request whose client registered it and whose user did not set it to Never. Never also hides the submission and its part tools. A client without the apply executor gets today's flow.
- **Chain.** When the submission is accepted and the apply tool is offered, the server calls it with `{proposal_call_id, draft_id, confirmation: null}` under the call id `<submission call id>.apply`, which no model call id can take. A model provider sees it as 9 letters and digits derived from that id, since some providers refuse a `.` or longer ids. The call goes only to the client transport that owns the turn, like a live submission. It is reserved like a submission attempt: it costs no ordinary tool budget, and the per-message tool-call count is never reset. The editing step ends at acceptance, so the next change opens a fresh one. A delegated run never chains.
- **`more_steps_key`.** The pointer names a top-level boolean argument of the submission. The backend keeps the value with the call's charge and removes the argument from the dispatched and stored input of every call of the submission, chained or not, because host parsers refuse unknown fields. The schema check still sees it. The model's own assistant message keeps it, also when a continuation rebuilds the answer from the stored calls.
- **Gate.** The user's decision for the apply tool: Always runs, Never refuses, Ask or none stored asks. The receipt's `approval_preview {title, summary, actions, decide_on_screen}` titles the card. `decide_on_screen` asks even under Always, without Always on the card and without a decision by voice. The active action facet's `client_actions_always_ask`, matched against the receipt's `actions` (within the tool's `client_actions`; empty means all of them), asks every time without Always. A change request on the card makes the next chained apply ask even under Always. `approval = "every_call"` asks on every call; neither can be skipped by a device review, a covering scope or a registered operation kind.
- **Result.** The host returns `{status, verified, changed, left_out, undo_steps, snapshot, needs_follow_up, reason}`, where `status` is `applied`, `partial`, `unconfirmed`, `needs_decision`, `failed`, `stale` or `unavailable`. The backend reads only `status`, `reason` and `needs_follow_up`, and adds `changes_left`.
- **What follows.** In order: a first `needs_decision` parks the same call again as an on-screen question without a model request (a second one is recorded as `failed`, reason `needs_decision_again`); a client that went away (`unavailable`, reason `pane_gone`, set by the backend after the reconnect grace) ends the answer; any status other than `applied` (an unknown or missing one reads as `failed`), `needs_follow_up` or a true `more_steps_key` argument asks the model again; otherwise the answer ends without a model request. On the card, Cancel or Never ends without a model request unless more steps were planned, and Stop ends.
- **Stop.** A Stop never interrupts a running apply: its result is awaited, recorded, and the answer ends.
- **Cap.** After `max_calls_per_message` chained applies of any outcome, the next submission is refused before dispatch with an ordinary error that asks the model to say what is left, and counts toward the per-message tool-call limit. The second run of a call after the user's tick on screen is the same change.
- **Prompt.** The accepted submission's result reaches the model shortened to its `replay` receipt, without the preview. When the answer goes on after an apply, the earlier results in it of the operation's `invalidated_read_tools` (default: the followed submission's recovery reads) reach the model as their receipts, once; the stored results stay complete. The chained call and its result are their own assistant and tool messages.
- **Continuation.** `ApprovalItem.follows {proposal_call_id, decide_on_screen, reason}` marks the card. `ApprovalDecisionItem.client_confirmation`, at most 4 KiB of JSON on `approve` or `approve_always` of such an item, reaches the re-run call as `confirmation`. `GET /me/facets` lists the apply tools the facets reach in `approval_tools`.

The apply tool writes, so its executor must run a call at most once per call id: a backend restart drops the parked turn, and the client may see the call again.

### Proposed client actions

A `called_by = "server"` tool without `follows_tool` carries out the `client_actions` it lists. When the model proposes one of them through `propose_client_action` and the requesting client registered the tool, the server chains to it as above: call id `<proposal call id>.apply`, input `{proposal_call_id, action, item_identity}`, the same gate (the facet's `client_actions_always_ask` matched against the proposed action), the same dispatch to the owning transport and the same continue rule without a `more_steps_key` argument, so the answer ends after an action that applied cleanly. When an answer holds exactly one closed fenced block whose language the active action facet's `draft_block_actions` maps, and a model request ends with no tool call and nothing proposed yet, the server adds that `propose_client_action` itself, with the same gate and chain, and later requests replay it as the model's call; it adds none for several such blocks, under Never, or in a task run. When the model batched other calls with the proposal, they still run, and the answer then ends without another model request; a Stop or a lost pane (`pane_gone`) ends at once. `unavailable` with the reason `user_picks` also ends the answer: the answer offers several versions and the user picks one with its own button. `item_identity` is the request's `item_identity` or `document_identity` facet argument, else null; the client must act only on that item. The proposal's stored output carries `apply.call_id`. A proposal of an action whose tool the user set to Never is refused with a note that the action is turned off, so the model never swaps in another action. A change request on the chained card frees the answer's one proposal, so the model can propose the changed action. A chained proposal does not count toward any follower's `max_calls_per_message`. Actions without such a tool, or on a client that did not register it, are offered only through the client's own button where it has one, and the client still runs an action on the user's own click. The facet's `presentation` is not read. The client answers a call it already saw (same call id) from a marker it keeps across reloads, so a reply form or an insert is never repeated; a write whose outcome it cannot tell answers `unconfirmed`.

## Native schema enforcement

Server validation and host validation work with every existing tool-capable provider. Native constrained generation is an additional optimization. Enable it only for a model and endpoint verified to support strict tool arguments:

```toml
[chat_providers.providers.my_model.model_capabilities]
supports_strict_tool_calling = true
```

| Setting | Behavior |
| --- | --- |
| `auto` (default) | Enable native enforcement when the model, adapter, schema and compatibility settings permit it. Otherwise use local validation and feedback. |
| `off` | Always use local validation and feedback. |
| `required` | Refuse request preparation if native enforcement is unavailable. Never silently downgrade. |

The current dependency forwards strict arguments through OpenAI-compatible Chat Completions and Responses adapters, including the Azure routes. This does not imply every endpoint using those protocols supports strict generation. Gemini/Vertex and Ollama currently use local validation; enabling the capability flag does not pretend their adapters enforce the schema. Their native adapters can be extended independently.

Native eligibility deliberately uses a conservative schema subset: objects, arrays, scalar types, enums/constants, local definitions/references and nested `anyOf`. Every object's properties must be required and `additionalProperties` must be false. Optional values can be modeled explicitly as nullable **only if that is part of the host's actual contract**. Other valid schemas still work locally. We do not change optionality, remove constraints or silently reshape values to satisfy a provider, apart from decoding stringified arrays/objects (point 2). `compat_omit_strict = true` disables native enforcement and conflicts with `required`.

This uses strict **tool arguments**, not a global final-response JSON schema. Normal text and read tools remain available. It neither forces the model to submit nor guarantees a semantically correct draft.

## Client integration

Use the existing shared frontend registry; no application-specific backend handler is needed:

```ts
registerClientToolExecutor("submit_draft", async (input, context) => {
  const validation = validateDraft(input);
  if (!validation.ok) {
    return {
      ok: false,
      error: "Draft validation failed",
      validationErrors: validation.issues,
    };
  }
  const draftId = stageDraft(validation.value, context?.toolCallId);
  return { ok: true, result: { draft_id: draftId } };
});
```

`validationErrors` contains `{ path, code, message }` objects. `path` is a JSON Pointer into the arguments (empty string for the root); `code` is the parser's stable error identifier. Messages should say what to correct, without copying the document or draft. The backend keeps at most 16 issues, with bounded path/code/message lengths. Schema errors mask instance values. When no alternative of an `anyOf` (or `oneOf`) matches, anywhere in the schema, at the root or inside a list item, the backend reports the errors of the alternative the value aims at, not one `anyOf` issue at that value. (A `oneOf` that fails because several alternatives match stays one `oneOf` issue.) It reads them from the validator's per-alternative errors, and applies the same choice again inside the chosen alternative. The alternatives are ranked in this order: (1) the alternative's `type`, `const` or `enum` accepts the value's JSON type (one that rejects it, such as a `null` alternative for an object, comes last); (2) it accepts the value's tag, a property every alternative constrains with `const` or `enum`, not all with the same values, such as `kind` or `op`; (3) a required key of its own (one no other alternative names) is present; (4) it misses the fewest required keys; (5) it has the fewest errors; (6) it comes first. So a list item whose `kind` names one form but lacks a field of that form returns the item's path with `required`, and a list over its limit returns the list's path with `maxItems`. Three cases get one issue of their own instead: a tag value no alternative accepts returns `enum` at the tag with all allowed values; a missing tag that every alternative requires returns `required` with all allowed values; and if there is no tag and no alternative's own key is present, while every alternative has one, the backend returns `required` naming each alternative's own keys, followed by the errors all alternatives share, such as a key none of them knows. Required keys, properties and tags are read through `$ref`s that point into the schema (`#` or `#/…`). If any alternative cannot be read that way, for example one given by an anchor or built with `allOf`, or the schema uses `$id` below its root or anchors, no tag or own key is used: steps (2) and (3) and the three cases above are skipped. Empty diagnostics do not themselves signal failure; use `ok: false`/`error`.

The shared frontend sends those issues as `validation_errors` to the existing result endpoint. Nonempty issues always mean failure, even if a conflicting success result is supplied. Error strings remain supported for older executors. Submission updates add:

```json
{ "submission": { "status": "accepted", "attempts_remaining": 0 } }
```

The other statuses are `retry` and `failed`. Rejection feedback may include `submission_feedback.recovery`: `repair_arguments` (default), `read_current_context`, or `cannot_continue`. Hosts classify recovery from their parser and current request authority; the backend never interprets diagnostic prose or domain error codes. Only `read_current_context` admits declared recovery reads against the separate allowance. A missing, consumed or revoked capture must produce `cannot_continue`, not permission to recapture. The one exception is the host's own apply call (below): after it applies, or finds its capture lost, it may hand back a successor read token, because the next write still needs a new checked submission and its own decision.

Tool updates also carry a typed `submission_outcome`; the final outcome is persisted in generation metadata and exposed on `ChatMessage`. Its status is `correcting`, `accepted`, or `unresolved`, with bounded attempt counts and a stable reason such as `attempts_exhausted`, `recovery_reads_exhausted`, `part_calls_exhausted`, `context_unavailable`, `timeout`, or `cancelled`. The shared message alert shows progress and terminal notices even with verbose errors disabled. Acceptance removes correction notices. “Generate answer now” and “Stop” on a budget prompt end a pending correction with `user_requested_answer` and `user_stopped` respectively, without another model request. Generate answer now first settles any task questions asked on the same prompt, and ends once none is left open (see delegated-client-tools.md). A failed or timed-out submission is retained as a failed tool result, never converted into a draft or an apply request. Hosts can restore review state from persisted accepted tool inputs/results after a reload; keeping the draft only in transient component state is insufficient.

## Validation and token costs

Deterministic integration tests exercise the real backend/SSE/result endpoint with a mock model: server schema rejection, parser-owned corrections, successful completion without a trailing inference, retry exhaustion, parallel submissions and timeout. Unit tests cover native capability gates, offline schemas, diagnostic transport, the choice of an alternative at the root, in an entry and in a patch, and the string decoder. Frontend tests cover the typed parser feedback path.

The success path eliminates the inference that previously followed every client-tool result. The parameter schema still consumes context, and a correction still includes the previous call in history. This change does not introduce incremental patches or claim a measured reduction in total tokens. A domain consumer must still compare its actual schemas and artifacts before claiming a token saving.

Provider contracts: [OpenAI strict function calling](https://developers.openai.com/api/docs/guides/function-calling#strict-mode), [Gemini function calling modes](https://ai.google.dev/gemini-api/docs/function-calling#function_calling_modes). Adapter support above describes this repository's pinned dependency, not the providers' full capabilities.
