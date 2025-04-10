import { renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useChatMessages } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

// Import our patched version of Zustand for testing
import zustandMock from "./zustandMock";
import { useChatMessaging } from "../useChatMessaging";

// Mock Zustand with our testing version
vi.mock("zustand", () => zustandMock);

// Mock the SSE client module
vi.mock("@/utils/sse/sseClient", () => {
  return {
    createSSEConnection: vi.fn((url, options) => {
      // Store the callbacks for use in tests
      if (options.onMessage) sseCallbacks.onMessage = options.onMessage;
      if (options.onError) sseCallbacks.onError = options.onError;
      if (options.onClose) sseCallbacks.onClose = options.onClose;

      // Return a cleanup function
      return vi.fn();
    }),
  };
});

// Mock dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
}));

// Create a mock queryClient for testing invalidateQueries
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

// Mock the React Query hooks
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

// Mock implementations
const mockUseChatMessages = useChatMessages as unknown as ReturnType<
  typeof vi.fn
>;

const mockCreateSSEConnection = createSSEConnection as unknown as ReturnType<
  typeof vi.fn
>;

// Set up onMessage callback to capture
let sseCallbacks: {
  onMessage?: (event: SSEEvent) => void;
  onError?: (event?: Event) => void;
  onClose?: () => void;
} = {};

describe("useChatMessaging with refetch pattern", () => {
  // Mock chat data
  const mockMessages = [
    {
      id: "msg1",
      full_text: "Hello",
      role: "user",
      created_at: "2023-01-01T12:00:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:00:00.000Z",
      is_message_in_active_thread: true,
    },
    {
      id: "msg2",
      full_text: "Hi there",
      role: "assistant",
      created_at: "2023-01-01T12:01:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:01:00.000Z",
      is_message_in_active_thread: true,
    },
  ];

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    sseCallbacks = {};
    mockInvalidateQueries.mockClear();

    // Default mock implementations
    mockUseChatMessages.mockReturnValue({
      data: {
        messages: mockMessages,
        stats: {
          total_count: 2,
          returned_count: 2,
          current_offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
  });

  // Helper function to setup a fresh hook and SSE environment for each test
  const setupChatMessagingTest = (
    options: {
      chatId?: string;
      onChatCreated?: (chatId: string) => void;
    } = {},
  ) => {
    const { chatId = "chat1", onChatCreated } = options;

    // Create a clean cleanup function for this test
    const cleanupFn = vi.fn();

    // Reset any stateful callbacks
    sseCallbacks = {};

    // Setup a fresh mock for this test
    mockCreateSSEConnection.mockImplementationOnce(
      (url: string, callbacks: Record<string, any>) => {
        sseCallbacks = callbacks;
        return cleanupFn;
      },
    );

    // Setup a mock refetch function that updates the message list
    const refetchFn = vi.fn().mockResolvedValue({
      data: {
        messages: [
          ...mockMessages,
          {
            id: "msg3",
            full_text: "Test message",
            role: "user",
            created_at: "2023-01-01T12:02:00.000Z",
            chat_id: "chat1",
            updated_at: "2023-01-01T12:02:00.000Z",
            is_message_in_active_thread: true,
          },
          {
            id: "msg4",
            full_text: "I received your test message",
            role: "assistant",
            created_at: "2023-01-01T12:03:00.000Z",
            chat_id: "chat1",
            updated_at: "2023-01-01T12:03:00.000Z",
            is_message_in_active_thread: true,
          },
        ],
        stats: {
          total_count: 4,
          returned_count: 4,
          current_offset: 0,
          has_more: false,
        },
      },
    });

    // Connect invalidateQueries calls to the refetchFn
    mockInvalidateQueries.mockImplementation(
      async (options: { queryKey?: [string, Record<string, any>] }) => {
        if (options.queryKey?.[0] === "chatMessages") {
          // When invalidating chatMessages, trigger the refetch function
          await refetchFn();
          return true;
        }
        return true;
      },
    );

    // Override the refetch implementation
    mockUseChatMessages.mockReturnValueOnce({
      data: {
        messages: mockMessages,
        stats: {
          total_count: 2,
          returned_count: 2,
          current_offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refetch: refetchFn,
    });

    // Render the hook with fresh state and the onChatCreated callback
    const hookResult = renderHook(() =>
      useChatMessaging({
        chatId,
        onChatCreated,
      }),
    );

    // Helper to send a message and wait for streaming to start
    const startStreaming = async (content = "Test message") => {
      await act(async () => {
        void hookResult.result.current.sendMessage(content);
      });
    };

    // Helper to send an SSE event with accumulation
    const sendSSEEvent = async (eventData: {
      message_type: string;
      new_text?: string;
      full_text?: string;
      message_id?: string;
      chat_id?: string;
      message?: {
        id: string;
        full_text: string;
        role: string;
        created_at: string;
        previous_message_id?: string;
      };
    }) => {
      await act(async () => {
        if (sseCallbacks.onMessage) {
          // For tests checking the streaming content directly
          const jsonData = JSON.stringify(eventData);
          sseCallbacks.onMessage({
            data: jsonData,
            type: "message",
          });
        }
      });
    };

    // Helper to simulate SSE connection close
    const simulateConnectionClose = async () => {
      await act(async () => {
        if (sseCallbacks.onClose) {
          sseCallbacks.onClose();
        }
      });
    };

    return {
      ...hookResult,
      cleanupFn,
      startStreaming,
      sendSSEEvent,
      simulateConnectionClose,
      refetchFn,
    };
  };

  it("should replace temporary messages with server data after completion", async () => {
    const {
      result,
      startStreaming,
      sendSSEEvent,
      simulateConnectionClose,
      refetchFn,
    } = setupChatMessagingTest();

    // Start streaming a message
    await startStreaming("Test message");

    // Check that temporary messages are displayed
    expect(result.current.messages.length).toBeGreaterThan(2);

    // Send back streaming responses
    await sendSSEEvent({
      message_type: "text_delta",
      new_text: "I received ",
    });

    await sendSSEEvent({
      message_type: "text_delta",
      new_text: "your test message",
    });

    // Before calling message_complete, update the mock return value
    mockUseChatMessages.mockReturnValue({
      data: {
        messages: [
          ...mockMessages,
          {
            id: "msg3",
            full_text: "Test message",
            role: "user",
            created_at: "2023-01-01T12:02:00.000Z",
            chat_id: "chat1",
            updated_at: "2023-01-01T12:02:00.000Z",
            is_message_in_active_thread: true,
          },
          {
            id: "msg4",
            full_text: "I received your test message",
            role: "assistant",
            created_at: "2023-01-01T12:03:00.000Z",
            chat_id: "chat1",
            updated_at: "2023-01-01T12:03:00.000Z",
            is_message_in_active_thread: true,
          },
        ],
        stats: {
          total_count: 4,
          returned_count: 4,
          current_offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refetch: refetchFn,
    });

    // Message completes
    await sendSSEEvent({
      message_type: "message_complete",
      message_id: "msg4",
      full_text: "I received your test message",
      message: {
        id: "msg4",
        full_text: "I received your test message",
        role: "assistant",
        created_at: "2023-01-01T12:03:00.000Z",
        previous_message_id: "msg3",
      },
    });

    // Connection closes
    await simulateConnectionClose();

    // Verify refetch was called
    expect(refetchFn).toHaveBeenCalled();

    // Allow time for the state update to complete
    await act(async () => {
      // Wait for all promises to resolve
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 600)); // Wait for the 500ms timeout plus a buffer
    });

    // After the refetch, server data should replace temporary messages
    expect(result.current.messages.length).toBe(4);
    expect(result.current.messages[2].content).toBe("Test message");
    expect(result.current.messages[3].content).toBe(
      "I received your test message",
    );

    // Verify streaming has ended
    expect(result.current.isStreaming).toBe(false);
  });

  it("should clear temporary messages if an error occurs", async () => {
    const { result, startStreaming } = setupChatMessagingTest();

    // Start streaming a message
    await startStreaming("Test message");

    // Check initial temporary messages
    expect(result.current.messages.length).toBeGreaterThan(2);

    // Simulate error by triggering error handler
    await act(async () => {
      if (sseCallbacks.onError) {
        sseCallbacks.onError(new Event("error"));
      }
    });

    // After error, temporary messages should be cleared
    // We should be back to the original messages
    expect(result.current.messages.length).toBe(2);
    expect(result.current.isStreaming).toBe(false);
  });

  it("should not store messages in localStorage during navigation", async () => {
    // Mock localStorage to track access
    const localStorageSpy = vi.spyOn(Storage.prototype, "setItem");

    // Create a mock for the onChatCreated callback
    const onChatCreated = vi.fn();

    // Create a complete test setup with the onChatCreated callback
    const { startStreaming, sendSSEEvent, simulateConnectionClose } =
      setupChatMessagingTest({ onChatCreated });

    // Start streaming a message
    await startStreaming("New message");

    // Send a chat_created event
    await sendSSEEvent({
      message_type: "chat_created",
      chat_id: "new-chat-id",
    });

    // Complete message
    await sendSSEEvent({
      message_type: "message_complete",
      message_id: "new-msg-id",
      full_text: "Response to new message",
      message: {
        id: "new-msg-id",
        full_text: "Response to new message",
        role: "assistant",
        created_at: new Date().toISOString(),
      },
    });

    // Close connection
    await simulateConnectionClose();

    // Should have called onChatCreated
    expect(onChatCreated).toHaveBeenCalledWith("new-chat-id");

    // Should NOT have used localStorage to store messages
    expect(localStorageSpy).not.toHaveBeenCalled();

    // Clean up
    localStorageSpy.mockRestore();
  });
});
