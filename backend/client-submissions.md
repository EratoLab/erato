# Validated client submissions

A submission is an opt-in client tool that validates and stages a structured draft for review. A successful result ends generation immediately. Ordinary client tools still return their results to the model and continue generation.

This is infrastructure for hosts that need a typed artifact. It does not implement an editor, an artifact schema, a review UI, or permission to apply changes. Domain schemas and model instructions remain deployment configuration; the host owns semantic validation and user confirmation.

## Contract

1. The model calls the submission tool with an object matching its parameter schema. The artifact is the tool arguments themselves, not JSON encoded inside a string.
2. The backend validates those arguments against the configured JSON Schema before dispatching to the client. Schemas compile offline; local `$defs`/`$ref` references are supported, external retrieval is disabled.
3. The host validates domain rules using its authoritative parser: references, current state, supported operations, permissions, and so on. The executor may stage a draft but must not apply it.
4. On failure, the tool result contains compact `validation_errors` and the remaining attempt count. Only a failed submission resumes inference. The default allows three attempts total (the initial attempt plus two corrections), configurable from one to ten. The existing generation-wide tool limit still applies.
5. On success, the host returns a small receipt such as `{ "draft_id": "draft-1" }`. The backend records the call and result, emits the normal tool update and message completion, and makes no further model request. It does not generate a confirmation or echo the artifact in the result.
6. The host displays its review UI from the accepted call's arguments and receipt. Applying the draft is a separate user-confirmed action with the host's normal undo/recovery behavior.

Executors remain idempotent by tool-call ID. A result POST may be retried after a transport failure. Cancellation and a client timeout terminate a submission without an automatic retry, because the host may still have staged it. Existing result ownership/message checks and cross-instance delivery are unchanged; structured diagnostics are preserved on both delivery paths.

Submit a single draft in a model response, after other tools have completed. A submission mixed with other tool calls, or multiple parallel submissions, is rejected before its host executor runs. Ordinary sibling tools retain their existing behavior. Attempt counts belong to the offered tool's identity and the current generation; starting a new user turn resets them.

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
max_attempts = 3
native_schema = "auto"

[facets]
tool_call_allowlist = ["editor/submit_draft"]
```

The same tool selection works in regular facets and action facets. `submission` is an optional table, not a new tool type or hardcoded name.

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

Native eligibility deliberately uses a conservative schema subset: objects, arrays, scalar types, enums/constants, local definitions/references and nested `anyOf`. Every object's properties must be required and `additionalProperties` must be false. Optional values can be modeled explicitly as nullable **only if that is part of the host's actual contract**. Other valid schemas still work locally. We do not change optionality, remove constraints or silently reshape values to satisfy a provider. `compat_omit_strict = true` disables native enforcement and conflicts with `required`.

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

`validationErrors` contains `{ path, code, message }` objects. `path` is a JSON Pointer into the arguments (empty string for the root); `code` is the parser's stable error identifier. Messages should say what to correct, without copying the document or draft. The backend keeps at most 16 issues, with bounded path/code/message lengths. Schema errors mask instance values. Empty diagnostics do not themselves signal failure; use `ok: false`/`error`.

The shared frontend sends those issues as `validation_errors` to the existing result endpoint. Nonempty issues always mean failure, even if a conflicting success result is supplied. Error strings remain supported for older executors. Submission updates add:

```json
{ "submission": { "status": "accepted", "attempts_remaining": 0 } }
```

The other statuses are `retry` and `failed`. A failed or timed-out submission is retained as a failed tool result, never converted into a draft or an apply request. Hosts can restore review state from persisted accepted tool inputs/results after a reload; keeping the draft only in transient component state is insufficient.

## Validation and token costs

Deterministic integration tests exercise the real backend/SSE/result endpoint with a mock model: server schema rejection, parser-owned corrections, successful completion without a trailing inference, retry exhaustion, parallel submissions and timeout. Unit tests cover native capability gates, offline schemas and diagnostic transport. Frontend tests cover the typed parser feedback path.

The success path eliminates the inference that previously followed every client-tool result. The parameter schema still consumes context, and a correction still includes the previous call in history. This change does not introduce incremental patches or claim a measured reduction in total tokens. A domain consumer must still compare its actual schemas and artifacts before claiming a token saving.

Provider contracts: [OpenAI strict function calling](https://developers.openai.com/api/docs/guides/function-calling#strict-mode), [Gemini function calling modes](https://ai.google.dev/gemini-api/docs/function-calling#function_calling_modes). Adapter support above describes this repository's pinned dependency, not the providers' full capabilities.
