/**
 * Registry for client-executed tools. The host (e.g. the Outlook add-in)
 * registers executors by tool name; the shared streaming loop looks them up when
 * the backend emits a `client_tool_call`. Executors MUST be read-only /
 * idempotent — a backend restart drops the parked turn and the client may
 * re-execute on recovery; mutations belong on `propose_client_action`.
 */

export type ClientToolExecutionResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

/**
 * Identifiers of the call being executed. Additive second parameter: existing
 * one-parameter executors stay assignable, and hosts that need to correlate
 * (e.g. keying an on-device trace by tool call, or a consent by chat) opt in.
 */
export interface ClientToolCallContext {
  toolCallId: string;
  messageId: string;
  chatId: string | null;
  /**
   * Fires when the user aborts the turn (the stop action behind the
   * abortstream POST) — deliberately NOT on SSE transport loss, which resumes
   * and replays, so an executor that kept running still delivers its result.
   * Executors doing long on-device work should forward it (e.g. as a sidecar
   * invoke's `signal`) so a stopped turn stops the device too.
   */
  signal?: AbortSignal;
}

export type ClientToolExecutor = (
  input: unknown,
  context?: ClientToolCallContext,
) => Promise<ClientToolExecutionResult>;

const executors = new Map<string, ClientToolExecutor>();

/** Register an executor by tool name; returns an unregister function. */
export function registerClientToolExecutor(
  name: string,
  executor: ClientToolExecutor,
): () => void {
  executors.set(name, executor);
  return () => {
    if (executors.get(name) === executor) {
      executors.delete(name);
    }
  };
}

export function getClientToolExecutor(
  name: string,
): ClientToolExecutor | undefined {
  return executors.get(name);
}

// tool_call_ids handled this session, so a resumestream replay never re-runs a
// tool. Capped — idempotent executors make evicting the oldest safe.
const MAX_ANSWERED_TOOL_CALLS = 500;
const answeredToolCallIds = new Set<string>();

export function markClientToolCallAnswered(toolCallId: string): void {
  answeredToolCallIds.add(toolCallId);
  if (answeredToolCallIds.size > MAX_ANSWERED_TOOL_CALLS) {
    const oldest = answeredToolCallIds.values().next().value;
    if (oldest !== undefined) answeredToolCallIds.delete(oldest);
  }
}

/** Un-mark after a failed delivery so a resumestream replay can retry. */
export function unmarkClientToolCallAnswered(toolCallId: string): void {
  answeredToolCallIds.delete(toolCallId);
}

export function hasClientToolCallBeenAnswered(toolCallId: string): boolean {
  return answeredToolCallIds.has(toolCallId);
}

// One controller per running execution, grouped by chat, so the stop action
// cancels exactly that turn's on-device work.
const abortControllers = new Map<
  string,
  { chatId: string; controller: AbortController }
>();

/** Track a starting execution; the returned signal goes into its context. */
export function trackClientToolCallAbort(
  toolCallId: string,
  chatId: string,
): AbortSignal {
  const controller = new AbortController();
  abortControllers.set(toolCallId, { chatId, controller });
  return controller.signal;
}

/** Drop the controller once the execution settles, whatever the outcome. */
export function releaseClientToolCallAbort(toolCallId: string): void {
  abortControllers.delete(toolCallId);
}

/**
 * Fire the signal of every execution still running for `chatId`. Called from
 * the user stop pathway only (`cancelMessage`, next to the abortstream POST)
 * — never from SSE cleanup, so a dropped connection cannot kill an execution
 * that could still deliver on resume.
 */
export function abortClientToolCalls(chatId: string): void {
  for (const [toolCallId, tracked] of abortControllers) {
    if (tracked.chatId === chatId) {
      abortControllers.delete(toolCallId);
      tracked.controller.abort();
    }
  }
}

export function resetClientToolRegistryForTests(): void {
  executors.clear();
  answeredToolCallIds.clear();
  abortControllers.clear();
}
