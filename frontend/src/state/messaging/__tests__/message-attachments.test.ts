import { describe, it, expect, beforeEach } from "vitest";

import { useMessageStore } from "../store";

import type { MessageSender } from "../../types/message.types";

/**
 * Tests focused on message attachments and metadata
 * These tests verify that attachments and metadata are properly maintained during operations
 */
describe("Message Attachments and Metadata", () => {
  // Reset store before each test
  beforeEach(() => {
    const storeState = useMessageStore.getState();
    storeState.resetMessages();
    storeState.resetStreaming();
    storeState.setCurrentChatId(null);
  });

  it("should preserve attachments when updating messages", () => {
    // Arrange - Create a message with attachments
    const fileAttachments = [
      { id: "file-1", filename: "document.pdf" },
      { id: "file-2", filename: "image.jpg" },
    ];

    useMessageStore.getState().addMessage({
      id: "msg-with-attachments",
      content: "Message with attachments",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "complete",
      attachments: fileAttachments,
    });

    // Act - Update the message
    useMessageStore.getState().updateMessage("msg-with-attachments", {
      content: "Updated message content",
    });

    // Assert - Attachments should be preserved
    const state = useMessageStore.getState();
    expect(state.messages["msg-with-attachments"].content).toBe(
      "Updated message content",
    );
    expect(state.messages["msg-with-attachments"].attachments).toEqual(
      fileAttachments,
    );
  });

  it("should preserve attachments when updating message status", () => {
    // Arrange - Create a message with attachments
    const fileAttachments = [{ id: "file-1", filename: "document.pdf" }];

    useMessageStore.getState().addMessage({
      id: "msg-status-update",
      content: "Message with attachments",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "pending",
      attachments: fileAttachments,
    });

    // Act - Update the message status
    useMessageStore
      .getState()
      .setMessageStatus("msg-status-update", "complete");

    // Assert - Attachments should be preserved
    const state = useMessageStore.getState();
    expect(state.messages["msg-status-update"].status).toBe("complete");
    expect(state.messages["msg-status-update"].attachments).toEqual(
      fileAttachments,
    );
  });

  it("should maintain metadata when streaming content", () => {
    // Arrange - Create a message with metadata
    const metadata = {
      modelId: "gpt-4",
      tokenCount: 150,
      custom: { key: "value" },
    };

    useMessageStore.getState().addMessage({
      id: "msg-with-metadata",
      content: "",
      sender: "assistant" as MessageSender,
      createdAt: new Date(),
      status: "pending",
      metadata,
    });

    // Start streaming
    useMessageStore
      .getState()
      .setMessageStatus("msg-with-metadata", "streaming");
    useMessageStore.getState().setStreaming({
      status: "active",
      messageId: "msg-with-metadata",
      content: "",
    });

    // Act - Append content and complete streaming
    useMessageStore
      .getState()
      .appendContent("msg-with-metadata", "Streamed content");
    useMessageStore
      .getState()
      .setMessageStatus("msg-with-metadata", "complete");
    useMessageStore.getState().resetStreaming();

    // Assert - Metadata should be preserved
    const state = useMessageStore.getState();
    expect(state.messages["msg-with-metadata"].content).toBe(
      "Streamed content",
    );
    expect(state.messages["msg-with-metadata"].metadata).toEqual(metadata);
  });

  it("should allow updating attachments with message updates", () => {
    // Arrange - Create a message with initial attachments
    const initialAttachments = [{ id: "file-1", filename: "document.pdf" }];

    useMessageStore.getState().addMessage({
      id: "msg-attachment-update",
      content: "Initial message",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "complete",
      attachments: initialAttachments,
    });

    // Act - Update the message with new attachments
    const updatedAttachments = [
      { id: "file-1", filename: "document.pdf" },
      { id: "file-2", filename: "image.jpg" },
      { id: "file-3", filename: "spreadsheet.xlsx" },
    ];

    useMessageStore.getState().updateMessage("msg-attachment-update", {
      attachments: updatedAttachments,
    });

    // Assert - Attachments should be updated
    const state = useMessageStore.getState();
    expect(state.messages["msg-attachment-update"].attachments).toEqual(
      updatedAttachments,
    );
    expect(state.messages["msg-attachment-update"].attachments?.length).toBe(3);
  });

  it("should handle complex updates to message properties", () => {
    // Arrange - Create a message with various properties
    const initialMessage = {
      id: "complex-msg",
      content: "Initial content",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "complete" as const,
      attachments: [{ id: "file-1", filename: "document.pdf" }],
      metadata: { source: "user-input", edited: false },
    };

    useMessageStore.getState().addMessage(initialMessage);

    // Act - Perform a complex update with multiple properties
    useMessageStore.getState().updateMessage("complex-msg", {
      content: "Updated content",
      status: "error" as const,
      error: new Error("Test error"),
      attachments: [], // Remove attachments
      metadata: {
        ...initialMessage.metadata,
        edited: true,
        editTime: new Date(),
      },
    });

    // Assert - All properties should be correctly updated
    const state = useMessageStore.getState();
    const updatedMessage = state.messages["complex-msg"];

    expect(updatedMessage.content).toBe("Updated content");
    expect(updatedMessage.status).toBe("error");
    expect(updatedMessage.error).toBeInstanceOf(Error);
    expect(updatedMessage.error?.message).toBe("Test error");
    expect(updatedMessage.attachments).toEqual([]);
    expect(updatedMessage.metadata).toHaveProperty("edited", true);
    expect(updatedMessage.metadata).toHaveProperty("editTime");
    expect(updatedMessage.metadata).toHaveProperty("source", "user-input");
  });

  it("should reset messages but preserve the chat ID", () => {
    // Arrange - Set up messages and chat ID
    useMessageStore.getState().setCurrentChatId("chat-123");

    useMessageStore.getState().addMessage({
      id: "msg-1",
      content: "Hello",
      sender: "user" as MessageSender,
      createdAt: new Date(),
      status: "complete",
    });

    // Act - Reset messages
    useMessageStore.getState().resetMessages();

    // Assert - Messages should be empty but chat ID preserved
    const state = useMessageStore.getState();
    expect(Object.keys(state.messages).length).toBe(0);
    expect(state.messageOrder.length).toBe(0);
    expect(state.currentChatId).toBe("chat-123");
  });
});
