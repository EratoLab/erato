/**
 * The UI-facing payload of a `delegate_to_assistant` tool call.
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

/** Statuses a dispatched run can settle in. */
const SETTLED_STATUSES = new Set([
  "completed",
  "failed",
  "timeout",
  "cancelled",
]);

/** Bound on identifiers rendered in the step title. */
const MAX_NAME_CHARS = 128;

export interface DelegationEnvelope {
  /** Absent while the delegate is still running — or forever, when detached. */
  status?: string;
  assistantId?: string;
  assistantName?: string;
  delegateChatId?: string;
  result?: string;
  /**
   * The dispatch detached: the parent turn ended at launch, the part is
   * frozen as-is, and the run's outcome will never arrive here.
   */
  background: boolean;
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
  const delegateChatId = boundedString(record.delegate_chat_id, MAX_NAME_CHARS);
  // A run is only ours to render once it has an identity or an outcome.
  if (
    delegateChatId === undefined &&
    (status === undefined || !SETTLED_STATUSES.has(status))
  ) {
    return undefined;
  }
  return {
    status,
    assistantId: boundedString(record.assistant_id, MAX_NAME_CHARS),
    assistantName: boundedString(record.assistant_name, MAX_NAME_CHARS),
    delegateChatId,
    result: typeof record.result === "string" ? record.result : undefined,
    // The marker only means "settled at dispatch" on a status-less part with
    // a run to point at; anything else keeps its own meaning.
    background:
      record.background === true &&
      status === undefined &&
      delegateChatId !== undefined,
    truncated: record.truncated === true,
  };
}
