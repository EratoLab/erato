/**
 * Server-Sent Events (SSE) client utility
 *
 * This utility provides a wrapper around the EventSource API to handle SSE connections
 * with support for custom headers and event handling.
 *
 * Note: The native EventSource API doesn't support custom headers.
 * For production, consider using a polyfill like 'event-source-polyfill' or
 * a custom implementation for more advanced features.
 */

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
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  method?: "GET" | "POST"; // HTTP method to use
  body?: string; // Request body for POST requests
}

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

  console.log(
    `[CHAT_FLOW] SSE Client - Creating ${method} connection to: ${url}`,
  );

  let abortController: AbortController | null = null;
  let isConnected = false;

  // For GET requests, use the native EventSource
  if (method === "GET" && typeof EventSource !== "undefined") {
    console.log("[CHAT_FLOW] SSE Client - Using native EventSource for GET");
    // Create URL with query params if there's a body for GET
    const requestUrl = body
      ? `${url}?${new URLSearchParams({ data: body }).toString()}`
      : url;

    const eventSource = new EventSource(requestUrl);

    eventSource.onopen = () => {
      console.log(
        "[CHAT_FLOW] SSE Client - Native EventSource connection opened",
      );
      isConnected = true;
      onOpen?.();
    };

    eventSource.onerror = (event: Event) => {
      console.log("[CHAT_FLOW] SSE Client - Native EventSource error:", event);
      isConnected = false;
      onError?.(event);
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
        console.log(
          "[CHAT_FLOW] SSE Client - Closing native EventSource connection",
        );
        eventSource.close();
        isConnected = false;
        onClose?.();
      }
    };
  }

  // For POST requests or environments without EventSource, use fetch
  console.log(
    "[CHAT_FLOW] SSE Client - Using fetch-based approach for",
    method,
  );
  abortController = new AbortController();
  const { signal } = abortController;

  // Helper async generator to iterate over stream reader (alternative structure)
  async function* streamAsyncIterator(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {
    try {
      let result = await reader.read(); // Initial read before the loop
      while (!result.done) {
        // Loop condition based on 'done'
        yield result.value; // Yield the current chunk
        result = await reader.read(); // Read the next chunk at the end
      }
      // Loop naturally terminates when result.done is true
    } finally {
      reader.releaseLock(); // Ensure the lock is always released
    }
  }

  // Function to parse SSE stream from fetch
  const readSSEStream = async (stream: ReadableStream<Uint8Array>) => {
    let buffer = "";
    const decoder = new TextDecoder();
    const reader = stream.getReader(); // Get the reader

    try {
      console.log(
        "[CHAT_FLOW] SSE Client - Stream connected, starting to read using async generator", // Updated log
      );
      isConnected = true;
      onOpen?.();

      // Use for await...of on the async generator helper
      for await (const value of streamAsyncIterator(reader)) {
        // Decode chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process any complete events in the buffer
        const lines = buffer.split("\n\n");

        // Last element might be incomplete, so keep it in the buffer
        buffer = lines.pop() ?? "";

        if (lines.length > 0) {
          console.log(
            `[CHAT_FLOW] SSE Client - Received ${lines.length} events`,
          );
        }

        for (const line of lines) {
          if (line.trim() === "") continue;

          // Parse event data
          const eventData = line.split("\n").reduce(
            (acc, line) => {
              const colonIndex = line.indexOf(":");
              if (colonIndex === -1) return acc;

              const field = line.slice(0, colonIndex).trim();
              const value = line.slice(colonIndex + 1).trim();

              if (field === "data") {
                acc.data = value;
              } else if (field === "event") {
                acc.type = value;
              } else if (field === "id") {
                acc.id = value;
              }

              return acc;
            },
            { data: "", type: "message", id: undefined } as SSEEvent,
          );

          // Only invoke callback if we have valid data
          if (eventData.data && eventData.data.trim() !== "") {
            onMessage?.(eventData);
          } else {
            console.log(
              "[CHAT_FLOW] SSE Client - Skipping event with empty data",
            );
          }
        }
      }
      // Generator finishes when stream ends, reader lock released in generator's finally
      console.log("[CHAT_FLOW] SSE Client - Stream ended (async generator)");
      isConnected = false;
      onClose?.();
    } catch (err) {
      // Catch errors during stream processing or generator execution
      const error = err instanceof Error ? err : new Error(String(err));
      console.log("[CHAT_FLOW] SSE Client - Stream error:", error.message);

      // Create an event-like object
      const errorEvent = new Event("error");
      Object.defineProperty(errorEvent, "error", { value: error });

      onError?.(errorEvent);
      isConnected = false; // Ensure isConnected is false on error
      // Note: reader lock should be released by the generator's finally block even on error
    }
  };

  // Execute the fetch request
  void (async () => {
    try {
      console.log(
        `[CHAT_FLOW] SSE Client - Initiating ${method} fetch request`,
      );

      // Add a guard to check if already aborted
      if (signal.aborted) {
        console.log(
          "[CHAT_FLOW] SSE Client - Request already aborted before fetch",
        );
        return;
      }

      const response = await fetch(url, {
        method,
        headers: {
          ...(method === "POST" && { "Content-Type": "application/json" }),
          ...headers,
        },
        body: method === "POST" ? body : undefined,
        signal,
        // SSE needs these options
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        const errorMsg = `SSE request failed: ${response.status} ${response.statusText}`;
        console.log("[CHAT_FLOW] SSE Client - Fetch error:", errorMsg);
        throw new Error(errorMsg);
      }

      if (!response.body) {
        console.log("[CHAT_FLOW] SSE Client - Error: Response has no body");
        throw new Error("Response has no body");
      }

      // Check if connection was aborted while fetching
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (signal.aborted) {
        console.log(
          "[CHAT_FLOW] SSE Client - Connection aborted after fetch but before reading stream",
        );
        return;
      }

      console.log(
        "[CHAT_FLOW] SSE Client - Fetch successful, processing stream",
      );
      // Read the stream using the updated function with the async generator
      await readSSEStream(response.body); // Pass the stream directly
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // This is just a normal abort, not an error
        console.log("[CHAT_FLOW] SSE Client - Request aborted");
        isConnected = false;
        onClose?.();
        return;
      }

      const error = err instanceof Error ? err : new Error(String(err));
      console.log("[CHAT_FLOW] SSE Client - Fetch error:", error.message);

      // Create an event-like object
      const errorEvent = new Event("error");
      Object.defineProperty(errorEvent, "error", { value: error });

      onError?.(errorEvent);
      isConnected = false;
    }
  })();

  // Return cleanup function
  return () => {
    if (abortController) {
      console.log("[CHAT_FLOW] SSE Client - Aborting fetch request");
      abortController.abort();
      abortController = null;
      isConnected = false;
      onClose?.();
    }
  };
}
