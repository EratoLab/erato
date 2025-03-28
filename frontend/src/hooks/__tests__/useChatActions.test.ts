import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useChatActions } from "../useChatActions";

import type { MessageAction } from "@/types/message-controls";

describe("useChatActions", () => {
  // Mock functions
  const mockSwitchSession = vi.fn();
  const mockSendMessage = vi.fn().mockResolvedValue(undefined);
  const mockOnMessageAction = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    // Reset mocks before each test
    vi.resetAllMocks();
  });

  it("should call switchSession when handleSessionSelect is called", () => {
    // Arrange
    const { result } = renderHook(() =>
      useChatActions(mockSwitchSession, mockSendMessage),
    );

    // Act
    result.current.handleSessionSelect("session123");

    // Assert
    expect(mockSwitchSession).toHaveBeenCalledTimes(1);
    expect(mockSwitchSession).toHaveBeenCalledWith("session123");
  });

  it("should call the custom handler when provided to handleSessionSelect", () => {
    // Arrange
    const { result } = renderHook(() =>
      useChatActions(mockSwitchSession, mockSendMessage),
    );
    const customHandler = vi.fn();

    // Act
    result.current.handleSessionSelect("session123", customHandler);

    // Assert
    expect(customHandler).toHaveBeenCalledTimes(1);
    expect(customHandler).toHaveBeenCalledWith("session123");
    expect(mockSwitchSession).not.toHaveBeenCalled(); // Regular handler should not be called
  });

  it("should call sendMessage when handleSendMessage is called", () => {
    // Arrange
    const { result } = renderHook(() =>
      useChatActions(mockSwitchSession, mockSendMessage),
    );

    // Act
    result.current.handleSendMessage("Hello, world!");

    // Assert
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith("Hello, world!");
  });

  it("should call onMessageAction when handleMessageAction is called", async () => {
    // Arrange
    const { result } = renderHook(() =>
      useChatActions(mockSwitchSession, mockSendMessage, mockOnMessageAction),
    );

    const action: MessageAction = { type: "rerun", messageId: "msg123" };

    // Act
    await result.current.handleMessageAction(action);

    // Assert
    expect(mockOnMessageAction).toHaveBeenCalledTimes(1);
    expect(mockOnMessageAction).toHaveBeenCalledWith(action);
  });

  it("should not throw if onMessageAction is not provided", async () => {
    // Arrange
    const { result } = renderHook(() =>
      useChatActions(mockSwitchSession, mockSendMessage),
    );

    const action: MessageAction = { type: "rerun", messageId: "msg123" };

    // Act & Assert - should not throw
    await expect(
      result.current.handleMessageAction(action),
    ).resolves.not.toThrow();
    expect(mockOnMessageAction).not.toHaveBeenCalled();
  });
});
