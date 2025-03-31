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
  // For test environments, this function will be mocked.
  // This implementation is only used in browser contexts where EventSource is available.

  const {
    onMessage,
    onError,
    onOpen,
    onClose,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    headers = {}, // Not used with native EventSource, but kept for API compatibility
    method = "GET",
    body,
  } = options;

  // In a real browser environment, EventSource will be defined
  if (typeof EventSource === "undefined") {
    console.warn("EventSource is not available in this environment");
    // Return a no-op cleanup function
    return () => {};
  }

  // Native EventSource only supports GET requests
  // For POST requests, we'd need to use a polyfill or fetch + custom event handling
  // This is a simplified implementation
  let eventSource: EventSource;
  let isConnected = false;

  if (method === "GET") {
    // Use standard EventSource for GET requests
    eventSource = new EventSource(url);
  } else {
    // For POST requests, we need to use a fetch-based approach
    // This is a placeholder - in a real app, use a polyfill like 'event-source-polyfill'
    console.warn(
      "Using POST for SSE requires a polyfill. Consider using a library like 'event-source-polyfill'",
    );

    // Fallback to GET for now, but in a real implementation we'd use a POST-capable EventSource polyfill
    // or implement a custom solution using fetch + ReadableStream
    const urlWithParams = body
      ? `${url}?${new URLSearchParams({ data: body }).toString()}`
      : url;
    eventSource = new EventSource(urlWithParams);
  }

  eventSource.onopen = () => {
    isConnected = true;
    onOpen?.();
  };

  eventSource.onerror = (event: Event) => {
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

  // Return a cleanup function that closes the connection
  return () => {
    if (isConnected) {
      eventSource.close();
      isConnected = false;
      onClose?.();
    }
  };
}
