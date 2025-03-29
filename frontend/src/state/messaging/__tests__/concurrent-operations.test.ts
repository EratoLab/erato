import { describe, it, expect, beforeEach } from "vitest";

import { useMessageStore } from "../store";

import type { MessageSender } from "../../types/message.types";

/**
 * Tests focused on potential race conditions and concurrent operations
 * These tests verify that the store handles multiple operations correctly
 */
describe("Message Store Concurrent Operations", () => {
  // Reset store before each test
  beforeEach(() => {
    const storeState = useMessageStore.getState();
    storeState.resetMessages();
    storeState.resetStreaming();
    storeState.setCurrentChatId(null);
  });

  it("should handle concurrent message updates without conflicts", () => {
    // Arrange - Create multiple messages
    const messageIds = [];
    for (let i = 0; i < 5; i++) {
      useMessageStore.getState().addMessage({
        id: `msg-${i}`,
        content: `Initial content ${i}`,
        sender: (i % 2 === 0 ? "user" : "assistant") as MessageSender,
        createdAt: new Date(),
        status: "complete",
      });
      messageIds.push(`msg-${i}`);
    }

    // Act - Update all messages concurrently (simulating concurrent operations)
    messageIds.forEach((id, index) => {
      useMessageStore.getState().updateMessage(id, {
        content: `Updated content ${index}`,
      });
    });

    // Assert - All updates should be applied correctly
    const state = useMessageStore.getState();
    messageIds.forEach((id, index) => {
      expect(state.messages[id].content).toBe(`Updated content ${index}`);
    });
  });

  it("should update message order when re-adding a message", () => {
    // Arrange - Original order
    const originalOrder = ["msg-a", "msg-b", "msg-c", "msg-d"];

    // Add messages in specific order
    originalOrder.forEach((id, index) => {
      useMessageStore.getState().addMessage({
        id,
        content: `Message ${index}`,
        sender: (index % 2 === 0 ? "user" : "assistant") as MessageSender,
        createdAt: new Date(Date.now() + index * 1000), // Ensure order by time
        status: "complete",
      });
    });

    // Act - Perform concurrent operations that affect order
    // Update all messages in reverse order (simulating concurrent ops)
    [...originalOrder].reverse().forEach((id, index) => {
      useMessageStore.getState().updateMessage(id, {
        content: `Updated message ${index}`,
      });
    });

    // Even remove and re-add a message in the middle
    useMessageStore.getState().removeMessage("msg-b");
    useMessageStore.getState().addMessage({
      id: "msg-b",
      content: "Re-added message",
      sender: "assistant" as MessageSender,
      createdAt: new Date(Date.now() + 1 * 1000), // Same timing as before
      status: "complete",
    });

    // Assert - Message order should have msg-b at the end (since it was removed and re-added)
    const state = useMessageStore.getState();
    const expectedNewOrder = ["msg-a", "msg-c", "msg-d", "msg-b"];
    expect(state.messageOrder).toEqual(expectedNewOrder);
  });

  it("should handle interleaved streaming operations correctly", () => {
    // Arrange - Create two assistant messages for streaming
    useMessageStore.getState().addMessage({
      id: "assistant-1",
      content: "",
      sender: "assistant" as MessageSender,
      createdAt: new Date(Date.now()),
      status: "pending",
    });

    useMessageStore.getState().addMessage({
      id: "assistant-2",
      content: "",
      sender: "assistant" as MessageSender,
      createdAt: new Date(Date.now() + 1000),
      status: "pending",
    });

    // Start streaming to the first message
    useMessageStore.getState().setMessageStatus("assistant-1", "streaming");
    useMessageStore.getState().setStreaming({
      status: "active",
      messageId: "assistant-1",
      content: "",
    });

    // Start sending content
    useMessageStore.getState().appendContent("assistant-1", "First message ");
    useMessageStore.getState().appendContent("assistant-1", "is streaming");

    // Act - Switch streaming to the second message (simulating interruption)
    useMessageStore.getState().setMessageStatus("assistant-2", "streaming");
    useMessageStore.getState().setStreaming({
      status: "active",
      messageId: "assistant-2",
      content: "",
    });

    // Stream content to the second message
    useMessageStore.getState().appendContent("assistant-2", "Second message ");
    useMessageStore.getState().appendContent("assistant-2", "interrupted ");
    useMessageStore.getState().appendContent("assistant-2", "the first");

    // Complete streaming for the second message
    useMessageStore.getState().setMessageStatus("assistant-2", "complete");
    useMessageStore.getState().resetStreaming();

    // Assert - Content of both messages should be intact
    const state = useMessageStore.getState();
    expect(state.messages["assistant-1"].content).toBe(
      "First message is streaming",
    );
    expect(state.messages["assistant-1"].status).toBe("streaming"); // Still in streaming status
    expect(state.messages["assistant-2"].content).toBe(
      "Second message interrupted the first",
    );
    expect(state.messages["assistant-2"].status).toBe("complete");

    // Streaming state should be reset
    expect(state.streaming.status).toBe("idle");
    expect(state.streaming.messageId).toBe(null);
  });

  it("should handle rapid state transitions", () => {
    // Arrange - Create a message
    useMessageStore.getState().addMessage({
      id: "rapid-msg",
      content: "",
      sender: "assistant" as MessageSender,
      createdAt: new Date(),
      status: "pending",
    });

    // Act - Perform rapid state transitions
    // This simulates many status changes happening quickly
    const statusTransitions: Array<
      "pending" | "streaming" | "complete" | "error"
    > = [
      "pending",
      "streaming",
      "pending",
      "streaming",
      "error",
      "pending",
      "streaming",
      "complete",
    ];

    // Apply all transitions rapidly
    statusTransitions.forEach((status) => {
      useMessageStore.getState().setMessageStatus("rapid-msg", status);
    });

    // Assert - Final status should be the last one applied
    const state = useMessageStore.getState();
    expect(state.messages["rapid-msg"].status).toBe("complete");
  });

  it("should maintain data consistency when performing multiple operations", () => {
    // Arrange - Initial set of messages
    const initialMessages = [
      { id: "msg-1", content: "Message 1", sender: "user" as MessageSender },
      {
        id: "msg-2",
        content: "Message 2",
        sender: "assistant" as MessageSender,
      },
      { id: "msg-3", content: "Message 3", sender: "user" as MessageSender },
    ];

    initialMessages.forEach((msg) => {
      useMessageStore.getState().addMessage({
        ...msg,
        createdAt: new Date(),
        status: "complete",
      });
    });

    // Act - Perform a series of mixed operations
    // 1. Remove a message
    useMessageStore.getState().removeMessage("msg-2");

    // 2. Add a new message
    useMessageStore.getState().addMessage({
      id: "msg-4",
      content: "Message 4",
      sender: "assistant" as MessageSender,
      createdAt: new Date(),
      status: "pending",
    });

    // 3. Update an existing message
    useMessageStore.getState().updateMessage("msg-3", {
      content: "Updated Message 3",
    });

    // 4. Start streaming
    useMessageStore.getState().setStreaming({
      status: "active",
      messageId: "msg-4",
      content: "",
    });

    // 5. Append content - note: appendContent appends to the existing content
    useMessageStore.getState().appendContent("msg-4", "Streaming content");

    // 6. Add another message
    useMessageStore.getState().addMessage({
      id: "msg-5",
      content: "Message 5",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "complete",
    });

    // Assert - Final state should be consistent
    const state = useMessageStore.getState();

    // Check message count (3 original - 1 removed + 2 added = 4)
    expect(Object.keys(state.messages).length).toBe(4);

    // Check specific messages
    expect(state.messages["msg-1"]).toBeDefined();
    expect(state.messages["msg-2"]).toBeUndefined(); // Removed
    expect(state.messages["msg-3"].content).toBe("Updated Message 3");
    // Since appendContent adds to existing content, the result is concatenated
    expect(state.messages["msg-4"].content).toBe("Message 4Streaming content");
    expect(state.messages["msg-5"]).toBeDefined();

    // Check messageOrder includes all non-removed messages
    expect(state.messageOrder).toEqual(["msg-1", "msg-3", "msg-4", "msg-5"]);

    // Check streaming state
    expect(state.streaming.status).toBe("active");
    expect(state.streaming.messageId).toBe("msg-4");
    expect(state.streaming.content).toBe("Streaming content");
  });
});
