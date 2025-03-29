import { describe, it, expect, beforeEach } from "vitest";

import { useMessageStore } from "../store";

import type { MessageSender } from "../../types/message.types";

/**
 * Tests focused on message streaming behavior
 * These tests verify the interactions between streaming state and message state
 */
describe("Message Streaming Interactions", () => {
  // Reset store before each test
  beforeEach(() => {
    const store = useMessageStore.getState();
    store.resetMessages();
    store.resetStreaming();
    store.setCurrentChatId(null);
  });

  describe("Streaming lifecycle", () => {
    it("should handle a complete streaming lifecycle", () => {
      // Arrange
      const messageId = "msg-stream-1";

      // 1. Create a message that will receive streamed content
      useMessageStore.getState().addMessage({
        id: messageId,
        content: "",
        sender: "assistant" as MessageSender,
        createdAt: new Date(),
        status: "pending",
      });

      // 2. Start streaming
      useMessageStore.getState().setMessageStatus(messageId, "streaming");
      useMessageStore.getState().setStreaming({
        status: "connecting",
        messageId,
        content: "",
      });

      // 3. Connection established
      useMessageStore.getState().setStreamingStatus("active");

      // Get current state and verify
      let state = useMessageStore.getState();
      expect(state.streaming.status).toBe("active");
      expect(state.messages[messageId].status).toBe("streaming");

      // 4. Receive content chunks
      useMessageStore.getState().appendContent(messageId, "Hello");
      useMessageStore.getState().appendContent(messageId, ", ");
      useMessageStore.getState().appendContent(messageId, "world");
      useMessageStore.getState().appendContent(messageId, "!");

      // 5. Verify content is updated in both streaming state and message
      state = useMessageStore.getState();
      expect(state.streaming.content).toBe("Hello, world!");
      expect(state.messages[messageId].content).toBe("Hello, world!");

      // 6. Complete streaming
      useMessageStore.getState().setStreamingStatus("completed");
      useMessageStore.getState().setMessageStatus(messageId, "complete");

      // 7. Verify final state
      state = useMessageStore.getState();
      expect(state.messages[messageId].status).toBe("complete");
      expect(state.messages[messageId].content).toBe("Hello, world!");

      // 8. Reset streaming (as would happen in normal flow)
      useMessageStore.getState().resetStreaming();

      // 9. Verify streaming reset but message content preserved
      state = useMessageStore.getState();
      expect(state.streaming.status).toBe("idle");
      expect(state.streaming.messageId).toBe(null);
      expect(state.streaming.content).toBe("");
      expect(state.messages[messageId].content).toBe("Hello, world!");
    });

    it("should handle streaming cancellation", () => {
      // Arrange
      const messageId = "msg-cancel";

      // 1. Create a message
      useMessageStore.getState().addMessage({
        id: messageId,
        content: "",
        sender: "assistant" as MessageSender,
        createdAt: new Date(),
        status: "pending",
      });

      // 2. Start streaming
      useMessageStore.getState().setMessageStatus(messageId, "streaming");
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId,
        content: "",
      });

      // 3. Add some content
      useMessageStore.getState().appendContent(messageId, "Partial content");

      // 4. Cancel streaming
      useMessageStore.getState().setStreamingStatus("cancelled");

      // 5. Handle cancellation in the message
      useMessageStore.getState().setMessageStatus(messageId, "complete");

      // 6. Reset streaming
      useMessageStore.getState().resetStreaming();

      // 7. Verify message still has the partial content
      const state = useMessageStore.getState();
      expect(state.messages[messageId].content).toBe("Partial content");
      expect(state.messages[messageId].status).toBe("complete");
      expect(state.streaming.status).toBe("idle");
    });

    it("should handle streaming errors", () => {
      // Arrange
      const messageId = "msg-error";

      // 1. Create a message
      useMessageStore.getState().addMessage({
        id: messageId,
        content: "",
        sender: "assistant" as MessageSender,
        createdAt: new Date(),
        status: "pending",
      });

      // 2. Start streaming
      useMessageStore.getState().setMessageStatus(messageId, "streaming");
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId,
        content: "",
      });

      // 3. Add some content
      useMessageStore
        .getState()
        .appendContent(messageId, "Partial content before error");

      // 4. Simulate an error
      const error = new Error("Stream connection lost");
      useMessageStore.getState().setStreaming({
        status: "error",
        error,
      });

      // 5. Update message to reflect error
      useMessageStore.getState().setMessageStatus(messageId, "error");
      useMessageStore.getState().updateMessage(messageId, { error });

      // 6. Verify error state
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("error");
      expect(state.streaming.error).toBe(error);
      expect(state.messages[messageId].status).toBe("error");
      expect(state.messages[messageId].error).toBe(error);
      expect(state.messages[messageId].content).toBe(
        "Partial content before error",
      );
    });
  });

  describe("Streaming with multiple messages", () => {
    it("should correctly handle streaming with existing messages", () => {
      // Arrange
      // 1. Add some existing messages
      useMessageStore.getState().addMessage({
        id: "user-1",
        content: "Hello, how are you?",
        sender: "user" as MessageSender,
        createdAt: new Date(Date.now() - 2000),
        status: "complete",
      });

      useMessageStore.getState().addMessage({
        id: "assistant-1",
        content: "I'm doing well, thanks!",
        sender: "assistant" as MessageSender,
        createdAt: new Date(Date.now() - 1000),
        status: "complete",
      });

      // 2. Add a new user message
      useMessageStore.getState().addMessage({
        id: "user-2",
        content: "Tell me about React",
        sender: "user" as MessageSender,
        createdAt: new Date(),
        status: "complete",
      });

      // 3. Create a new assistant message for streaming
      const streamingMsgId = "assistant-2";
      useMessageStore.getState().addMessage({
        id: streamingMsgId,
        content: "",
        sender: "assistant" as MessageSender,
        createdAt: new Date(Date.now() + 1000),
        status: "pending",
      });

      // 4. Start streaming
      useMessageStore.getState().setMessageStatus(streamingMsgId, "streaming");
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId: streamingMsgId,
        content: "",
      });

      // 5. Stream content
      useMessageStore
        .getState()
        .appendContent(
          streamingMsgId,
          "React is a JavaScript library for building user interfaces.",
        );

      // 6. Verify state
      let state = useMessageStore.getState();
      expect(state.messageOrder).toEqual([
        "user-1",
        "assistant-1",
        "user-2",
        "assistant-2",
      ]);
      expect(state.messages[streamingMsgId].content).toBe(
        "React is a JavaScript library for building user interfaces.",
      );
      expect(state.streaming.content).toBe(
        "React is a JavaScript library for building user interfaces.",
      );

      // 7. Complete streaming
      useMessageStore.getState().setStreamingStatus("completed");
      useMessageStore.getState().setMessageStatus(streamingMsgId, "complete");
      useMessageStore.getState().resetStreaming();

      // 8. Verify all messages
      state = useMessageStore.getState();
      expect(Object.keys(state.messages).length).toBe(4);
      expect(state.messages["user-1"].content).toBe("Hello, how are you?");
      expect(state.messages["assistant-1"].content).toBe(
        "I'm doing well, thanks!",
      );
      expect(state.messages["user-2"].content).toBe("Tell me about React");
      expect(state.messages[streamingMsgId].content).toBe(
        "React is a JavaScript library for building user interfaces.",
      );
    });

    it("should only update the currently streaming message when appending content", () => {
      // Arrange
      // 1. Add multiple assistant messages
      useMessageStore.getState().addMessage({
        id: "assistant-1",
        content: "First response",
        sender: "assistant" as MessageSender,
        createdAt: new Date(Date.now() - 1000),
        status: "complete",
      });

      useMessageStore.getState().addMessage({
        id: "assistant-2",
        content: "",
        sender: "assistant" as MessageSender,
        createdAt: new Date(),
        status: "streaming",
      });

      // 2. Start streaming to the second message
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId: "assistant-2",
        content: "",
      });

      // 3. Append content
      useMessageStore.getState().appendContent("assistant-2", "New content");

      // 4. Verify only the streaming message was updated
      const state = useMessageStore.getState();
      expect(state.messages["assistant-1"].content).toBe("First response");
      expect(state.messages["assistant-2"].content).toBe("New content");
      expect(state.streaming.content).toBe("New content");
    });
  });

  describe("Edge cases", () => {
    it("should handle appending to non-existent message", () => {
      // Arrange
      // Act - Try to append to a message that doesn't exist
      useMessageStore.getState().appendContent("non-existent", "Some content");

      // Assert - No error should occur, and state should remain unchanged
      const state = useMessageStore.getState();
      expect(state.messages["non-existent"]).toBeUndefined();
    });

    it("should handle streaming without a message ID", () => {
      // Arrange
      // 1. Set streaming without a messageId
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId: null,
        content: "Orphaned content",
      });

      // 2. Verify streaming state
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("active");
      expect(state.streaming.messageId).toBe(null);
      expect(state.streaming.content).toBe("Orphaned content");

      // 3. Try to append content (shouldn't crash)
      useMessageStore.getState().appendContent("non-existent", "More content");
    });

    it("should maintain correct message order when streaming", () => {
      // Arrange
      // 1. Add messages in a specific order
      const messages = [
        {
          id: "msg1",
          sender: "user" as MessageSender,
          content: "First message",
        },
        {
          id: "msg2",
          sender: "assistant" as MessageSender,
          content: "First response",
        },
        {
          id: "msg3",
          sender: "user" as MessageSender,
          content: "Second message",
        },
        { id: "msg4", sender: "assistant" as MessageSender, content: "" }, // Empty for streaming
      ];

      messages.forEach((msg) => {
        useMessageStore.getState().addMessage({
          ...msg,
          createdAt: new Date(),
          status: "complete",
        });
      });

      // 2. Start streaming to the last message
      useMessageStore.getState().setMessageStatus("msg4", "streaming");
      useMessageStore.getState().setStreaming({
        status: "active",
        messageId: "msg4",
        content: "",
      });

      // 3. Stream content in chunks
      useMessageStore.getState().appendContent("msg4", "Second ");
      useMessageStore.getState().appendContent("msg4", "response");

      // 4. Verify message order is preserved
      const state = useMessageStore.getState();
      expect(state.messageOrder).toEqual(["msg1", "msg2", "msg3", "msg4"]);
      expect(state.messages["msg4"].content).toBe("Second response");
    });
  });
});
