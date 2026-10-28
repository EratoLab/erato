/* eslint-disable lingui/no-unlocalized-strings -- HTTP and SSE protocol identifiers. */
import { mergeApiAuthHeaders } from "@/auth/apiRequestAuth";
import {
  getChildClientToolHeaders,
  getClientToolHeaders,
} from "@/hooks/chat/clientToolExecutors";
import { handleClientToolCall } from "@/hooks/chat/handlers/handleClientToolCall";
import { FrontendRequestError } from "@/utils/errorReport";
import { createSSEConnection } from "@/utils/sse/sseClient";

import type {
  ExecutorBinding,
  ExecutorStreamEvent,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const EXECUTOR_STREAM_URL = "/api/v1beta/me/client-operations/stream";
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** The headers this pane would open its stream with, or `undefined` while it
 * has no binding or no tools. A change means the stream must reopen. */
export function executorStreamHeaders(): Record<string, string> | undefined {
  const headers = { ...getClientToolHeaders(), ...getChildClientToolHeaders() };
  if (!headers["X-Erato-Executor"] || !headers["X-Erato-Client-Tools"])
    return undefined;
  return headers;
}

/**
 * The pane's executor stream. It runs live calls pushed from any of the
 * account's chats through the client tool executors, and reports new durable
 * operations for its binding. It reconnects with backoff, and ends on abort or
 * when the server has executor streams disabled (404). Every reconnect sends
 * the same `X-Erato-Executor-Instance`, so the server hands the binding over
 * at once even while it still holds a connection that dropped silently.
 */
export function openExecutorStream(
  headers: Record<string, string>,
  onNudge: () => void,
  signal: AbortSignal,
): Promise<void> {
  const executor = JSON.parse(headers["X-Erato-Executor"]) as ExecutorBinding;
  const instance = globalThis.crypto.randomUUID();
  return new Promise((resolve) => {
    let cleanup: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = FIRST_RETRY_MS;
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      const close = cleanup;
      cleanup = undefined;
      close?.();
      resolve();
    };
    const connect = () => {
      let ended = false;
      const end = (error?: Error | Event) => {
        if (ended) return;
        ended = true;
        const close = cleanup;
        cleanup = undefined;
        close?.();
        if (
          signal.aborted ||
          (error instanceof FrontendRequestError &&
            error.response?.status === 404)
        ) {
          stop();
          return;
        }
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, MAX_RETRY_MS);
      };
      cleanup = createSSEConnection(EXECUTOR_STREAM_URL, {
        method: "GET",
        headers: {
          ...headers,
          "X-Erato-Executor-Instance": instance,
          Accept: "text/event-stream",
        },
        onOpen: () => {
          delay = FIRST_RETRY_MS;
        },
        onMessage: (event) => {
          const message = JSON.parse(event.data) as ExecutorStreamEvent;
          if (message.message_type === "client_tool_call") {
            void handleClientToolCall(
              {
                message_type: "client_tool_call",
                message_id: message.message_id,
                tool_call_id: message.tool_call_id,
                tool_name: message.tool_name,
                input: message.input,
              },
              {
                chatId: message.chat_id,
                getAuthHeaders: mergeApiAuthHeaders,
                executor,
                lineage: message.lineage,
              },
            );
          } else {
            onNudge();
          }
        },
        onError: end,
        onClose: () => end(),
      });
    };
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
    connect();
  });
}
