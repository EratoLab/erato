import { requestClientOperationSweep } from "@/lib/clientOperations/handlers";
import { withClientCallLock } from "@/lib/clientOperations/operationLock";
import { operationExecutorBinding } from "@/lib/clientOperations/registration";

import {
  clientToolAcceptsGrantCalls,
  getClientToolExecutor,
  isClientToolResultLocalOnly,
  hasClientToolCallBeenAnswered,
  markClientToolCallAnswered,
  releaseClientToolCallAbort,
  trackClientToolCallAbort,
  unmarkClientToolCallAnswered,
} from "../clientToolExecutors";

import type { ClientToolHostGrant } from "../clientToolExecutors";
import type {
  CallLineage,
  ClientToolResultRequest,
  ClientToolResultResponse,
  ExecutorBinding,
  MessageSubmitStreamingResponseClientToolCall,
  Value,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

interface HandleClientToolCallDeps {
  chatId: string | null;
  getAuthHeaders: () => Record<string, string>;
  extraHeaders?: Record<string, string>;
  /** The executor stream's binding; its result must carry it. */
  executor?: ExecutorBinding;
  /** Set on a delegated task's call, under the grant the server asserted. */
  lineage?: CallLineage;
}

const hostGrantOf = (lineage: CallLineage): ClientToolHostGrant => ({
  ownerChatId: lineage.owner_chat_id,
  ownerMessageId: lineage.owner_message_id,
  requestingChatId: lineage.requesting_chat_id,
  requestingMessageId: lineage.requesting_message_id,
  ...(lineage.context_ref ? { contextRef: lineage.context_ref } : {}),
});

/** A chat stream's event, or a call pushed over the executor stream. */
export type ClientToolCallEvent = Pick<
  MessageSubmitStreamingResponseClientToolCall,
  "message_id" | "tool_call_id" | "tool_name"
> & { input?: unknown; message_type: "client_tool_call" };

/**
 * Runs the registered executor for a `client_tool_call` and POSTs the outcome to
 * resume the suspended turn. Execute-once by `tool_call_id` (a resumestream
 * replay re-emits the event); a missing/throwing executor still POSTs an error
 * so the backend recovers instead of parking to timeout. Strict native tools are
 * the exception: their results and errors remain local, and a stale legacy call
 * expires on the backend rather than uploading private native information.
 */
export async function handleClientToolCall(
  responseData: ClientToolCallEvent,
  deps: HandleClientToolCallDeps,
): Promise<void> {
  const { message_id, tool_call_id, tool_name, input } = responseData;
  const { chatId } = deps;
  if (isClientToolResultLocalOnly(tool_name)) return;

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

  const executor = getClientToolExecutor(tool_name);
  if (!executor) {
    await postClientToolResult(
      {
        ...base,
        error: `No client-tool executor registered for "${tool_name}"`,
      },
      tool_name,
      tool_call_id,
      deps,
    );
    return;
  }
  // The server only routes a task's call to a tool advertised as taking them;
  // a handler that did not opt in has no grant check and must not run it.
  if (deps.lineage && !clientToolAcceptsGrantCalls(tool_name)) {
    await postClientToolResult(
      {
        ...base,
        error: `The client tool "${tool_name}" does not take calls from delegated tasks`,
      },
      tool_name,
      tool_call_id,
      deps,
    );
    return;
  }
  const run = async () => {
    // Tracked so the user stop pathway can abort the execution mid-flight;
    // an aborted executor settles like any failure and POSTs its error. Held
    // until the POST settles, so a parked operation's handler defers its claim.
    const signal = trackClientToolCallAbort(tool_call_id, chatId);
    try {
      let body: ClientToolResultRequest;
      try {
        const outcome = await executor(input ?? null, {
          toolCallId: tool_call_id,
          messageId: message_id,
          chatId,
          signal,
          ...(deps.lineage ? { hostGrant: hostGrantOf(deps.lineage) } : {}),
        });
        if (outcome.disposition === "local_only") return;
        body = outcome.ok
          ? // Coalesce to explicit null so an empty success is delivered as a
            // result, not treated by the backend as "no result → tool error".
            {
              ...base,
              result: (outcome.result ?? null) as unknown as Value,
              file_upload_ids: outcome.fileUploadIds,
            }
          : {
              ...base,
              error: outcome.error,
              validation_errors: outcome.validationErrors,
              submission_feedback: outcome.submissionFeedback,
            };
      } catch (error) {
        body = {
          ...base,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await postClientToolResult(body, tool_name, tool_call_id, deps);
    } finally {
      releaseClientToolCallAbort(tool_call_id);
    }
  };
  // A call that can park may already run in another pane of this browser.
  if (operationExecutorBinding(tool_name))
    await withClientCallLock(message_id, tool_call_id, run);
  else await run();
}

// The executor stream sends a call again only when another stream takes the
// binding, so a pushed call's result is retried here instead of by a replay.
const EXECUTOR_RESULT_RETRY_MS = [1_000, 2_000, 4_000, 8_000];

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Sends again after a network error or a 5xx, once per delay. */
async function sendWithRetries(
  send: () => Promise<Response>,
  delays: readonly number[],
): Promise<Response> {
  for (const delay of delays) {
    const response = await send().catch(() => undefined);
    if (response && response.status < 500) return response;
    await wait(delay);
  }
  return send();
}

async function postClientToolResult(
  body: ClientToolResultRequest,
  toolName: string,
  toolCallId: string,
  deps: HandleClientToolCallDeps,
): Promise<void> {
  if (isClientToolResultLocalOnly(toolName)) return;
  // A call with a durable operation identity only accepts its submit binding;
  // a call from the executor stream only accepts the stream's binding.
  const binding = deps.executor ?? operationExecutorBinding(toolName);
  try {
    const response = await sendWithRetries(
      () =>
        fetch("/api/v1beta/me/messages/clienttoolresult", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...deps.getAuthHeaders(),
            ...(deps.extraHeaders ?? {}),
            ...(binding ? { "X-Erato-Executor": JSON.stringify(binding) } : {}),
          },
          body: JSON.stringify(body),
        }),
      deps.executor ? EXECUTOR_RESULT_RETRY_MS : [],
    );
    if (response.ok) {
      if (binding) {
        const settled = (await response
          .json()
          .catch(() => ({}))) as Partial<ClientToolResultResponse>;
        // A result that settled a parked operation is continued from here.
        if (settled.stored) requestClientOperationSweep();
      }
      return;
    }
    // Un-mark so a resumestream replay can retry (executors are idempotent),
    // unless a durable operation already owns the bound call: a replay would
    // only conflict again.
    if (!binding || response.status !== 409)
      unmarkClientToolCallAnswered(toolCallId);
    console.warn(`[client_tool_call] result POST returned ${response.status}`);
  } catch (error) {
    unmarkClientToolCallAnswered(toolCallId);
    console.warn("[client_tool_call] result POST failed", error);
  }
}
