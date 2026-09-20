/**
 * The UI-facing payload of a delegation tool call — `delegate_to_assistant`
 * for an @-mentioned assistant, `delegate_task` for a task the model planned
 * itself. Both routes produce the same envelope.
 *
 * The model only ever sees the compact tool response; this envelope rides the
 * tool part's `output` for the transcript. Every progress frame republishes
 * the whole envelope, so one frame is the full picture and the live, resumed,
 * and reloaded views all parse the same thing.
 *
 * A backgrounded dispatch freezes its part at launch: identity plus a
 * `background` marker, never a status — the run settles out of sight.
 *
 * A dispatch that never happened returns `{status: "error", error}` instead —
 * no run, no chat to open, nothing to nest — and is deliberately not an
 * envelope here, so the call renders like any other tool call.
 */

// eslint-disable-next-line lingui/no-unlocalized-strings -- tool identifier
export const DELEGATION_TOOL_NAME = "delegate_to_assistant";

/**
 * The model-planned task route. The model sees the bare name; `erato/` is
 * allowlist selection syntax on the backend and never reaches the wire.
 */
// eslint-disable-next-line lingui/no-unlocalized-strings -- tool identifier
export const DELEGATE_TASK_TOOL_NAME = "delegate_task";

/**
 * Both routes into the same envelope. A step is a delegation step because of
 * the tool that produced it, never because of what the envelope contains: a
 * task child speaks as the origin chat's assistant under the default persona,
 * so it carries an assistant name just like an @-mention run does.
 */
export const DELEGATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  DELEGATION_TOOL_NAME,
  DELEGATE_TASK_TOOL_NAME,
]);

export function isDelegationToolName(name: string | undefined): boolean {
  return name !== undefined && DELEGATION_TOOL_NAMES.has(name);
}

/**
 * Statuses a run can report. A value outside this set is some other tool's
 * output, not ours to render.
 *
 * `timeout` is legacy — the backend stopped writing it in favour of
 * `cancelled` plus `reason: "timeout"` — but parts persisted before that
 * change replay forever, so it stays accepted and keeps its own label.
 *
 * `queued` is the placeholder value of a batch slot beyond `max_parallel`,
 * and `input_required` a child parked on an approval; both are accepted here
 * before anything emits them, so the backend may start emitting them without
 * a frontend deploy in front of it.
 */
const RUN_STATUSES = new Set([
  "queued",
  "working",
  // eslint-disable-next-line lingui/no-unlocalized-strings -- wire value
  "input_required",
  "completed",
  "failed",
  "cancelled",
  "dispatched",
  "timeout",
]);

/** Bound on identifiers rendered in the step title. */
const MAX_NAME_CHARS = 128;

export interface DelegationEnvelope {
  /** Absent while the delegate is still running — or forever, when detached. */
  status?: string;
  /**
   * Why the run ended the way it did, for the outcomes where the status alone
   * is not the whole story — a `cancelled` that timed out, a `completed` that
   * ran out of budget. Drawn from a closed list; an unknown value is rendered
   * verbatim rather than dropped, so a newer backend degrades to readable.
   */
  reason?: string;
  assistantId?: string;
  assistantName?: string;
  delegateChatId?: string;
  /** The tool call in the origin chat this run answers. */
  parentToolCallId?: string;
  result?: string;
  /**
   * The dispatch detached: the parent turn ended at launch, the part is
   * frozen as-is, and the run's outcome will never arrive here.
   */
  background: boolean;
  /**
   * Which detached mode a `background` part actually is. `"async"` means the
   * run's answer does come home, as its own message in this conversation;
   * absent means it never will. Only ever set alongside `background`.
   */
  runMode?: string;
  /** Whether the backend clipped `result` before sending it. */
  truncated: boolean;
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return [...trimmed].slice(0, maxChars).join("");
}

/**
 * Read a delegation envelope off a tool output, or `undefined` when the
 * output is anything else — absent, malformed, a refusal, or a foreign tool's
 * result. Callers fall back to the plain tool-call rendering on `undefined`.
 */
export function parseDelegationEnvelope(
  output: unknown,
): DelegationEnvelope | undefined {
  if (typeof output !== "object" || output === null || Array.isArray(output)) {
    return undefined;
  }
  const record = output as Record<string, unknown>;
  const status = boundedString(record.status, MAX_NAME_CHARS);
  if (status === "error") {
    return undefined;
  }
  // `child_run_id` is the same id under the name the newer envelope uses;
  // reading both means neither writer can leave the run unopenable.
  const delegateChatId =
    boundedString(record.delegate_chat_id, MAX_NAME_CHARS) ??
    boundedString(record.child_run_id, MAX_NAME_CHARS);
  // A run is ours to render once it has an identity or a status we know. A
  // status-carrying part needs no run: a slot queued behind `max_parallel`
  // has not launched anything yet, and a never-launched slot that settles
  // `cancelled` never will.
  if (
    delegateChatId === undefined &&
    (status === undefined || !RUN_STATUSES.has(status))
  ) {
    return undefined;
  }
  return {
    status,
    reason: boundedString(record.reason, MAX_NAME_CHARS),
    assistantId: boundedString(record.assistant_id, MAX_NAME_CHARS),
    assistantName: boundedString(record.assistant_name, MAX_NAME_CHARS),
    delegateChatId,
    parentToolCallId: boundedString(record.parent_tool_call_id, MAX_NAME_CHARS),
    result: typeof record.result === "string" ? record.result : undefined,
    // The marker only means "settled at dispatch" on a status-less part with
    // a run to point at; anything else keeps its own meaning.
    background:
      record.background === true &&
      status === undefined &&
      delegateChatId !== undefined,
    runMode: boundedString(record.run_mode, MAX_NAME_CHARS),
    truncated: record.truncated === true,
  };
}
