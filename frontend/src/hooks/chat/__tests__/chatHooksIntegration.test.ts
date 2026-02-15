import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import {
  useChats,
  useChatMessages,
  useMessageSubmitSse,
  useRecentChats,
  useArchiveChatEndpoint,
  useUpdateChat,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { createSSEConnection } from "@/utils/sse/sseClient";

import { useChatHistory, useChatHistoryStore } from "../useChatHistory";
import { useChatMessaging } from "../useChatMessaging";

// Mock SSE Client
vi.mock("@/utils/sse/sseClient", () => ({
  createSSEConnection: vi.fn(),
}));

// Mock React Router hooks
const mockNavigate = vi.fn();
let mockLocation = { pathname: "/chat" };
let mockParams: { id?: string } = {};

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
    useParams: () => mockParams,
  };
});

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChats: vi.fn(),
  useChatMessages: vi.fn(),
  useMessageSubmitSse: vi.fn(),
  useRecentChats: vi.fn(),
  useArchiveChatEndpoint: vi.fn(),
  useUpdateChat: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn(),
  }),
}));

// Mock implementations
const mockUseChats = useChats as unknown as ReturnType<typeof vi.fn>;
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
const mockUseUpdateChat = useUpdateChat as unknown as ReturnType<typeof vi.fn>;

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
      content: [
        {
          content_type: "text",
          text: "Hello from chat 1",
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
          content_type: "text",
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

  // Mock messages for chat2
  const mockMessagesChat2 = [
    {
      id: "msg3",
      content: [
        {
          content_type: "text",
          text: "Different chat message",
        },
      ],
      role: "user",
      created_at: "2023-01-02T12:00:00.000Z",
      chat_id: "chat2",
      updated_at: "2023-01-02T12:00:00.000Z",
      is_message_in_active_thread: true,
    },
  ];

  // Mock mutation function
  const mockMutateAsync = vi.fn().mockImplementation(async () => {
    return { success: true };
  });

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Reset router mocks to initial state
    mockLocation = { pathname: "/chat" };
    mockParams = {};

    // Setup SSE mock to return a cleanup function
    vi.mocked(createSSEConnection).mockReturnValue(() => {
      console.log("[TEST] SSE connection cleanup called");
    });

    // Default mock implementations
    mockUseChats.mockReturnValue({
      data: mockChats,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Mock useRecentChats for useChatHistory
    mockUseRecentChats.mockReturnValue({
      data: { chats: mockChats },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    // Mock useArchiveChatEndpoint for useChatHistory
    mockUseArchiveChatEndpoint.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
    });
    mockUseUpdateChat.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue({}),
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
    // Render the chat history hook with router context
    const { result: historyResult, rerender } = renderHook(() =>
      useChatHistory(),
    );

    // Initially we should have the list of chats
    expect(historyResult.current.chats).toEqual(mockChats);

    // Navigate to the first chat
    act(() => {
      historyResult.current.navigateToChat("chat1");
    });

    // The navigate function should have been called
    expect(mockNavigate).toHaveBeenCalledWith("/chat/chat1");

    // Simulate URL change after navigation
    mockLocation = { pathname: "/chat/chat1" };
    mockParams = { id: "chat1" };
    rerender();

    // Verify the current chat ID is set
    expect(historyResult.current.currentChatId).toBe("chat1");

    // Render the messaging hook for chat1
    const { result: messagingResult1 } = renderHook(() =>
      useChatMessaging("chat1"),
    );

    // Should have chat1 messages
    expect(messagingResult1.current.messageOrder).toHaveLength(2);
    expect(
      messagingResult1.current.messages[
        messagingResult1.current.messageOrder[0]
      ].content,
    ).toEqual([{ content_type: "text", text: "Hello from chat 1" }]);

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

    // The navigate function should have been called
    expect(mockNavigate).toHaveBeenCalledWith("/chat/chat2");

    // Simulate URL change after navigation
    mockLocation = { pathname: "/chat/chat2" };
    mockParams = { id: "chat2" };
    rerender();

    // Verify the current chat ID is updated
    expect(historyResult.current.currentChatId).toBe("chat2");

    // Render the messaging hook for chat2
    const { result: messagingResult2 } = renderHook(() =>
      useChatMessaging("chat2"),
    );

    // Should have chat2 messages
    expect(messagingResult2.current.messageOrder).toHaveLength(1);
    expect(
      messagingResult2.current.messages[
        messagingResult2.current.messageOrder[0]
      ].content,
    ).toEqual([{ content_type: "text", text: "Different chat message" }]);
  });

  it("should create a new chat and send a message", async () => {
    // Mock empty chat messages for a new chat
    mockUseChatMessages.mockReturnValueOnce({
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
      refetch: vi.fn(),
    });

    // Render the chat history hook with router context
    const { result: historyResult, rerender } = renderHook(() =>
      useChatHistory(),
    );

    // Create a new chat
    await act(async () => {
      await historyResult.current.createNewChat();
    });

    // Should navigate to new chat page
    expect(mockNavigate).toHaveBeenCalledWith("/chat/new", { replace: true });

    // Simulate URL change to /chat/new
    mockLocation = { pathname: "/chat/new" };
    mockParams = {};
    rerender();

    // Manually reset the isNewChatPending flag as would happen in real navigation
    await act(async () => {
      useChatHistoryStore.getState().setNewChatPending(false);
    });

    // Simulate that we've been redirected to a specific chat ID
    // This would happen in the actual app flow after a successful chat creation
    await act(async () => {
      historyResult.current.navigateToChat("new-chat-id");
    });

    // Simulate URL change after navigation to new chat
    mockLocation = { pathname: "/chat/new-chat-id" };
    mockParams = { id: "new-chat-id" };
    rerender();

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

    // Verify the SSE connection was created for message sending
    expect(vi.mocked(createSSEConnection)).toHaveBeenCalledWith(
      "/api/v1beta/me/messages/submitstream",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("First message in new chat"),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        onMessage: expect.any(Function),
        onError: expect.any(Function),
        onClose: expect.any(Function),
        onOpen: expect.any(Function),
      }),
    );

    // At this point in a real app, the API would respond with streaming data
    // and the message would be added to the chat
  });
});
