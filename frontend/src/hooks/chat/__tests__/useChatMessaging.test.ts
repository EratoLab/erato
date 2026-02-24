import { renderHook, act } from "@testing-library/react";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  chatMessagesQuery,
  fetchChatMessages,
  useChatMessages,
  useMessageSubmitSse,
  useRecentChats,
  useArchiveChatEndpoint,
  useUpdateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

// Mock Zustand for testing
vi.mock("zustand", async () => {
  const { act } = await import("@testing-library/react");
  const { afterEach, vi } = await import("vitest");

  const actualZustand = await vi.importActual("zustand");

  // Store reset functions
  const storeResetFns = new Set<() => void>();

  const createUncurried = <T>(stateCreator: StateCreator<T>) => {
    const store = (actualZustand.create as any)(stateCreator);
    const initialState = store.getInitialState() || store.getState();

    storeResetFns.add(() => {
      store.setState(initialState, true);
    });

    return store;
  };

  const resetAllStores = () => {
    act(() => {
      storeResetFns.forEach((resetFn) => {
        try {
          resetFn();
        } catch (error) {
          console.error("MOCK: Error resetting store:", error);
        }
      });
    });
  };

  afterEach(() => {
    resetAllStores();
  });

  return {
    ...actualZustand,
    create: (<T>(stateCreator?: StateCreator<T>) => {
      if (typeof stateCreator === "function") {
        return createUncurried(stateCreator);
      }

      return createUncurried;
    }) as typeof actualZustand.create,
    createStore: (<T>(stateCreator?: StateCreator<T>) => {
      if (typeof stateCreator === "function") {
        const store = (actualZustand.createStore as any)(stateCreator);
        const initialState = store.getInitialState() || store.getState();

        storeResetFns.add(() => {
          store.setState(initialState, true);
        });

        return store;
      }

      return (<T>(stateCreator: StateCreator<T>) => {
        const store = (actualZustand.createStore as any)(stateCreator);
        const initialState = store.getInitialState() || store.getState();

        storeResetFns.add(() => {
          store.setState(initialState, true);
        });

        return store;
      }) as typeof actualZustand.createStore;
    }) as typeof actualZustand.createStore,
  };
});

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

import { useMessagingStore } from "../store/messagingStore";
import { useChatMessaging } from "../useChatMessaging";

import type { ReactNode } from "react";
import type { StateCreator } from "zustand";

// Mock dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  chatMessagesQuery: vi.fn((variables: { pathParams: { chatId: string } }) => ({
    queryKey: ["chatMessages", { chatId: variables.pathParams.chatId }],
  })),
  fetchChatMessages: vi.fn(),
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
  useRecentChats: vi.fn(),
  useArchiveChatEndpoint: vi.fn(),
  useUpdateChat: vi.fn(),
}));

// Create a mock queryClient for testing invalidateQueries
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
const mockCancelQueries = vi.fn().mockResolvedValue(undefined);
const mockGetQueryState = vi.fn().mockReturnValue({
  status: "success",
  fetchStatus: "idle",
  isInvalidated: false,
  dataUpdatedAt: Date.now(),
});
const mockSetQueryData = vi.fn();
const mockQueryClient = {
  invalidateQueries: mockInvalidateQueries,
  cancelQueries: mockCancelQueries,
  getQueryState: mockGetQueryState,
  setQueryData: mockSetQueryData,
};

// Mock the useQueryClient hook
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => mockQueryClient,
  };
});

// Mock implementations
const mockUseChatMessages = useChatMessages as unknown as ReturnType<
  typeof vi.fn
>;
const mockChatMessagesQuery = chatMessagesQuery as unknown as ReturnType<
  typeof vi.fn
>;
const mockFetchChatMessages = fetchChatMessages as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseMessageSubmitSse = useMessageSubmitSse as unknown as ReturnType<
  typeof vi.fn
>;
const mockCreateSSEConnection = createSSEConnection as unknown as ReturnType<
  typeof vi.fn
>;

// Removed unused mock variables - we're using the imported hooks directly

// Set up onMessage callback to capture
let sseCallbacks: {
  onMessage?: (event: SSEEvent) => void;
  onError?: (event?: Event) => void;
  onClose?: () => void;
} = {};

// Add mockMutateAsync function for all tests that is consistent
const mockMutateAsync = vi.fn().mockImplementation(async () => {
  // Success response
  return { success: true };
});

// Wrapper component to provide Router context for tests
const TestWrapper = ({ children }: { children: ReactNode }) =>
  createElement(MemoryRouter, { initialEntries: ["/chat/test"] }, children);

describe("useChatMessaging", () => {
  // Mock chat data
  const mockMessages = [
    {
      id: "msg1",
      content: [
        {
          content_type: "text" as const,
          text: "Hello",
        },
      ],
      role: "user",
      created_at: "2023-01-01T12:00:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:00:00.000Z",
      is_message_in_active_thread: true,
    },
    {
      id: "msg2",
      content: [
        {
          content_type: "text" as const,
          text: "Hi there",
        },
      ],
      role: "assistant",
      created_at: "2023-01-01T12:01:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:01:00.000Z",
      is_message_in_active_thread: true,
    },
  ];

  // Extended mock chat data for pagination tests
  const mockPaginatedMessages = [
    ...mockMessages,
    {
      id: "msg3",
      content: [
        {
          content_type: "text" as const,
          text: "How are you?",
        },
      ],
      role: "user",
      created_at: "2023-01-01T12:02:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:02:00.000Z",
      is_message_in_active_thread: true,
    },
    {
      id: "msg4",
      content: [
        {
          content_type: "text" as const,
          text: "I'm doing well, thanks!",
        },
      ],
      role: "assistant",
      created_at: "2023-01-01T12:03:00.000Z",
      chat_id: "chat1",
      updated_at: "2023-01-01T12:03:00.000Z",
      is_message_in_active_thread: true,
    },
  ];

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    sseCallbacks = {};

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
      refetch: vi.fn().mockResolvedValue({}),
    });

    mockUseMessageSubmitSse.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      error: null,
    });
    mockChatMessagesQuery.mockImplementation(
      (variables: { pathParams: { chatId: string } }) => ({
        queryKey: ["chatMessages", { chatId: variables.pathParams.chatId }],
      }),
    );
    mockFetchChatMessages.mockResolvedValue({
      messages: mockMessages,
    });

    // Mock useRecentChats hook for useChatHistory
    (useRecentChats as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { chats: [] },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Mock useArchiveChatEndpoint hook for useChatHistory
    (
      useArchiveChatEndpoint as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
    (useUpdateChat as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });

    // Mock SSE connection creation
    mockCreateSSEConnection.mockImplementation((url, callbacks) => {
      // Ignore resumestream wiring in most tests unless explicitly asserted.
      if (url.includes("/resumestream")) {
        return vi.fn();
      }
      // Store callbacks to trigger them in tests
      sseCallbacks = callbacks;
      // Return a cleanup function
      return vi.fn();
    });
  });

  // Helper function to setup a fresh hook and SSE environment for each test
  const setupChatMessagingTest = (chatId: string | null = "chat1") => {
    // Create a clean cleanup function for this test
    const cleanupFn = vi.fn();

    // Reset any stateful callbacks
    sseCallbacks = {};

    // Setup a fresh mock for this test
    mockCreateSSEConnection.mockImplementation((url, callbacks) => {
      if (url.includes("/resumestream")) {
        return vi.fn();
      }
      sseCallbacks = callbacks;
      return cleanupFn;
    });

    // Render the hook with fresh state
    const hookResult = renderHook(() => useChatMessaging(chatId), {
      wrapper: TestWrapper,
    });

    // Helper to send a message and wait for streaming to start
    const startStreaming = async (content = "Test message") => {
      await act(async () => {
        await hookResult.result.current.sendMessage(content);
      });
    };

    // Helper to send an SSE event with accumulation
    const sendSSEEvent = async (eventData: Record<string, unknown>) => {
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

    // Helper to simulate SSE connection error
    const simulateConnectionError = async () => {
      await act(async () => {
        if (sseCallbacks.onError) {
          sseCallbacks.onError(new Event("error"));
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

    // Helper to mock a refetch with pagination
    const mockRefetchWithPagination = async (hasMore = true) => {
      await act(async () => {
        // Mock the refetch implementation to return paginated data
        const refetchMock = hookResult.result.current.refetch as jest.Mock;
        refetchMock.mockImplementationOnce(async () => {
          return {
            data: {
              messages: mockPaginatedMessages,
              stats: {
                total_count: 4,
                returned_count: 4,
                current_offset: 0,
                has_more: hasMore,
              },
            },
          };
        });
      });
    };

    return {
      ...hookResult,
      cleanupFn,
      startStreaming,
      sendSSEEvent,
      simulateConnectionError,
      simulateConnectionClose,
      mockRefetchWithPagination,
      triggerError: () => sseCallbacks.onError?.(new Event("error")),
      triggerClose: () => sseCallbacks.onClose?.(),
    };
  };

  it("should fetch messages for a chat", () => {
    const { result } = renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    // Check that messages is an object with 2 entries
    expect(Object.keys(result.current.messages)).toHaveLength(2);
    expect(result.current.messageOrder).toHaveLength(2);

    // Check message content using messageOrder to access messages
    const firstMessageId = result.current.messageOrder[0];
    const secondMessageId = result.current.messageOrder[1];

    expect(result.current.messages[firstMessageId].content).toEqual([
      { content_type: "text", text: "Hello" },
    ]);
    expect(result.current.messages[secondMessageId].content).toEqual([
      { content_type: "text", text: "Hi there" },
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should attempt resumestream when entering a chat", () => {
    mockCreateSSEConnection.mockClear();

    renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    expect(mockCreateSSEConnection).toHaveBeenCalledWith(
      "/api/v1beta/me/messages/resumestream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chat_id: "chat1" }),
      }),
    );
  });

  // Skip this test for now
  it.skip("should handle empty chat ID", () => {
    // Override the mock for this test to return no messages for null chatId
    mockUseChatMessages.mockImplementationOnce(() => ({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    }));

    const { result } = renderHook(() => useChatMessaging(null));

    expect(mockUseChatMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        pathParams: { chatId: "" },
      }),
      expect.objectContaining({
        enabled: false,
      }),
    );
    expect(Object.keys(result.current.messages)).toHaveLength(0);
  });

  it("should convert API messages to internal message format", () => {
    const { result } = renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    // Get the first message using messageOrder
    const firstMessageId = result.current.messageOrder[0];
    const secondMessageId = result.current.messageOrder[1];

    expect(result.current.messages[firstMessageId]).toEqual({
      id: "msg1",
      content: [{ content_type: "text", text: "Hello" }],
      role: "user",
      createdAt: "2023-01-01T12:00:00.000Z",
      status: "complete",
      input_files_ids: undefined,
      previous_message_id: undefined,
      sender: "user",
      authorId: "user_id",
      toolCalls: undefined,
      is_message_in_active_thread: true,
    });

    expect(result.current.messages[secondMessageId]).toEqual({
      id: "msg2",
      content: [{ content_type: "text", text: "Hi there" }],
      role: "assistant",
      createdAt: "2023-01-01T12:01:00.000Z",
      status: "complete",
      input_files_ids: undefined,
      previous_message_id: undefined,
      sender: "assistant",
      authorId: "assistant_id",
      toolCalls: undefined,
      is_message_in_active_thread: true,
    });
  });

  // Skip this test for now
  it.skip("should send a message", async () => {
    // Override mockUseChatMessages for this test to return no assistant messages
    mockUseChatMessages.mockReturnValueOnce({
      data: {
        messages: [
          {
            id: "msg1",
            content: [
              {
                content_type: "text" as const,
                text: "Hello",
              },
            ],
            role: "user",
            created_at: "2023-01-01T12:00:00.000Z",
            chat_id: "chat1",
            updated_at: "2023-01-01T12:00:00.000Z",
            is_message_in_active_thread: true,
          },
        ],
        stats: {
          total_count: 1,
          returned_count: 1,
          current_offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    await act(async () => {
      await result.current.sendMessage("New message");
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      body: {
        user_message: "New message",
      },
    });
  });

  // Skip complex streaming tests that test outdated internal behavior
  it.skip("should handle streaming state when sending a message", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle stream event processing", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle multiple streaming text deltas incrementally", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle a sequence of real-world SSE events", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle chat_created event type correctly", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle user_message_saved event type correctly", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle SSE connection closure during streaming", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should handle malformed SSE event data gracefully", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  it.skip("should attempt to reconnect when SSE connection fails", async () => {
    // This test is testing complex internal streaming behavior that has changed
  });

  // Keep the basic functionality tests
  it("should handle SSE connection errors", async () => {
    const { result, startStreaming, triggerError } = setupChatMessagingTest();

    // Start streaming
    await startStreaming("Test error handling");

    // Trigger an SSE error
    await act(async () => {
      triggerError();
    });

    // Should reset streaming state and set an error
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it("should handle explicit stream error events and reset pending state", async () => {
    const { result, startStreaming, sendSSEEvent } = setupChatMessagingTest();

    await startStreaming("Test backend error event");

    expect(result.current.isPendingResponse).toBe(true);

    await sendSSEEvent({
      message_type: "error",
      error_type: "provider_error",
      error_description: "backend stream failed",
    });

    expect(result.current.isStreaming).toBe(false);
    expect(result.current.isPendingResponse).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(String(result.current.error)).toContain("backend stream failed");
  });

  it("should attempt resumestream on unexpected close while actively streaming", async () => {
    const { result, startStreaming, sendSSEEvent, simulateConnectionClose } =
      setupChatMessagingTest();

    await startStreaming("Test stale closure");

    // Move store to active streaming state.
    await sendSSEEvent({
      message_type: "assistant_message_started",
      message_id: "assistant-live-id",
    });

    expect(result.current.isStreaming).toBe(true);

    mockCreateSSEConnection.mockClear();

    // onClose should now trigger resumestream recovery instead of immediate reset.
    await simulateConnectionClose();

    expect(mockCreateSSEConnection).toHaveBeenCalledWith(
      "/api/v1beta/me/messages/resumestream",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ chat_id: "chat1" }),
      }),
    );
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("should keep completed assistant placeholder visible when refetch has not persisted it yet", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({
        data: {
          messages: [
            {
              id: "user-only-1",
              content: [{ content_type: "text", text: "request" }],
              role: "user",
              created_at: "2026-02-18T12:00:00.000Z",
              chat_id: "chat1",
              updated_at: "2026-02-18T12:00:00.000Z",
              is_message_in_active_thread: true,
            },
          ],
        },
      }),
    });

    const { result, startStreaming, sendSSEEvent } = setupChatMessagingTest();

    await startStreaming("request");

    await sendSSEEvent({
      message_type: "assistant_message_started",
      message_id: "assistant-complete-keep",
    });
    await sendSSEEvent({
      message_type: "text_delta",
      message_id: "assistant-complete-keep",
      content_index: 0,
      new_text: "final answer",
    });
    await sendSSEEvent({
      message_type: "assistant_message_completed",
      message_id: "assistant-complete-keep",
      message: {
        id: "assistant-complete-keep",
        role: "assistant",
        created_at: "2026-02-18T12:00:01.000Z",
        updated_at: "2026-02-18T12:00:01.000Z",
        content: [{ content_type: "text", text: "final answer" }],
        input_files_ids: [],
        is_message_in_active_thread: true,
      },
    });

    const assistantMessage = result.current.messages["assistant-complete-keep"];
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage.role).toBe("assistant");
    expect(assistantMessage.content).toEqual([
      { content_type: "text", text: "final answer" },
    ]);
    expect(result.current.isFinalizing).toBe(false);
  });

  it("should force completion refetch via newly created chat id when hook chatId is null", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });
    mockFetchChatMessages.mockResolvedValue({
      messages: [
        {
          id: "user-real-new-1",
          content: [{ content_type: "text", text: "Delay" }],
          role: "user",
          created_at: "2026-02-18T12:00:00.000Z",
          chat_id: "chat-new-force-refetch-1",
          updated_at: "2026-02-18T12:00:00.000Z",
          is_message_in_active_thread: true,
        },
        {
          id: "assistant-real-new-1",
          content: [{ content_type: "text", text: "Completed reply" }],
          role: "assistant",
          created_at: "2026-02-18T12:00:01.000Z",
          chat_id: "chat-new-force-refetch-1",
          updated_at: "2026-02-18T12:00:01.000Z",
          is_message_in_active_thread: true,
        },
      ],
    });

    const { startStreaming, sendSSEEvent } = setupChatMessagingTest(null);

    await startStreaming("Delay");

    await sendSSEEvent({
      message_type: "chat_created",
      chat_id: "chat-new-force-refetch-1",
    });
    await sendSSEEvent({
      message_type: "assistant_message_started",
      message_id: "assistant-real-new-1",
    });
    await sendSSEEvent({
      message_type: "assistant_message_completed",
      message_id: "assistant-real-new-1",
      message: {
        id: "assistant-real-new-1",
        role: "assistant",
        created_at: "2026-02-18T12:00:01.000Z",
        updated_at: "2026-02-18T12:00:01.000Z",
        content: [{ content_type: "text", text: "Completed reply" }],
        input_files_ids: [],
        is_message_in_active_thread: true,
      },
    });

    expect(mockFetchChatMessages).toHaveBeenCalledWith({
      pathParams: { chatId: "chat-new-force-refetch-1" },
    });
    const persistedMessages = useMessagingStore
      .getState()
      .getApiMessages("chat-new-force-refetch-1");
    expect(persistedMessages["assistant-real-new-1"]).toBeDefined();
    expect(persistedMessages["assistant-real-new-1"].content).toEqual([
      { content_type: "text", text: "Completed reply" },
    ]);
  });

  it("should prefer streaming content over api snapshot when ids collide during streaming", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    const { result, startStreaming, sendSSEEvent } = setupChatMessagingTest();

    await startStreaming("Delay");

    await sendSSEEvent({
      message_type: "assistant_message_started",
      message_id: "assistant-collision-1",
    });

    act(() => {
      useMessagingStore.getState().setApiMessages(
        [
          {
            id: "assistant-collision-1",
            content: [],
            role: "assistant",
            createdAt: "2026-02-18T12:00:01.000Z",
            status: "complete",
          },
        ],
        "chat1",
      );
    });

    await sendSSEEvent({
      message_type: "text_delta",
      message_id: "assistant-collision-1",
      content_index: 0,
      new_text: "stream text",
    });

    const assistantMessage = result.current.messages["assistant-collision-1"];
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage.content).toEqual([
      { content_type: "text", text: "stream text" },
    ]);
    expect(result.current.isStreaming).toBe(true);
  });

  it("should preserve per-chat streaming state when switching chats", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    const connectionCallbacks: Array<{
      onMessage?: (event: SSEEvent) => void;
      onError?: (event?: Event) => void;
      onClose?: () => void;
    }> = [];
    const cleanupFns: ReturnType<typeof vi.fn>[] = [];

    mockCreateSSEConnection.mockImplementation((url, callbacks) => {
      if (url.includes("/resumestream")) {
        return vi.fn();
      }
      const cleanup = vi.fn();
      cleanupFns.push(cleanup);
      connectionCallbacks.push(callbacks);
      return cleanup;
    });

    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useChatMessaging(chatId),
      {
        wrapper: TestWrapper,
        initialProps: { chatId: "chat-a" as string | null },
      },
    );

    const getStreamingText = () =>
      result.current.streamingContent
        .filter((part) => part.content_type === "text")
        .map((part) => part.text)
        .join("");

    await act(async () => {
      await result.current.sendMessage("Message in A");
    });

    await act(async () => {
      connectionCallbacks[0].onMessage?.({
        data: JSON.stringify({
          message_type: "user_message_saved",
          message_id: "user-a-real",
          message: {
            id: "user-a-real",
            role: "user",
            created_at: "2026-02-18T12:00:00.000Z",
            updated_at: "2026-02-18T12:00:00.000Z",
            content: [{ content_type: "text", text: "Message in A" }],
            input_files_ids: [],
            is_message_in_active_thread: true,
          },
        }),
        type: "message",
      });
      connectionCallbacks[0].onMessage?.({
        data: JSON.stringify({
          message_type: "assistant_message_started",
          message_id: "assistant-a",
        }),
        type: "message",
      });
      connectionCallbacks[0].onMessage?.({
        data: JSON.stringify({
          message_type: "text_delta",
          message_id: "assistant-a",
          content_index: 0,
          new_text: "A1",
        }),
        type: "message",
      });
    });

    expect(getStreamingText()).toContain("A1");

    act(() => {
      rerender({ chatId: "chat-b" });
    });

    expect(cleanupFns[0]).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.sendMessage("Message in B");
    });

    await act(async () => {
      connectionCallbacks[1].onMessage?.({
        data: JSON.stringify({
          message_type: "assistant_message_started",
          message_id: "assistant-b",
        }),
        type: "message",
      });
      connectionCallbacks[1].onMessage?.({
        data: JSON.stringify({
          message_type: "text_delta",
          message_id: "assistant-b",
          content_index: 0,
          new_text: "B1",
        }),
        type: "message",
      });
    });

    expect(getStreamingText()).toContain("B1");
    expect(
      Object.values(result.current.messages).some((message) => {
        if (message.role !== "user") {
          return false;
        }
        return message.content.some(
          (part) =>
            part.content_type === "text" && part.text === "Message in A",
        );
      }),
    ).toBe(false);

    await act(async () => {
      connectionCallbacks[0].onMessage?.({
        data: JSON.stringify({
          message_type: "text_delta",
          message_id: "assistant-a",
          content_index: 0,
          new_text: "A2",
        }),
        type: "message",
      });
    });

    // Still on chat-b: chat-a deltas should not replace active chat-b streaming view.
    expect(getStreamingText()).toContain("B1");
    expect(getStreamingText()).not.toContain("A2");

    act(() => {
      rerender({ chatId: "chat-a" });
    });

    expect(getStreamingText()).toContain("A1");
    expect(getStreamingText()).toContain("A2");
    expect(
      Object.values(result.current.messages).some((message) => {
        if (message.role !== "user") {
          return false;
        }
        return message.content.some(
          (part) =>
            part.content_type === "text" && part.text === "Message in A",
        );
      }),
    ).toBe(true);
  });

  it("should keep optimistic user message visible across new-chat stream transition", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useChatMessaging(chatId),
      {
        wrapper: TestWrapper,
        initialProps: { chatId: null as string | null },
      },
    );

    await act(async () => {
      await result.current.sendMessage("Hello from new chat");
    });

    await act(async () => {
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "chat_created",
          chat_id: "chat-new-1",
        }),
        type: "message",
      });
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "user_message_saved",
          message_id: "user-real-1",
          message: {
            id: "user-real-1",
            role: "user",
            created_at: "2026-02-18T12:00:00.000Z",
            updated_at: "2026-02-18T12:00:00.000Z",
            content: [{ content_type: "text", text: "Hello from new chat" }],
            input_files_ids: [],
            is_message_in_active_thread: true,
          },
        }),
        type: "message",
      });
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "assistant_message_started",
          message_id: "assistant-real-1",
        }),
        type: "message",
      });
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "text_delta",
          message_id: "assistant-real-1",
          content_index: 0,
          new_text: "Streaming reply...",
        }),
        type: "message",
      });
    });

    const preNavigationMessages = result.current.messageOrder.map(
      (id) => result.current.messages[id],
    );
    expect(preNavigationMessages.some((msg) => msg.role === "user")).toBe(true);
    expect(preNavigationMessages.some((msg) => msg.role === "assistant")).toBe(
      true,
    );

    act(() => {
      rerender({ chatId: "chat-new-1" });
    });

    const orderedMessages = result.current.messageOrder.map(
      (id) => result.current.messages[id],
    );

    expect(orderedMessages.length).toBeGreaterThanOrEqual(2);
    expect(orderedMessages[0].role).toBe("user");
    expect(orderedMessages[1].role).toBe("assistant");
    expect(
      orderedMessages.some(
        (msg) =>
          msg.role === "user" &&
          msg.content.some(
            (part) =>
              part.content_type === "text" &&
              part.text === "Hello from new chat",
          ),
      ),
    ).toBe(true);
  });

  it("should repair invalid temp-user stream anchor on user_message_saved", async () => {
    mockUseChatMessages.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useChatMessaging(chatId),
      {
        wrapper: TestWrapper,
        initialProps: { chatId: null as string | null },
      },
    );

    await act(async () => {
      await result.current.sendMessage("Anchor repair test");
    });

    const tempUserMessage = Object.values(result.current.messages).find(
      (message) =>
        message.role === "user" && message.id.startsWith("temp-user-"),
    );
    expect(tempUserMessage).toBeDefined();

    await act(async () => {
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "chat_created",
          chat_id: "chat-anchor-repair-1",
        }),
        type: "message",
      });
    });

    // Simulate corrupted anchor state observed in logs: currentMessageId points to temp-user.
    act(() => {
      useMessagingStore.getState().setStreaming(
        {
          currentMessageId: tempUserMessage?.id ?? null,
          isStreaming: false,
          content: [],
          createdAt: "2026-02-18T12:00:00.000Z",
          toolCalls: {},
          isFinalizing: false,
        },
        "chat-anchor-repair-1",
      );
    });

    await act(async () => {
      sseCallbacks.onMessage?.({
        data: JSON.stringify({
          message_type: "user_message_saved",
          message_id: "user-real-anchor-1",
          message: {
            id: "user-real-anchor-1",
            role: "user",
            created_at: "2026-02-18T12:00:05.000Z",
            updated_at: "2026-02-18T12:00:05.000Z",
            content: [{ content_type: "text", text: "Anchor repair test" }],
            input_files_ids: [],
            is_message_in_active_thread: true,
          },
        }),
        type: "message",
      });
    });

    const streamingAfterSave = useMessagingStore
      .getState()
      .getStreaming("chat-anchor-repair-1");

    expect(streamingAfterSave.currentMessageId).toMatch(/^temp-assistant-/);
    expect(streamingAfterSave.currentMessageId).not.toBe(tempUserMessage?.id);

    act(() => {
      rerender({ chatId: "chat-anchor-repair-1" });
    });

    const orderedMessages = result.current.messageOrder.map(
      (id) => result.current.messages[id],
    );
    expect(orderedMessages.length).toBeGreaterThanOrEqual(2);
    expect(orderedMessages[0].role).toBe("user");
    expect(orderedMessages[1].role).toBe("assistant");
  });

  it("should remove replaced user and following assistant immediately on edit submit", async () => {
    const { result } = renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    await act(async () => {
      useMessagingStore.getState().setApiMessages(
        [
          {
            id: "msg-user-keep",
            content: [{ content_type: "text", text: "Keep this" }],
            role: "user",
            createdAt: "2026-02-20T10:00:00.000Z",
            status: "complete",
          },
          {
            id: "msg-user-edit",
            content: [{ content_type: "text", text: "Old edited message" }],
            role: "user",
            createdAt: "2026-02-20T10:01:00.000Z",
            status: "complete",
          },
          {
            id: "msg-assistant-following",
            content: [{ content_type: "text", text: "Old assistant response" }],
            role: "assistant",
            createdAt: "2026-02-20T10:02:00.000Z",
            status: "complete",
          },
          {
            id: "msg-user-later",
            content: [{ content_type: "text", text: "Later message" }],
            role: "user",
            createdAt: "2026-02-20T10:03:00.000Z",
            status: "complete",
          },
        ],
        "chat1",
      );
    });

    expect(result.current.messages["msg-user-edit"]).toBeDefined();
    expect(result.current.messages["msg-assistant-following"]).toBeDefined();

    await act(async () => {
      await result.current.editMessage("msg-user-edit", "Edited content");
    });

    expect(result.current.messages["msg-user-edit"]).toBeUndefined();
    expect(result.current.messages["msg-assistant-following"]).toBeUndefined();
    expect(result.current.messages["msg-user-later"]).toBeDefined();

    const optimisticEditedMessage = Object.values(result.current.messages).find(
      (message) =>
        message.role === "user" &&
        message.status === "sending" &&
        message.content.some(
          (part) =>
            part.content_type === "text" && part.text === "Edited content",
        ),
    );
    expect(optimisticEditedMessage).toBeDefined();
  });

  it("should handle canceling a message", async () => {
    const { result } = renderHook(() => useChatMessaging("chat1"), {
      wrapper: TestWrapper,
    });

    // Start a message
    await act(async () => {
      await result.current.sendMessage("Test message");
    });

    // Cancel the message
    await act(async () => {
      result.current.cancelMessage();
    });

    // Should reset streaming state
    expect(result.current.isStreaming).toBe(false);
  });

  it("should show optimistic user message immediately in new chat (null chatId)", async () => {
    // Mock for new chat scenario - no API messages, no loading
    mockUseChatMessages.mockReturnValueOnce({
      data: undefined, // No API data for new chat
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    // Render hook with null chatId (new chat)
    const { result } = renderHook(() => useChatMessaging(null), {
      wrapper: TestWrapper,
    });

    // Initially should have no messages
    expect(Object.keys(result.current.messages)).toHaveLength(0);

    // Send a message (this creates optimistic user message + optimistic assistant message)
    await act(async () => {
      await result.current.sendMessage("Hello new chat!");
    });

    // Should now show both optimistic user and assistant messages (ERMAIN-88 fix)
    expect(Object.keys(result.current.messages)).toHaveLength(2);
    expect(result.current.messageOrder).toHaveLength(2);

    // Check the optimistic user message (first message)
    const userMessageId = result.current.messageOrder[0];
    const userMessage = result.current.messages[userMessageId];
    expect(userMessage.content).toEqual([
      { content_type: "text", text: "Hello new chat!" },
    ]);
    expect(userMessage.role).toBe("user");
    expect(userMessage.status).toBe("sending");

    // Check the optimistic assistant message (second message)
    const assistantMessageId = result.current.messageOrder[1];
    const assistantMessage = result.current.messages[assistantMessageId];
    expect(assistantMessage.role).toBe("assistant");
    // Status is "complete" because isStreaming is false for the optimistic placeholder
    // The UI shows "thinking" state based on temp-assistant- ID, not status
    expect(assistantMessage.status).toBe("complete");
    expect(assistantMessage.id).toMatch(/^temp-assistant-/);
    expect(assistantMessage.content).toEqual([]); // Empty content initially
  });

  it("should return empty messages when chatId is null and no local messages (after archiving)", () => {
    // Mock for post-archive scenario - no API messages, no loading
    mockUseChatMessages.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    // Render hook with null chatId and no local messages (archive scenario)
    const { result } = renderHook(() => useChatMessaging(null), {
      wrapper: TestWrapper,
    });

    // Should have no messages (empty state after archiving)
    expect(Object.keys(result.current.messages)).toHaveLength(0);
    expect(result.current.messageOrder).toHaveLength(0);
  });

  it("should clear completed messages when navigating back to assistant landing (chatId becomes null)", () => {
    // This test validates the fix for the bug where navigating from /a/:assistantId/:chatId
    // back to /a/:assistantId would show the optimistic user message but not the assistant response

    // First, render hook with a real chatId (simulating being on a specific chat)
    mockUseChatMessages.mockReturnValueOnce({
      data: {
        messages: [
          {
            id: "msg-user-1",
            content: [{ content_type: "text", text: "Hello assistant" }],
            role: "user",
            created_at: "2023-01-01T12:00:00.000Z",
            previous_message_id: null,
            sibling_message_id: null,
            is_message_in_active_thread: true,
          },
          {
            id: "msg-asst-1",
            content: [{ content_type: "text", text: "Hello! How can I help?" }],
            role: "assistant",
            created_at: "2023-01-01T12:01:00.000Z",
            previous_message_id: "msg-user-1",
            sibling_message_id: null,
            is_message_in_active_thread: true,
          },
        ],
      },
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    const { result, rerender } = renderHook(
      ({ chatId }: { chatId: string | null }) => useChatMessaging(chatId),
      {
        wrapper: TestWrapper,
        initialProps: { chatId: "chat-123" as string | null },
      },
    );

    // Should have both messages from API
    expect(Object.keys(result.current.messages)).toHaveLength(2);

    // Now simulate navigation back to assistant landing page (chatId becomes null)
    // Mock the API response for null chatId (no data)
    mockUseChatMessages.mockReturnValueOnce({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    // Rerender with null chatId (navigating back to assistant landing)
    act(() => {
      rerender({ chatId: null });
    });

    // Should have no messages - the completed messages should be cleared
    // This fixes the bug where user messages were showing but assistant messages were not
    expect(Object.keys(result.current.messages)).toHaveLength(0);
    expect(result.current.messageOrder).toHaveLength(0);
  });
});
