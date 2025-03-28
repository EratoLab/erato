import { describe, it, expect, beforeEach } from "vitest";

import { useMessageStore } from "../store";

describe("useMessageStore", () => {
  // Reset store before each test
  beforeEach(() => {
    const store = useMessageStore.getState();
    store.resetMessages();
    store.resetStreaming();
    store.setCurrentChatId(null);
  });

  describe("Message operations", () => {
    it("should add a message", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello, world!",
        sender: "user",
        createdAt: new Date(),
        status: "complete",
      } as const;

      // Act
      store.addMessage(message);

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"]).toEqual(message);
      expect(state.messageOrder).toContain("msg1");
      expect(state.messageOrder.length).toBe(1);
    });

    it("should update a message", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello, world!",
        sender: "user",
        createdAt: new Date(),
        status: "complete",
      } as const;
      store.addMessage(message);

      // Act
      store.updateMessage("msg1", { content: "Updated content" });

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"].content).toBe("Updated content");
      expect(state.messages["msg1"].sender).toBe("user"); // Other fields unchanged
    });

    it("should set message status", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello, world!",
        sender: "user",
        createdAt: new Date(),
        status: "pending",
      } as const;
      store.addMessage(message);

      // Act
      store.setMessageStatus("msg1", "complete");

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"].status).toBe("complete");
    });

    it("should remove a message", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello, world!",
        sender: "user",
        createdAt: new Date(),
        status: "complete",
      } as const;
      store.addMessage(message);

      // Act
      store.removeMessage("msg1");

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"]).toBeUndefined();
      expect(state.messageOrder).not.toContain("msg1");
      expect(state.messageOrder.length).toBe(0);
    });

    it("should append content to a message", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello",
        sender: "assistant",
        createdAt: new Date(),
        status: "streaming",
      } as const;
      store.addMessage(message);

      // Act
      store.appendContent("msg1", ", world!");

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"].content).toBe("Hello, world!");
    });

    it("should reset all messages", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message1 = {
        id: "msg1",
        content: "Hello",
        sender: "user",
        createdAt: new Date(),
        status: "complete",
      } as const;
      const message2 = {
        id: "msg2",
        content: "Hi",
        sender: "assistant",
        createdAt: new Date(),
        status: "complete",
      } as const;
      store.addMessage(message1);
      store.addMessage(message2);

      // Act
      store.resetMessages();

      // Assert
      const state = useMessageStore.getState();
      expect(Object.keys(state.messages).length).toBe(0);
      expect(state.messageOrder.length).toBe(0);
    });
  });

  describe("Streaming operations", () => {
    it("should set streaming status", () => {
      // Arrange
      const store = useMessageStore.getState();

      // Act
      store.setStreamingStatus("active");

      // Assert
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("active");
    });

    it("should update streaming state", () => {
      // Arrange
      const store = useMessageStore.getState();

      // Act
      store.setStreaming({
        status: "active",
        messageId: "msg1",
        content: "Streaming content",
      });

      // Assert
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("active");
      expect(state.streaming.messageId).toBe("msg1");
      expect(state.streaming.content).toBe("Streaming content");
    });

    it("should reset streaming state", () => {
      // Arrange
      const store = useMessageStore.getState();
      store.setStreaming({
        status: "active",
        messageId: "msg1",
        content: "Streaming content",
      });

      // Act
      store.resetStreaming();

      // Assert
      const state = useMessageStore.getState();
      expect(state.streaming.status).toBe("idle");
      expect(state.streaming.messageId).toBe(null);
      expect(state.streaming.content).toBe("");
    });

    it("should append content to both message and streaming content when streaming a message", () => {
      // Arrange
      const store = useMessageStore.getState();
      const message = {
        id: "msg1",
        content: "Hello",
        sender: "assistant",
        createdAt: new Date(),
        status: "streaming",
      } as const;
      store.addMessage(message);
      store.setStreaming({
        status: "active",
        messageId: "msg1",
        content: "Hello",
      });

      // Act
      store.appendContent("msg1", ", world!");

      // Assert
      const state = useMessageStore.getState();
      expect(state.messages["msg1"].content).toBe("Hello, world!");
      expect(state.streaming.content).toBe("Hello, world!");
    });
  });

  describe("Chat operations", () => {
    it("should set the current chat ID", () => {
      // Arrange
      const store = useMessageStore.getState();

      // Act
      store.setCurrentChatId("chat123");

      // Assert
      const state = useMessageStore.getState();
      expect(state.currentChatId).toBe("chat123");
    });
  });
});
