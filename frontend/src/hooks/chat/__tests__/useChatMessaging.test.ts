import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  useChatMessages,
  useMessageSubmitSse,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useChatMessaging } from "../useChatMessaging";

// Mock dependencies
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock implementations
const mockUseChatMessages = useChatMessages as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseMessageSubmitSse = useMessageSubmitSse as unknown as ReturnType<
  typeof vi.fn
>;

describe("useChatMessaging", () => {
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

  // Mock mutation function that simulates sending a message
  const mockMutateAsync = vi.fn().mockImplementation(async () => {
    // Success response
    return { success: true };
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

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

    mockUseMessageSubmitSse.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it("should fetch messages for a chat", () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].content).toBe("Hello");
    expect(result.current.messages[1].content).toBe("Hi there");
    expect(result.current.isLoading).toBe(false);
  });

  it("should handle empty chat ID", () => {
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
    expect(result.current.messages).toHaveLength(0);
  });

  it("should convert API messages to internal message format", () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    expect(result.current.messages[0]).toEqual({
      id: "msg1",
      content: "Hello",
      role: "user",
      createdAt: "2023-01-01T12:00:00.000Z",
      status: "complete",
    });

    expect(result.current.messages[1]).toEqual({
      id: "msg2",
      content: "Hi there",
      role: "assistant",
      createdAt: "2023-01-01T12:01:00.000Z",
      status: "complete",
    });
  });

  it("should send a message", async () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    await act(async () => {
      await result.current.sendMessage("New message");
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      body: {
        user_message: "New message",
      },
    });
  });

  it("should handle streaming state when sending a message", async () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    // Send a message
    let sendPromise: Promise<unknown>;

    act(() => {
      sendPromise = result.current.sendMessage("New message");
    });

    // Assert streaming state is active
    expect(result.current.isStreaming).toBe(true);

    // Wait for the promise to resolve
    await act(async () => {
      await sendPromise;
    });
  });

  it("should handle errors when sending messages", async () => {
    // Set up the mock to simulate an error
    const testError = new Error("Failed to send message");
    mockMutateAsync.mockRejectedValueOnce(testError);

    const { result } = renderHook(() => useChatMessaging("chat1"));

    await act(async () => {
      try {
        await result.current.sendMessage("Error message");
      } catch (e) {
        // Error is expected
        expect(e).toBe(testError);
      }
    });

    expect(result.current.error).toEqual(testError);
    expect(result.current.isStreaming).toBe(false);
  });

  it("should handle stream event processing", () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    // Simulate a streaming message start
    act(() => {
      // Start a message send
      void result.current.sendMessage("Test streaming");
    });

    // Process a text delta event
    act(() => {
      result.current.processStreamEvent({
        data: JSON.stringify({
          message_type: "text_delta",
          new_text: "Hello",
        }),
        type: "message",
      });
    });

    // Check the streaming content is updated
    expect(result.current.streamingContent).toBe("Hello");

    // Process a message complete event
    act(() => {
      result.current.processStreamEvent({
        data: JSON.stringify({
          message_type: "message_complete",
          full_text: "Hello world",
        }),
        type: "message",
      });
    });

    // Check streaming is done and content is finalized
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.streamingContent).toBe("Hello world");
  });

  it("should handle canceling a message", async () => {
    const { result } = renderHook(() => useChatMessaging("chat1"));

    await act(async () => {
      // Start sending a message to set streaming state
      const sendPromise = result.current.sendMessage("Test message");

      // Cancel the message
      result.current.cancelMessage();

      await sendPromise;
    });

    expect(result.current.isStreaming).toBe(false);
  });
});
