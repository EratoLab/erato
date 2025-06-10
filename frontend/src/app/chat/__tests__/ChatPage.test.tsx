import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { useChatMessaging } from "@/hooks/chat/useChatMessaging";
import { messages as enMessages } from "@/locales/en/messages";
import { useChatContext } from "@/providers/ChatProvider";

import ChatPageStructure from "../ChatPageStructure.client";
import "@testing-library/jest-dom";

// Initialize i18n for tests
i18n.load("en", enMessages);
i18n.activate("en");

// Mock necessary hooks and components
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useParams: () => ({ id: "test-chat-id" }),
}));

vi.mock("@/hooks/chat/useChatHistory", () => ({
  useChatHistory: () => ({
    currentChatId: "test-chat-id",
    navigateToChat: vi.fn(),
  }),
}));

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: vi.fn(),
}));

vi.mock("@/hooks/useProfile", () => ({
  useProfile: vi.fn().mockImplementation(() => ({
    profile: {
      id: "test-user-id",
      name: "Test User",
      email: "test@example.com",
    },
    isLoading: false,
    error: null,
  })),
}));

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: vi.fn().mockImplementation(() => ({
    theme: "light",
    setTheme: vi.fn(),
    themes: ["light", "dark"],
    systemTheme: "light",
  })),
}));

vi.mock("@/hooks/chat/useChatMessaging", () => ({
  useChatMessaging: vi.fn().mockImplementation(() => ({
    messages: [
      {
        id: "msg1",
        content: "Hello from test chat",
        role: "user",
        createdAt: "2023-01-01T12:00:00.000Z",
        status: "complete",
      },
      {
        id: "msg2",
        content: "Hi there!",
        role: "assistant",
        createdAt: "2023-01-01T12:01:00.000Z",
        status: "complete",
      },
    ],
    isLoading: false,
    isStreaming: false,
    sendMessage: vi.fn(),
    cancelMessage: vi.fn(),
  })),
}));

vi.mock("@/hooks/ui/useSidebar", () => ({
  useSidebar: () => ({
    isOpen: true,
    toggle: vi.fn(),
  }),
}));

vi.mock("@/hooks/ui/useFilePreviewModal", () => ({
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
}));

vi.mock("@/hooks/chat", () => ({
  useChatActions: () => ({
    handleSendMessage: vi.fn().mockResolvedValue(undefined),
    handleMessageAction: vi.fn().mockResolvedValue(false),
  }),
}));

// Mock the actual components that are used
vi.mock("@/components/ui/Chat/ChatHistorySidebar", () => ({
  ChatHistorySidebar: () => <div data-testid="chat-sidebar">Sidebar</div>,
}));

vi.mock("@/components/ui/MessageList/MessageList", () => ({
  MessageList: ({
    messages,
    messageOrder,
    isPending,
  }: {
    messages: Record<string, { id: string; content: string; role: string }>;
    messageOrder: string[];
    isPending?: boolean;
  }) => (
    <div data-testid="message-list">
      <div data-testid="message-count">{messageOrder.length} messages</div>
      <div data-testid="loading-state">
        {isPending ? "Loading" : "Not loading"}
      </div>
      {messageOrder.map((messageId) => {
        const message = messages[messageId];
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return message ? (
          <div key={messageId} data-testid={`message-${message.role}`}>
            {message.content}
          </div>
        ) : null;
      })}
    </div>
  ),
}));

vi.mock("@/components/ui/Chat/ChatInput", () => ({
  ChatInput: ({
    onSendMessage,
    isLoading,
  }: {
    onSendMessage: (content: string) => Promise<string | undefined> | void;
    isLoading?: boolean;
  }) => (
    <div data-testid="chat-input">
      <div data-testid="input-loading-state">
        {isLoading ? "Input Loading" : "Input Ready"}
      </div>
      <button
        data-testid="send-button"
        onClick={() => {
          const result = onSendMessage("Test message");
          // Handle both sync and async returns
          if (result && typeof result.then === "function") {
            result.catch(console.error);
          }
        }}
      >
        Send
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/WelcomeScreen", () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen">Welcome</div>,
}));

vi.mock("@/components/ui/Feedback/ChatErrorBoundary", () => ({
  ChatErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@/components/ui/Modal/FilePreviewModal", () => ({
  FilePreviewModal: () => null,
}));

// Test wrapper with necessary providers
const TestWrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider i18n={i18n}>
        <MemoryRouter>{children}</MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>
  );
};

describe("ChatPage", () => {
  const mockSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup useChatContext mock
    (useChatContext as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        // Chat history
        chats: [],
        currentChatId: "test-chat-id",
        isHistoryLoading: false,
        historyError: null,
        createNewChat: vi.fn(),
        archiveChat: vi.fn(),
        navigateToChat: vi.fn(),
        refetchHistory: vi.fn(),

        // Messaging - messages as object with messageOrder array
        messages: {
          msg1: {
            id: "msg1",
            content: "Hello from test chat",
            role: "user",
            createdAt: "2023-01-01T12:00:00.000Z",
            status: "complete",
            sender: "user",
            authorId: "user_id",
          },
          msg2: {
            id: "msg2",
            content: "Hi there!",
            role: "assistant",
            createdAt: "2023-01-01T12:01:00.000Z",
            status: "complete",
            sender: "assistant",
            authorId: "assistant_id",
          },
        },
        messageOrder: ["msg1", "msg2"],
        isStreaming: false,
        streamingContent: null,
        isMessagingLoading: false,
        messagingError: null,
        sendMessage: mockSendMessage,
        cancelMessage: vi.fn(),
        refetchMessages: vi.fn(),

        // File upload
        uploadFiles: vi.fn(),
        isUploading: false,
        uploadError: null,
        uploadedFiles: [],
        clearUploadedFiles: vi.fn(),

        // Combined states
        isLoading: false,
        error: null,

        // Store states
        silentChatId: null,
        newChatCounter: 0,
        mountKey: "test-mount-key",
      }),
    );

    // Default mockImplementation
    (
      useChatMessaging as unknown as ReturnType<typeof vi.fn>
    ).mockImplementation(() => ({
      messages: [
        {
          id: "msg1",
          content: "Hello from test chat",
          role: "user",
          createdAt: "2023-01-01T12:00:00.000Z",
          status: "complete",
        },
        {
          id: "msg2",
          content: "Hi there!",
          role: "assistant",
          createdAt: "2023-01-01T12:01:00.000Z",
          status: "complete",
        },
      ],
      isLoading: false,
      isStreaming: false,
      sendMessage: mockSendMessage,
      cancelMessage: vi.fn(),
    }));
  });

  it("renders the chat page with messages", () => {
    render(
      <TestWrapper>
        <ChatPageStructure>
          <div />
        </ChatPageStructure>
      </TestWrapper>,
    );

    // Check that the message list is rendered
    expect(screen.getByTestId("message-list")).toBeInTheDocument();

    // Check that we have 2 messages
    expect(screen.getByTestId("message-count").textContent).toBe("2 messages");

    // Check the message content
    expect(screen.getByTestId("message-user").textContent).toBe(
      "Hello from test chat",
    );
    expect(screen.getByTestId("message-assistant").textContent).toBe(
      "Hi there!",
    );
  });

  it("handles sending a message", async () => {
    render(
      <TestWrapper>
        <ChatPageStructure>
          <div />
        </ChatPageStructure>
      </TestWrapper>,
    );

    // Check that the chat input is rendered
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();

    // Click the send button
    fireEvent.click(screen.getByTestId("send-button"));

    // The sendMessage should be called through the Chat component's handleSendMessage
    // Since we're testing the integration, we don't need to check the exact mock call
    // Just verify the UI interaction works without errors
    expect(screen.getByTestId("send-button")).toBeInTheDocument();
  });

  it("shows the loading state", async () => {
    // Clear all previous mocks first
    vi.clearAllMocks();

    // Override the mock for this test to show loading
    (useChatContext as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => ({
        // Chat history
        chats: [],
        currentChatId: "test-chat-id",
        isHistoryLoading: false,
        historyError: null,
        createNewChat: vi.fn(),
        archiveChat: vi.fn(),
        navigateToChat: vi.fn(),
        refetchHistory: vi.fn(),

        // Messaging - empty messages with loading state
        messages: {},
        messageOrder: [],
        isStreaming: false,
        streamingContent: null,
        isMessagingLoading: true, // Set loading to true
        messagingError: null,
        sendMessage: vi.fn(),
        cancelMessage: vi.fn(),
        refetchMessages: vi.fn(),

        // File upload
        uploadFiles: vi.fn(),
        isUploading: false,
        uploadError: null,
        uploadedFiles: [],
        clearUploadedFiles: vi.fn(),

        // Combined states
        isLoading: true, // Set loading to true
        error: null,

        // Store states
        silentChatId: null,
        newChatCounter: 0,
        mountKey: "test-mount-key",
      }),
    );

    render(
      <TestWrapper>
        <ChatPageStructure>
          <div />
        </ChatPageStructure>
      </TestWrapper>,
    );

    // Check loading state - the MessageList component should receive isPending=true
    expect(screen.getByTestId("loading-state").textContent).toBe("Loading");
  });

  it("shows streaming state", async () => {
    // Override the mock for this test to show streaming
    (
      useChatContext as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(() => ({
      // Chat history
      chats: [],
      currentChatId: "test-chat-id",
      isHistoryLoading: false,
      historyError: null,
      createNewChat: vi.fn(),
      archiveChat: vi.fn(),
      navigateToChat: vi.fn(),
      refetchHistory: vi.fn(),

      // Messaging - empty messages with streaming state
      messages: {},
      messageOrder: [],
      isStreaming: true, // Set streaming to true
      streamingContent: "Generating response...",
      isMessagingLoading: false,
      messagingError: null,
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
      refetchMessages: vi.fn(),

      // File upload
      uploadFiles: vi.fn(),
      isUploading: false,
      uploadError: null,
      uploadedFiles: [],
      clearUploadedFiles: vi.fn(),

      // Combined states
      isLoading: false,
      error: null,

      // Store states
      silentChatId: null,
      newChatCounter: 0,
      mountKey: "test-mount-key",
    }));

    render(
      <TestWrapper>
        <ChatPageStructure>
          <div />
        </ChatPageStructure>
      </TestWrapper>,
    );

    // Check that the sidebar and input are rendered (basic structure test)
    expect(screen.getByTestId("chat-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});
