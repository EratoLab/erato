import { renderHook, act } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  useChats,
  useChatMessages,
  useMessageSubmitSse,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useChatHistory } from "../useChatHistory";
import { useChatMessaging } from "../useChatMessaging";

// Mock dependencies
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChats: vi.fn(),
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  }),
}));

// Mock implementations
const mockUseRouter = useRouter as unknown as ReturnType<typeof vi.fn>;
const mockUseChats = useChats as unknown as ReturnType<typeof vi.fn>;
const mockUseChatMessages = useChatMessages as unknown as ReturnType<
  typeof vi.fn
>;
const mockUseMessageSubmitSse = useMessageSubmitSse as unknown as ReturnType<
  typeof vi.fn
>;

describe("Chat hooks integration", () => {
  // Mock chat data
  const mockChats = [
    { id: "chat1", title: "Chat 1" },
    { id: "chat2", title: "Chat 2" },
  ];

  // Mock messages for chat1
  const mockMessagesChat1 = [
    {
      id: "msg1",
      full_text: "Hello from chat 1",
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

  // Mock messages for chat2
  const mockMessagesChat2 = [
    {
      id: "msg3",
      full_text: "Different chat message",
      role: "user",
      created_at: "2023-01-02T12:00:00.000Z",
      chat_id: "chat2",
      updated_at: "2023-01-02T12:00:00.000Z",
      is_message_in_active_thread: true,
    },
  ];

  // Mock router
  const mockRouter = {
    push: vi.fn(),
  };

  // Mock mutation function
  const mockMutateAsync = vi.fn().mockImplementation(async () => {
    return { success: true };
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Default mock implementations
    mockUseRouter.mockReturnValue(mockRouter);

    mockUseChats.mockReturnValue({
      data: mockChats,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // By default, return chat1 messages
    mockUseChatMessages.mockReturnValue({
      data: {
        messages: mockMessagesChat1,
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

  it("should navigate between chats and load appropriate messages", async () => {
    // Render the chat history hook
    const { result: historyResult } = renderHook(() => useChatHistory());

    // Initially we should have the list of chats
    expect(historyResult.current.chats).toEqual(mockChats);

    // Navigate to the first chat
    act(() => {
      historyResult.current.navigateToChat("chat1");
    });

    // The router should have been called to navigate to that chat
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/chat1");

    // Verify the current chat ID is set
    expect(historyResult.current.currentChatId).toBe("chat1");

    // Render the messaging hook for chat1
    const { result: messagingResult1 } = renderHook(() =>
      useChatMessaging("chat1"),
    );

    // Should have chat1 messages
    expect(messagingResult1.current.messages).toHaveLength(2);
    expect(messagingResult1.current.messages[0].content).toBe(
      "Hello from chat 1",
    );

    // Now, mock that we're getting chat2 messages
    mockUseChatMessages.mockReturnValue({
      data: {
        messages: mockMessagesChat2,
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

    // Navigate to the second chat
    act(() => {
      historyResult.current.navigateToChat("chat2");
    });

    // The router should have been called to navigate to that chat
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/chat2");

    // Verify the current chat ID is updated
    expect(historyResult.current.currentChatId).toBe("chat2");

    // Render the messaging hook for chat2
    const { result: messagingResult2 } = renderHook(() =>
      useChatMessaging("chat2"),
    );

    // Should have chat2 messages
    expect(messagingResult2.current.messages).toHaveLength(1);
    expect(messagingResult2.current.messages[0].content).toBe(
      "Different chat message",
    );
  });

  it("should create a new chat and send a message", async () => {
    // Render the chat history hook
    const { result: historyResult } = renderHook(() => useChatHistory());

    // Create a new chat
    await act(async () => {
      await historyResult.current.createNewChat();
    });

    // Should navigate to new chat page
    expect(mockRouter.push).toHaveBeenCalledWith("/chat/new");

    // Simulate that we've been redirected to a specific chat ID
    // This would happen in the actual app flow after a successful chat creation
    await act(async () => {
      historyResult.current.navigateToChat("new-chat-id");
    });

    // Verify current chat ID is set
    expect(historyResult.current.currentChatId).toBe("new-chat-id");

    // Now render the messaging hook for the new chat
    const { result: messagingResult } = renderHook(() =>
      useChatMessaging("new-chat-id"),
    );

    // Send a message in the new chat
    await act(async () => {
      await messagingResult.current.sendMessage("First message in new chat");
    });

    // Verify the message was sent with the correct parameters
    expect(mockMutateAsync).toHaveBeenCalledWith({
      body: {
        user_message: "First message in new chat",
      },
    });

    // At this point in a real app, the API would respond with streaming data
    // and the message would be added to the chat
  });
});
