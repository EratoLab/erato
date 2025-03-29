import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useMessageStore } from "../../state/messaging/store";

// Mock custom hook
vi.mock("../useStreamConnection", () => ({
  useStreamConnection: () => ({
    startStreaming: vi.fn((url, options) => {
      // Simulate streaming by calling the callbacks
      if (options?.onStart) options.onStart();

      // Return mock controller
      return {
        abort: vi.fn(),
        stream: {
          sendChunk: (content: string) => {
            if (options?.onContent) options.onContent(content);
          },
          complete: () => {
            if (options?.onComplete) options.onComplete();
          },
          error: (error: Error) => {
            if (options?.onError) options.onError(error);
          },
        },
      };
    }),
  }),
}));

// Define a counter for unique IDs in tests
let messageIdCounter = 0;

/**
 * Mock implementation of a message streaming hook that uses the store
 * This mimics how a real hook would use the store for streaming
 */
function useMessageStreaming() {
  const {
    messages,
    streaming,
    addMessage,
    updateMessage,
    setMessageStatus,
    setStreaming,
    setStreamingStatus,
    appendContent,
    resetStreaming,
  } = useMessageStore();

  const startMessageStream = (messageId: string, content = "") => {
    // Set initial state
    setMessageStatus(messageId, "streaming");
    setStreaming({
      status: "connecting",
      messageId,
      content,
    });

    // Simulate connecting
    setTimeout(() => {
      setStreamingStatus("active");
    }, 10);

    // Return functions to control the stream
    return {
      appendChunk: (chunk: string) => {
        appendContent(messageId, chunk);
      },
      completeStream: () => {
        setStreamingStatus("completed");
        setMessageStatus(messageId, "complete");
        resetStreaming();
      },
      errorStream: (error: Error) => {
        setMessageStatus(messageId, "error");
        setStreaming({
          status: "error",
          error,
        });
        updateMessage(messageId, { error });
      },
    };
  };

  const createMessage = (content: string, sender: "user" | "assistant") => {
    // Use a counter instead of timestamp to ensure unique IDs in tests
    const id = `msg-test-${messageIdCounter++}`;
    addMessage({
      id,
      content,
      sender,
      createdAt: new Date(),
      status: sender === "user" ? "complete" : "pending",
    });
    return id;
  };

  return {
    messages,
    streaming,
    createMessage,
    startMessageStream,
  };
}

describe("Message Streaming Hook", () => {
  beforeEach(() => {
    // Reset the store before each test
    const store = useMessageStore.getState();
    store.resetMessages();
    store.resetStreaming();
    // Reset the ID counter
    messageIdCounter = 0;
  });

  it("should handle the complete streaming lifecycle", async () => {
    // Arrange
    const { result } = renderHook(() => useMessageStreaming());

    // Act - Create messages
    let userMsgId: string;
    let assistantMsgId: string;
    await act(async () => {
      userMsgId = result.current.createMessage("What is React?", "user");
      assistantMsgId = result.current.createMessage("", "assistant");
    });

    // Start streaming
    let streamController: ReturnType<typeof result.current.startMessageStream>;
    await act(async () => {
      streamController = result.current.startMessageStream(assistantMsgId);
    });

    // Wait for active state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Send content in chunks
    await act(async () => {
      streamController.appendChunk("React");
      streamController.appendChunk(" is");
      streamController.appendChunk(" a");
      streamController.appendChunk(" JavaScript");
      streamController.appendChunk(" library");
    });

    // Assert streaming state
    expect(result.current.streaming.status).toBe("active");
    expect(result.current.streaming.messageId).toBe(assistantMsgId);
    expect(result.current.streaming.content).toBe(
      "React is a JavaScript library",
    );
    expect(result.current.messages[assistantMsgId].content).toBe(
      "React is a JavaScript library",
    );

    // Complete the stream
    await act(async () => {
      streamController.completeStream();
    });

    // Assert final state
    expect(result.current.streaming.status).toBe("idle");
    expect(result.current.streaming.messageId).toBe(null);
    expect(result.current.messages[assistantMsgId].status).toBe("complete");
    expect(result.current.messages[assistantMsgId].content).toBe(
      "React is a JavaScript library",
    );
  });

  it("should handle streaming errors", async () => {
    // Arrange
    const { result } = renderHook(() => useMessageStreaming());

    // Create messages
    let assistantMsgId: string;
    await act(async () => {
      result.current.createMessage("Can you explain this error?", "user");
      assistantMsgId = result.current.createMessage("", "assistant");
    });

    // Start streaming
    let streamController: ReturnType<typeof result.current.startMessageStream>;
    await act(async () => {
      streamController = result.current.startMessageStream(assistantMsgId);
    });

    // Wait for active state
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Send some content
    await act(async () => {
      streamController.appendChunk("I'll try to explain the error. ");
    });

    // Simulate an error
    const testError = new Error("Connection lost");
    await act(async () => {
      streamController.errorStream(testError);
    });

    // Assert error state
    expect(result.current.streaming.status).toBe("error");
    expect(result.current.streaming.error).toBe(testError);
    expect(result.current.messages[assistantMsgId].status).toBe("error");
    expect(result.current.messages[assistantMsgId].error).toBe(testError);
    expect(result.current.messages[assistantMsgId].content).toBe(
      "I'll try to explain the error. ",
    );
  });

  it("should maintain the conversation context during streaming", async () => {
    vi.useFakeTimers(); // Use fake timers to prevent timing issues

    // Arrange
    const { result } = renderHook(() => useMessageStreaming());

    // Create a conversation with multiple turns
    let userMsg1Id: string;
    let assistantMsg1Id: string;
    let userMsg2Id: string;
    let assistantMsg2Id: string;

    // First turn - user message first
    await act(async () => {
      userMsg1Id = result.current.createMessage("Hello", "user");
    });

    // First assistant message
    await act(async () => {
      assistantMsg1Id = result.current.createMessage("", "assistant");
    });

    // Stream first response
    let streamController1: ReturnType<typeof result.current.startMessageStream>;

    await act(async () => {
      streamController1 = result.current.startMessageStream(assistantMsg1Id);
      // Fast-forward past setTimeout in startMessageStream
      vi.advanceTimersByTime(20);
    });

    // Complete the first streaming response
    await act(async () => {
      streamController1.appendChunk("Hi there! How can I help you?");
      streamController1.completeStream();
    });

    // Second turn - user message
    await act(async () => {
      userMsg2Id = result.current.createMessage("What is JavaScript?", "user");
    });

    // Second assistant message
    await act(async () => {
      assistantMsg2Id = result.current.createMessage("", "assistant");
    });

    // Stream second response
    let streamController2: ReturnType<typeof result.current.startMessageStream>;

    await act(async () => {
      streamController2 = result.current.startMessageStream(assistantMsg2Id);
      // Fast-forward past setTimeout in startMessageStream
      vi.advanceTimersByTime(20);
    });

    // Stream content in chunks
    await act(async () => {
      streamController2.appendChunk("JavaScript is a programming language");
      streamController2.appendChunk(" that powers the web.");
    });

    // Complete the second stream
    await act(async () => {
      streamController2.completeStream();
    });

    // Log IDs and messages for debugging
    console.log("Message IDs:", {
      userMsg1Id,
      assistantMsg1Id,
      userMsg2Id,
      assistantMsg2Id,
    });
    console.log("Messages:", Object.keys(result.current.messages));

    // Assert the full conversation state
    // We should have as many messages as we've created (should be 4 with unique IDs)
    expect(Object.keys(result.current.messages).length).toBe(4);

    // Check that we have the expected messages with their content
    const allMessages = Object.values(result.current.messages);

    // Check for user message 1
    const userMessage1 = allMessages.find(
      (m) => m.sender === "user" && m.content === "Hello",
    );
    expect(userMessage1).toBeDefined();
    expect(userMessage1?.status).toBe("complete");

    // Check for assistant message 1
    const assistantMessage1 = allMessages.find(
      (m) =>
        m.sender === "assistant" &&
        m.content === "Hi there! How can I help you?",
    );
    expect(assistantMessage1).toBeDefined();
    expect(assistantMessage1?.status).toBe("complete");

    // Check for user message 2
    const userMessage2 = allMessages.find(
      (m) => m.sender === "user" && m.content === "What is JavaScript?",
    );
    expect(userMessage2).toBeDefined();
    expect(userMessage2?.status).toBe("complete");

    // Check for assistant message 2
    const assistantMessage2 = allMessages.find(
      (m) =>
        m.sender === "assistant" &&
        m.content ===
          "JavaScript is a programming language that powers the web.",
    );
    expect(assistantMessage2).toBeDefined();
    expect(assistantMessage2?.status).toBe("complete");

    vi.useRealTimers(); // Restore real timers
  });
});
