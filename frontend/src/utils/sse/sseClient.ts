/**
 * Server-Sent Events (SSE) client utility
 *
 * This utility provides a wrapper around the EventSource API to handle SSE connections
 * with support for custom headers and event handling.
 *
 * Note: The native EventSource API doesn't support custom headers.
 */

import { mergeApiAuthHeaders } from "@/auth/apiRequestAuth";
import { tryRecoverAuth } from "@/auth/authRecovery";
import { FrontendRequestError, sanitizeHeaders } from "@/utils/errorReport";

import { createLogger } from "../debugLogger";

// SSE event interface
export interface SSEEvent {
  data: string;
  type: string;
  id?: string;
}

// Options for SSE connection
export interface SSEOptions {
  headers?: Record<string, string>;
  onMessage?: (event: SSEEvent) => void;
  onError?: (error: Error | Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  method?: "GET" | "POST"; // HTTP method to use
  body?: string; // Request body for POST requests
}

const logger = createLogger("NETWORK", "SSE_CLIENT");

const isAbortError = (error: unknown) =>
  error instanceof Error && error.name === "AbortError";

const getResponseContext = (response: Response, body?: string) => ({
  status: response.status,
  statusText: response.statusText,
  headers: sanitizeHeaders(response.headers),
  body,
});

/**
 * Creates an SSE connection to the specified URL
 *
 * @param url The URL to connect to
 * @param options Configuration options including headers and event handlers
 * @returns A cleanup function to close the connection
 */
export function createSSEConnection(url: string, options: SSEOptions = {}) {
  const {
    onMessage,
    onError,
    onOpen,
    onClose,
    headers = {},
    method = "GET",
    body,
  } = options;

  const effectiveHeaders = mergeApiAuthHeaders({
    ...(method === "POST" && { "Content-Type": "application/json" }),
    ...headers,
  });

  logger.log(`Creating ${method} connection to: ${url}`);

  let abortController: AbortController | null = null;
  let isConnected = false;
  let isClosed = false;

  const closeOnce = () => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    onClose?.();
  };

  // For GET requests, use the native EventSource
  if (
    method === "GET" &&
    typeof EventSource !== "undefined" &&
    Object.keys(effectiveHeaders).length === 0
  ) {
    logger.log("Using native EventSource for GET");
    // Create URL with query params if there's a body for GET
    const requestUrl = body
      ? `${url}?${new URLSearchParams({ data: body }).toString()}`
      : url;

    const eventSource = new EventSource(requestUrl);

    eventSource.onopen = () => {
      logger.log("Native EventSource connection opened");
      isConnected = true;
      onOpen?.();
    };

    eventSource.onerror = (event: Event) => {
      logger.log("Native EventSource error:", event);
      isConnected = false;
      onError?.(
        new FrontendRequestError("SSE connection error", {
          method,
          url: requestUrl,
          body,
        }),
      );
    };

    eventSource.onmessage = (event: MessageEvent) => {
      if (onMessage && event.data) {
        const sseEvent: SSEEvent = {
          data: event.data,
          type: event.type || "message",
          id: event.lastEventId,
        };

        onMessage(sseEvent);
      }
    };

    // Return cleanup function
    return () => {
      if (isConnected) {
        logger.log("Closing native EventSource connection");
        eventSource.close();
        isConnected = false;
        closeOnce();
      }
    };
  }

  // For POST requests or environments without EventSource, use fetch
  logger.log("Using fetch-based approach for", method);
  abortController = new AbortController();
  const { signal } = abortController;

  // Async generator over the stream reader
  async function* streamAsyncIterator(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {
    try {
      let result = await reader.read();
      while (!result.done) {
        yield result.value;
        result = await reader.read();
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Function to parse SSE stream from fetch
  const readSSEStream = async (stream: ReadableStream<Uint8Array>) => {
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = stream.getReader();

    try {
      logger.log("Stream connected, starting to read using async generator");
      isConnected = true;
      onOpen?.();

      for await (const value of streamAsyncIterator(reader)) {
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process any complete events in the buffer
        const lines = buffer.split("\n\n");

        // Last element might be incomplete, so keep it in the buffer
        buffer = lines.pop() ?? "";

        if (lines.length > 0) {
          logger.log(`Received ${lines.length} events`);
        }

        for (const block of lines) {
          if (block.trim() === "") continue;

          const eventDataLines: string[] = [];
          let eventType = "message";
          let eventId: string | undefined;

          for (const rawLine of block.split("\n")) {
            const parsedLine = rawLine.replace(/\r$/, "");
            if (parsedLine === "" || parsedLine.startsWith(":")) {
              continue;
            }

            const colonIndex = parsedLine.indexOf(":");
            const field =
              colonIndex === -1
                ? parsedLine.trim()
                : parsedLine.slice(0, colonIndex).trim();
            const rawValue =
              colonIndex === -1 ? "" : parsedLine.slice(colonIndex + 1);
            const value = rawValue.startsWith(" ")
              ? rawValue.slice(1)
              : rawValue;

            if (field === "data") {
              eventDataLines.push(value);
            } else if (field === "event" && value) {
              eventType = value;
            } else if (field === "id") {
              eventId = value;
            }
          }

          const eventData: SSEEvent = {
            data: eventDataLines.join("\n"),
            type: eventType,
            id: eventId,
          };

          // Only invoke callback if we have valid data
          if (eventData.data && eventData.data.trim() !== "") {
            onMessage?.(eventData);
          } else {
            logger.log("Skipping event with empty data");
          }
        }
      }
      // Generator finishes when stream ends, reader lock released in generator's finally
      logger.log("Stream ended (async generator)");
      isConnected = false;
      closeOnce();
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        logger.log("Stream aborted");
        isConnected = false;
        closeOnce();
        return;
      }

      // Let the fetch-level handler attach request and response context.
      throw err;
    }
  };

  // Execute the fetch request
  void (async () => {
    const requestContext = {
      method,
      url,
      headers: sanitizeHeaders(effectiveHeaders),
      body: method === "POST" ? body : undefined,
    };
    let response: Response | undefined;

    try {
      logger.log(`Initiating ${method} fetch request`);

      // Add a guard to check if already aborted
      if (signal.aborted) {
        logger.log("Request already aborted before fetch");
        return;
      }

      // Built fresh per attempt so an auth-recovery retry picks up the
      // refreshed session cookie / Authorization header.
      const buildInit = (): RequestInit => ({
        method,
        headers: mergeApiAuthHeaders({
          ...(method === "POST" && { "Content-Type": "application/json" }),
          ...headers,
        }),
        body: method === "POST" ? body : undefined,
        signal,
        // SSE needs these options
        cache: "no-store",
        credentials: "same-origin",
      });

      response = await fetch(url, buildInit());
      // Connect-time 401 (the proxy rejected the request before it reached the
      // backend/stream): recover the session and reopen ONCE. Safe to replay —
      // a pre-stream 401 means nothing was processed. No-op for the web app,
      // which registers no recovery handler (see @/auth/authRecovery).
      if (response.status === 401 && (await tryRecoverAuth("sse-401"))) {
        response = await fetch(url, buildInit());
      }

      if (!response.ok) {
        // Read the body so the caller can surface the validation reason
        // (e.g. action-facet arg size). Falls back to status text when the
        // server returns an empty body.
        let bodyText = "";
        try {
          bodyText = await response.text();
        } catch {
          // ignore — fall through to status text
        }
        const detail =
          bodyText.trim().length > 0
            ? bodyText.trim()
            : `${response.status} ${response.statusText}`;
        const errorMsg = `SSE request failed: ${detail}`;
        logger.log("Fetch error:", errorMsg);
        throw new FrontendRequestError(
          errorMsg,
          requestContext,
          getResponseContext(response, bodyText),
        );
      }

      if (!response.body) {
        logger.log("Error: Response has no body");
        throw new FrontendRequestError(
          "Response has no body",
          requestContext,
          getResponseContext(response),
        );
      }

      // Check if connection was aborted while fetching
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (signal.aborted) {
        logger.log("Connection aborted after fetch but before reading stream");
        return;
      }

      logger.log("Fetch successful, processing stream");
      // Read the stream using the updated function with the async generator
      await readSSEStream(response.body); // Pass the stream directly
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        // This is just a normal abort, not an error
        logger.log("Request aborted");
        isConnected = false;
        closeOnce();
        return;
      }

      const cause = err instanceof Error ? err : new Error(String(err));
      const error =
        cause instanceof FrontendRequestError
          ? cause
          : new FrontendRequestError(
              cause.message,
              requestContext,
              response ? getResponseContext(response) : undefined,
              { cause },
            );
      logger.log("Fetch error:", error.message);
      onError?.(error);
      isConnected = false;
    }
  })();

  // Return cleanup function
  return () => {
    if (abortController) {
      logger.log("Aborting fetch request");
      abortController.abort();
      abortController = null;
      isConnected = false;
      closeOnce();
    }
  };
}
