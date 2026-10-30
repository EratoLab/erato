/* eslint-disable lingui/no-unlocalized-strings -- Fixed protocol codes. */
import {
  clientToolAcceptsGrantCalls,
  isClientToolCallInFlight,
  isClientToolResultLocalOnly,
  markClientToolCallAnswered,
  runClientToolCall,
} from "@/hooks/chat/clientToolExecutors";

import type { ClientOperationHandler } from "./coordinator";
import type {
  ClientToolExecutionResult,
  ClientToolExecutor,
} from "@/hooks/chat/clientToolExecutors";
import type {
  ExecutorBinding,
  OperationPayload,
  OperationRequest,
  OperationResult,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const CLIENT_TOOL_OPERATION_KIND = "client_tool.v1";

// The server rejects a longer claimed message and cleans it the same way.
const MAX_MESSAGE_CHARS = 1024;

function cleanMessage(message: string): string | undefined {
  const cleaned = Array.from(message.replace(/\p{Cc}/gu, " ").trim())
    .slice(0, MAX_MESSAGE_CHARS)
    .join("")
    .trimEnd();
  return cleaned || undefined;
}

function settle(
  request: OperationRequest,
  outcome: Pick<OperationResult, "outcome" | "result" | "error">,
): OperationResult {
  return {
    attempt_id: request.attempt_id,
    operation_id: request.operation_id,
    ...(request.base_revision === undefined
      ? {}
      : { base_revision: request.base_revision }),
    executor: request.binding,
    ...outcome,
  };
}

function failed(request: OperationRequest, message?: string): OperationResult {
  const cleaned = message === undefined ? undefined : cleanMessage(message);
  return settle(request, {
    outcome: "failed",
    error: cleaned
      ? { code: "execution_failed", message: cleaned }
      : { code: "execution_failed" },
  });
}

/** Maps a client-tool executor outcome onto the `client_tool.v1` result shape.
 * Uploaded files travel as their ids beside the value; the server reads them
 * as the user when it writes the tool's output. */
export function toOperationResult(
  request: OperationRequest,
  outcome: ClientToolExecutionResult,
): OperationResult {
  if (outcome.ok) {
    if (outcome.disposition === "local_only") return failed(request);
    const files = outcome.fileUploadIds ?? [];
    return settle(request, {
      outcome: "succeeded",
      result: {
        type: "value",
        value: (outcome.result ?? null) as OperationPayload,
        // Only when there are any, so a result without files keeps the shape
        // an older server accepts.
        ...(files.length ? { file_upload_ids: files } : {}),
      },
    });
  }
  // Only a task's call reports a decline on the device as such; the user's own
  // call keeps the validation shape its host family already reads.
  if (
    request.lineage &&
    outcome.validationErrors?.some((issue) => issue.code === "declined")
  )
    return settle(request, {
      outcome: "rejected",
      error: { code: "declined" },
    });
  if (outcome.validationErrors?.length)
    return settle(request, {
      outcome: "rejected",
      error: {
        code: "validation_failed",
        ...(request.binding.host_context?.kind === "word_document"
          ? {
              validation: {
                issues: outcome.validationErrors,
                ...(outcome.submissionFeedback
                  ? { feedback: outcome.submissionFeedback }
                  : {}),
              },
            }
          : {}),
      },
    });
  return failed(request, outcome.error);
}

/** Runs one configured client tool for its parked `client_tool.v1` operations,
 * through the same executor that answers the live call. */
export class ClientToolOperationHandler implements ClientOperationHandler {
  readonly kind = CLIENT_TOOL_OPERATION_KIND;
  constructor(
    readonly toolName: string,
    private readonly run: ClientToolExecutor,
    private readonly binding: () => ExecutorBinding | undefined,
    private readonly ready: () => boolean = () => true,
    private readonly inFlight: (
      toolCallId: string,
    ) => boolean = isClientToolCallInFlight,
  ) {}
  // By bare name, like the live call's executor lookup: the namespace is
  // deployment configuration the pane does not know.
  matches(request: OperationRequest): boolean {
    return (
      request.kind === this.kind &&
      request.operation_id.split("/").at(-1) === this.toolName &&
      (!request.lineage || clientToolAcceptsGrantCalls(this.toolName))
    );
  }
  defer(request: OperationRequest): boolean {
    return this.inFlight(request.tool_call_id);
  }
  executor(): ExecutorBinding | undefined {
    return this.ready() ? this.binding() : undefined;
  }
  async execute(
    request: OperationRequest,
    _claim: unknown,
    signal: AbortSignal,
  ): Promise<OperationResult | undefined> {
    // A resumestream replay of the live call must not run the tool again.
    markClientToolCallAnswered(request.tool_call_id);
    let outcome: ClientToolExecutionResult | undefined;
    try {
      outcome = await runClientToolCall(
        this.toolName,
        this.run,
        request.input,
        {
          toolCallId: request.tool_call_id,
          messageId: request.message_id,
          chatId: request.chat_id,
          signal,
        },
        request.lineage,
      );
    } catch {
      outcome = undefined;
    }
    signal.throwIfAborted();
    // A declaration that arrived while the tool ran keeps everything on the
    // device, and the mode will not change back soon enough to wait for it.
    if (isClientToolResultLocalOnly(this.toolName)) return failed(request);
    // A task's call whose context this device cannot serve right now keeps
    // waiting for a client that can, rather than ending the task's call.
    if (
      request.lineage &&
      outcome &&
      !outcome.ok &&
      outcome.validationErrors?.some(
        (issue) => issue.code === "context_unavailable",
      )
    )
      return undefined;
    return outcome ? toOperationResult(request, outcome) : failed(request);
  }
}
