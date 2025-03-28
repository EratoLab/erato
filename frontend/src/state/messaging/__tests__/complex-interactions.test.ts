import { describe, it, expect, beforeEach } from "vitest";

import { useMessageStore } from "../store";

describe("Message Store Complex Interactions", () => {
  // Reset store before each test
  beforeEach(() => {
    const store = useMessageStore.getState();
    store.resetMessages();
    store.resetStreaming();
    store.setCurrentChatId(null);
  });

  describe("Streaming workflow", () => {
    it("should correctly handle a complete streaming workflow", () => {
      // Arrange
      const store = useMessageStore.getState();
      const timestamp = new Date();

      // 1. Initialize with a user message
      const userMessage = {
        id: "user1",
        content: "Hello, how are you?",
        sender: "user",
        createdAt: timestamp,
        status: "complete",
      } as const;
      store.addMessage(userMessage);

      // 2. Create a pending assistant message
      const assistantMessage = {
        id: "assistant1",
        content: "",
        sender: "assistant",
        createdAt: new Date(timestamp.getTime() + 1000),
        status: "pending",
      } as const;
      store.addMessage(assistantMessage);

      // 3. Start streaming
      store.setMessageStatus("assistant1", "streaming");
      store.setStreaming({
        status: "connecting",
        messageId: "assistant1",
        content: "",
      });

      // 4. Streaming becomes active
      store.setStreamingStatus("active");

      // 5. Append content in chunks
      store.appendContent("assistant1", "Hello");
      store.appendContent("assistant1", ", I'm");
      store.appendContent("assistant1", " doing");
      store.appendContent("assistant1", " well!");

      // 6. Complete streaming
      store.setStreamingStatus("completed");
      store.setMessageStatus("assistant1", "complete");
      store.resetStreaming();

      // Assert - Final state checks
      const state = useMessageStore.getState();

      // Check messages
      expect(Object.keys(state.messages).length).toBe(2);
      expect(state.messageOrder).toEqual(["user1", "assistant1"]);

      // Check user message is intact
      expect(state.messages["user1"]).toEqual(userMessage);

      // Check assistant message has the right content and status
      expect(state.messages["assistant1"].content).toBe(
        "Hello, I'm doing well!",
      );
      expect(state.messages["assistant1"].status).toBe("complete");

      // Streaming state is reset
      expect(state.streaming.status).toBe("idle");
      expect(state.streaming.messageId).toBe(null);
      expect(state.streaming.content).toBe("");
    });

    it("should handle error during streaming", () => {
      // Arrange
      const store = useMessageStore.getState();

      // 1. Add a message that will receive streaming content
      const assistantMessage = {
        id: "assistant1",
        content: "Partial content",
        sender: "assistant",
        createdAt: new Date(),
        status: "streaming",
      } as const;
      store.addMessage(assistantMessage);

      // 2. Setup streaming
      store.setStreaming({
        status: "active",
        messageId: "assistant1",
        content: "Partial content",
      });

      // 3. Simulate an error
      const error = new Error("Network failure");
      store.setStreaming({
        status: "error",
        error,
      });
      store.setMessageStatus("assistant1", "error");
      store.updateMessage("assistant1", { error });

      // Assert
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("error");
      expect(state.streaming.error).toBe(error);
      expect(state.messages["assistant1"].status).toBe("error");
      expect(state.messages["assistant1"].error).toBe(error);
    });
  });

  describe("Message manipulation workflow", () => {
    it("should handle multiple messages and operations correctly", () => {
      // Arrange
      const store = useMessageStore.getState();

      // 1. Add multiple messages
      for (let i = 1; i <= 5; i++) {
        const isUser = i % 2 === 1;
        store.addMessage({
          id: `msg${i}`,
          content: `Message ${i}`,
          sender: isUser ? "user" : "assistant",
          createdAt: new Date(Date.now() + i * 1000),
          status: "complete",
        });
      }

      // 2. Verify initial state
      let state = useMessageStore.getState();
      expect(Object.keys(state.messages).length).toBe(5);
      expect(state.messageOrder.length).toBe(5);

      // 3. Remove messages 2 and 4
      store.removeMessage("msg2");
      store.removeMessage("msg4");

      // 4. Verify state after removal
      state = useMessageStore.getState();
      expect(Object.keys(state.messages).length).toBe(3);
      expect(state.messageOrder).toEqual(["msg1", "msg3", "msg5"]);

      // 5. Update remaining messages
      store.updateMessage("msg1", { content: "Updated message 1" });
      store.updateMessage("msg3", { content: "Updated message 3" });
      store.updateMessage("msg5", { content: "Updated message 5" });

      // 6. Verify updates
      state = useMessageStore.getState();
      expect(state.messages["msg1"].content).toBe("Updated message 1");
      expect(state.messages["msg3"].content).toBe("Updated message 3");
      expect(state.messages["msg5"].content).toBe("Updated message 5");
    });
  });
});
