import { render, screen, fireEvent } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";

import { useChatMessaging } from "@/hooks/chat/useChatMessaging";

import ChatPage from "../[id]/ChatPage";
import "@testing-library/jest-dom";

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

// Mock the ChatWidget component with proper types
interface ChatWidgetProps {
  messages: {
    id: string;
    content: string;
    role: string;
    createdAt: string;
    status: string;
  }[];
  onSendMessage: (content: string) => void;
  isLoading: boolean;
  controlsContext: Record<string, unknown>;
  className: string;
}

vi.mock("@/components/ui/Chat/ChatWidget", () => ({
  ChatWidget: ({ messages, onSendMessage, isLoading }: ChatWidgetProps) => (
    <div data-testid="chat-widget">
      <div data-testid="message-count">{messages.length} messages</div>
      <div data-testid="loading-state">
        {isLoading ? "Loading" : "Not loading"}
      </div>
      <button
        data-testid="send-button"
        onClick={() => onSendMessage("Test message")}
      >
        Send
      </button>
      {messages.map((msg) => (
        <div key={msg.id} data-testid={`message-${msg.role}`}>
          {msg.content}
        </div>
      ))}
    </div>
  ),
}));

describe("ChatPage", () => {
  const mockSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

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
    render(<ChatPage />);

    // Check that the chat widget is rendered
    expect(screen.getByTestId("chat-widget")).toBeInTheDocument();

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
    render(<ChatPage />);

    // Click the send button
    fireEvent.click(screen.getByTestId("send-button"));

    // Check that sendMessage was called
    expect(mockSendMessage).toHaveBeenCalledWith("Test message");
  });

  it("shows the loading state", async () => {
    // Override the mock for this test to show loading
    (
      useChatMessaging as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(() => ({
      messages: [],
      isLoading: true,
      isStreaming: false,
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
    }));

    render(<ChatPage />);

    // Check loading state
    expect(screen.getByTestId("loading-state").textContent).toBe("Loading");
  });

  it("shows streaming state", async () => {
    // Override the mock for this test to show streaming
    (
      useChatMessaging as unknown as ReturnType<typeof vi.fn>
    ).mockImplementationOnce(() => ({
      messages: [],
      isLoading: false,
      isStreaming: true,
      sendMessage: vi.fn(),
      cancelMessage: vi.fn(),
    }));

    render(<ChatPage />);

    // Check that the stop generating button is shown
    expect(screen.getByText("Stop generating")).toBeInTheDocument();
  });
});
