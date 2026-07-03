import {
  getClientToolExecutor,
  hasClientToolCallBeenAnswered,
  markClientToolCallAnswered,
  unmarkClientToolCallAnswered,
} from "../clientToolExecutors";

import type {
  ClientToolResultRequest,
  MessageSubmitStreamingResponseClientToolCall,
  Value,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface HandleClientToolCallDeps {
  chatId: string | null;
  getAuthHeaders: () => Record<string, string>;
  extraHeaders?: Record<string, string>;
}

/**
 * Runs the registered executor for a `client_tool_call` and POSTs the outcome to
 * resume the suspended turn. Execute-once by `tool_call_id` (a resumestream
 * replay re-emits the event); a missing/throwing executor still POSTs an error
 * so the backend recovers instead of parking to timeout.
 */
export async function handleClientToolCall(
  responseData: MessageSubmitStreamingResponseClientToolCall & {
    message_type: "client_tool_call";
  },
  deps: HandleClientToolCallDeps,
): Promise<void> {
  const { message_id, tool_call_id, tool_name, input } = responseData;
  const { chatId } = deps;

  if (!chatId || !message_id || !tool_call_id || !tool_name) {
    console.warn("[client_tool_call] missing required fields", responseData);
    return;
  }

  // Guard before any await so a live event and its replay can't both run it.
  if (hasClientToolCallBeenAnswered(tool_call_id)) {
    return;
  }
  markClientToolCallAnswered(tool_call_id);

  const base = { chat_id: chatId, message_id, tool_call_id };
  let body: ClientToolResultRequest;

  const executor = getClientToolExecutor(tool_name);
  if (!executor) {
    body = {
      ...base,
      error: `No client-tool executor registered for "${tool_name}"`,
    };
  } else {
    try {
      const outcome = await executor(input ?? null);
      body = outcome.ok
        ? // Coalesce to explicit null so an empty success is delivered as a
          // result, not treated by the backend as "no result → tool error".
          { ...base, result: (outcome.result ?? null) as unknown as Value }
        : { ...base, error: outcome.error };
    } catch (error) {
      body = {
        ...base,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  try {
    const response = await fetch("/api/v1beta/me/messages/clienttoolresult", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...deps.getAuthHeaders(),
        ...(deps.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      // Un-mark so a resumestream replay can retry (executors are idempotent).
      unmarkClientToolCallAnswered(tool_call_id);
      console.warn(
        `[client_tool_call] result POST returned ${response.status}`,
      );
    }
  } catch (error) {
    unmarkClientToolCallAnswered(tool_call_id);
    console.warn("[client_tool_call] result POST failed", error);
  }
}
