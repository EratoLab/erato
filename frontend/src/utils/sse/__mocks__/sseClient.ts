/**
 * Mock implementation of the SSE client for testing
 */
import type { SSEEvent, SSEOptions } from "../sseClient";

// Mock EventSource for testing environments
export class MockEventSource {
  url: string;
  onopen: (() => void) | null = null;
  onmessage:
    | ((event: { data: string; lastEventId?: string; type: string }) => void)
    | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate immediate connection
    setTimeout(() => {
      if (this.onopen) {
        this.onopen();
      }
    }, 0);
  }

  close(): void {
    // Just a stub for testing
  }
}

// Mock implementation of createSSEConnection
export function createSSEConnection(url: string, options: SSEOptions = {}) {
  const { onMessage, onError, onOpen, onClose } = options;

  // Create a mock event source
  const eventSource = new MockEventSource(url);
  let isConnected = false;

  // Simulate connection opening
  eventSource.onopen = () => {
    isConnected = true;
    onOpen?.();
  };

  // Set up error handler
  eventSource.onerror = (event: Event) => {
    isConnected = false;
    onError?.(event);
  };

  // Set up message handler
  eventSource.onmessage = (event: {
    data: string;
    lastEventId?: string;
    type: string;
  }) => {
    if (onMessage && event.data) {
      const sseEvent: SSEEvent = {
        data: event.data,
        type: event.type || "message",
        id: event.lastEventId,
      };

      onMessage(sseEvent);
    }
  };

  // Return the cleanup function and the mock instance for testing
  const cleanup = () => {
    if (isConnected) {
      eventSource.close();
      isConnected = false;
      onClose?.();
    }
  };

  // For testing, we expose an additional helper methods to manually trigger events
  return cleanup;
}
