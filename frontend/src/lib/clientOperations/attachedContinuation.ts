/* eslint-disable lingui/no-unlocalized-strings -- HTTP and SSE protocol identifiers. */
import { mergeApiAuthHeaders } from "@/auth/apiRequestAuth";
import { getClientToolHeaders } from "@/hooks/chat/clientToolExecutors";
import { handleClientToolCall } from "@/hooks/chat/handlers/handleClientToolCall";
import { createSSEConnection } from "@/utils/sse/sseClient";

import type {
  MessageSubmitStreamingResponseClientToolCall,
  OperationRequest,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function continueAttachedOperation(
  request: OperationRequest,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let cleanup: (() => void) | undefined;
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      signal.removeEventListener("abort", abort);
      cleanup?.();
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    cleanup = createSSEConnection(
      `/api/v1beta/me/client-operations/${request.attempt_id}/continue`,
      {
        method: "POST",
        headers: {
          ...getClientToolHeaders(),
          Accept: "text/event-stream",
          "X-Erato-Executor": JSON.stringify(request.binding),
        },
        onMessage: (event) => {
          const message = JSON.parse(
            event.data,
          ) as MessageSubmitStreamingResponseClientToolCall & {
            message_type: string;
          };
          if (message.message_type === "client_tool_call") {
            void handleClientToolCall(
              { ...message, message_type: "client_tool_call" },
              {
                chatId: request.chat_id,
                getAuthHeaders: mergeApiAuthHeaders,
              },
            );
          } else if (message.message_type === "stream_end") {
            finish();
          }
        },
        onError: finish,
        onClose: () => finish(),
      },
    );
  });
}
