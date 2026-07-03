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

export type ClientToolExecutor = (
  input: unknown,
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

// tool_call_ids handled this session, so a resumestream replay never re-runs a tool.
const answeredToolCallIds = new Set<string>();

export function markClientToolCallAnswered(toolCallId: string): void {
  answeredToolCallIds.add(toolCallId);
}

export function hasClientToolCallBeenAnswered(toolCallId: string): boolean {
  return answeredToolCallIds.has(toolCallId);
}

export function resetClientToolRegistryForTests(): void {
  executors.clear();
  answeredToolCallIds.clear();
}
