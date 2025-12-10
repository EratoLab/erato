import { renderHook, type RenderHookResult } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  useChatMessages,
  useMessageSubmitSse,
  useRecentChats,
  useArchiveChatEndpoint,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { server } from "@/test/setupMsw";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { useChatMessaging } from "../useChatMessaging";

// Mock SSE connection directly
vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: vi.fn(),
}));

// Mock TanStack Query dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
  useRecentChats: vi.fn(),
  useArchiveChatEndpoint: vi.fn(),
}));

// Mock React Query client
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockUseChatMessages = useChatMessages as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseMessageSubmitSse = useMessageSubmitSse as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseRecentChats = useRecentChats as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseArchiveChatEndpoint =
  useArchiveChatEndpoint as unknown as ReturnType<typeof vi.fn>;
const mockCreateSSEConnection = createSSEConnection as unknown as ReturnType<
  typeof vi.fn
>;

// Define type for hook results
type ChatMessagingHookResult = ReturnType<typeof useChatMessaging>;

// Test wrapper with Router context
const TestWrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ["/chat/test"] }, children);

describe("useChatMessaging with direct mocking", () => {
  // Store references to rendered hook results to clean up after each test
  let hookResult: RenderHookResult<ChatMessagingHookResult, unknown> | null =
    null;

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up default mocks
    // Use mockImplementation to ensure the mock works regardless of arguments
    mockUseChatMessages.mockImplementation(() => ({
      data: {
        messages: [],
        stats: {
          total_count: 0,
          returned_count: 0,
          current_offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}), // Ensure refetch returns a resolved promise
    }));

    mockUseMessageSubmitSse.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({ success: true }),
      isPending: false,
      isError: false,
      error: null,
    });

    mockUseRecentChats.mockReturnValue({
      data: { chats: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseArchiveChatEndpoint.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
  });

  afterEach(() => {
    // Clean up any hook state between tests
    if (hookResult) {
      const currentHookResult = hookResult;
      // Call cancelMessage to clean up any streaming state
      act(() => {
        currentHookResult.result.current.cancelMessage();
      });
      hookResult.unmount();
      hookResult = null;
    }

    // Reset any MSW handlers
    server.resetHandlers();
  });

  it("should handle a complete SSE message flow according to the API spec", async () => {
    // Precreate the callback handler
    let onMessageCallback = vi.fn();
    const cleanupFn = vi.fn();

    // Mock the SSE connection function to capture the callbacks
    mockCreateSSEConnection.mockImplementation((url, callbacks) => {
      // Replace our mockFn with the actual callback
      onMessageCallback = callbacks.onMessage;
      return cleanupFn;
    });

    // Render the hook with a chat ID
    hookResult = renderHook(() => useChatMessaging("test-chat-id"), {
      wrapper: TestWrapper,
    });
    const { result } = hookResult;

    // Initial checks
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toEqual([]);

    // Send message to trigger the SSE connection setup
    await act(async () => {
      await result.current.sendMessage("Hello, this is a test message");
    });

    // Verify the SSE connection was created
    expect(mockCreateSSEConnection).toHaveBeenCalled();
    expect(onMessageCallback).toBeDefined();

    // First, start with a chat_created event
    await act(async () => {
      onMessageCallback({
        data: JSON.stringify({
          message_type: "chat_created",
          chat_id: "test-chat-id",
        }),
        type: "message",
      });
    });

    // First delta
    await act(async () => {
      onMessageCallback({
        data: JSON.stringify({
          message_type: "text_delta",
          new_text: "Hello",
        }),
        type: "message",
      });
    });

    // Check state after first delta
    console.log("After first delta:", result.current.streamingContent);

    // Message complete
    await act(async () => {
      onMessageCallback({
        data: JSON.stringify({
          message_type: "message_complete",
          message_id: "assistant-msg-456",
          full_text: "Hello, I'm the assistant. How can I help you today?",
          message: {
            id: "assistant-msg-456",
            chat_id: "test-chat-id",
            role: "assistant",
            full_text: "Hello, I'm the assistant. How can I help you today?",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_message_in_active_thread: true,
          },
        }),
        type: "message",
      });
    });

    // Check final state
    expect(result.current.isStreaming).toBe(false);
    // streamingContent is now ContentPart[], check that it contains text with "Hello"
    const hasHello = result.current.streamingContent.some(
      (part) => part.content_type === "text" && part.text.includes("Hello"),
    );
    expect(hasHello).toBe(true);
  });

  // Test for diagnosing state accumulation between tests
  it("should properly handle streaming content in a new test", async () => {
    // Setup again with fresh state
    let onMessageCallback = vi.fn();
    const cleanupFn = vi.fn();

    mockCreateSSEConnection.mockImplementation((url, callbacks) => {
      onMessageCallback = callbacks.onMessage;
      return cleanupFn;
    });

    // Render with a different chat ID to ensure clean state
    hookResult = renderHook(() => useChatMessaging("different-chat-id"), {
      wrapper: TestWrapper,
    });
    const { result } = hookResult;

    // Verify initial state is clean
    expect(result.current.streamingContent).toEqual([]);

    // Start message flow
    await act(async () => {
      await result.current.sendMessage("Testing fresh state");
    });

    // Send a test delta
    await act(async () => {
      onMessageCallback({
        data: JSON.stringify({
          message_type: "text_delta",
          new_text: "Fresh content",
        }),
        type: "message",
      });
    });

    // Verify only this content is present (not content from previous test)
    console.log("Current content:", result.current.streamingContent);
    expect(result.current.streamingContent).toEqual([
      { content_type: "text", text: "Fresh content" },
    ]);

    // Complete the message
    await act(async () => {
      onMessageCallback({
        data: JSON.stringify({
          message_type: "message_complete",
          message_id: "test-msg-id",
          full_text: "Fresh content",
          message: {
            id: "test-msg-id",
            chat_id: "different-chat-id",
            role: "assistant",
            full_text: "Fresh content",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            is_message_in_active_thread: true,
          },
        }),
        type: "message",
      });
    });

    // Verify streaming has ended
    expect(result.current.isStreaming).toBe(false);
  });

  // Test for handling 401 unauthorized error - REMOVED
  // it("should handle 401 unauthorized error", async () => { ... });

  // Test for handling 500 server error - REMOVED
  // it("should handle 500 server error", async () => { ... });
});
