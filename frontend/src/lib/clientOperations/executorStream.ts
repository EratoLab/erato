/* eslint-disable lingui/no-unlocalized-strings -- HTTP and SSE protocol identifiers. */
import { mergeApiAuthHeaders } from "@/auth/apiRequestAuth";
import {
  clientToolAcceptsGrantCalls,
  getChildClientToolHeaders,
  getClientToolExecutor,
  getClientToolHeaders,
} from "@/hooks/chat/clientToolExecutors";
import { handleClientToolCall } from "@/hooks/chat/handlers/handleClientToolCall";
import { FrontendRequestError } from "@/utils/errorReport";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { additionalOperationBindings } from "./registration";

import type {
  ExecutorBinding,
  ExecutorStreamEvent,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export const EXECUTOR_STREAM_URL = "/api/v1beta/me/client-operations/stream";
const FIRST_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/** A UUIDv7: its first 48 bits are the creation time in milliseconds. */
function uuidV7(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  let time = Date.now();
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [0, 4, 6, 8, 10]
    .map((start, part, starts) => hex.slice(start, starts[part + 1]).join(""))
    .join("-");
}

/** This pane, for every stream it opens: the server sends a delivered call
 * again only to the same pane, and new calls to the newest pane. */
const PANE_INSTANCE = uuidV7();

/** The pane's instance, which a page without storage claims as. */
export function paneInstance(): string {
  return PANE_INSTANCE;
}

/** The headers this pane would open its stream with, or `undefined` while it
 * has no binding or no tools. A change means the stream must reopen. */
export function executorStreamHeaders(): Record<string, string> | undefined {
  const { "X-Erato-Additional-Executors": _submitOnly, ...headers } = {
    ...getClientToolHeaders(),
    ...getChildClientToolHeaders(),
  };
  if (!headers["X-Erato-Executor"] || !headers["X-Erato-Client-Tools"])
    return undefined;
  return headers;
}

export interface ExecutorStreamHeaderSet {
  headers: Record<string, string>;
  /** Held by one pane of the browser profile (Web Locks) instead of one per pane. */
  shared: boolean;
}

/** One header set per binding the pane serves; the first is the primary,
 * computed as before. Tabs of one browser profile share an additional binding,
 * so one of them holds its stream. */
export function executorStreamHeaderSets(): ExecutorStreamHeaderSet[] {
  const primary = executorStreamHeaders();
  const sets: ExecutorStreamHeaderSet[] = primary
    ? [{ headers: primary, shared: false }]
    : [];
  for (const { binding, names } of additionalOperationBindings()) {
    const serialized = JSON.stringify(binding);
    if (serialized === primary?.["X-Erato-Executor"]) continue;
    const available = names.filter((name) => getClientToolExecutor(name));
    if (!available.length) continue;
    const children = available.filter(clientToolAcceptsGrantCalls);
    sets.push({
      headers: {
        "X-Erato-Executor": serialized,
        "X-Erato-Client-Tools": available.join(","),
        ...(children.length
          ? { "X-Erato-Child-Client-Tools": children.join(",") }
          : {}),
      },
      shared: true,
    });
  }
  return sets;
}

/**
 * The pane's executor stream. It runs live calls pushed from any of the
 * account's chats through the client tool executors, hands each to `onCall`
 * until its result is posted, and reports new durable operations for its
 * binding. It reconnects with backoff, and ends on abort or when the server
 * has executor streams disabled (404).
 */
export function openExecutorStream(
  headers: Record<string, string>,
  onNudge: () => void,
  signal: AbortSignal,
  onCall?: (call: Promise<unknown>) => void,
): Promise<void> {
  const executor = JSON.parse(headers["X-Erato-Executor"]) as ExecutorBinding;
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
          "X-Erato-Executor-Instance": PANE_INSTANCE,
          Accept: "text/event-stream",
        },
        onOpen: () => {
          delay = FIRST_RETRY_MS;
        },
        onMessage: (event) => {
          const message = JSON.parse(event.data) as ExecutorStreamEvent;
          if (message.message_type === "client_tool_call") {
            const call = handleClientToolCall(
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
                timeoutMs: message.timeout_ms,
              },
            );
            onCall?.(call);
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
