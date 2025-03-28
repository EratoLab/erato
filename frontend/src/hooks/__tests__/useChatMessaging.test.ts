import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Define the mock function
const mockRandomUUID = vi.fn(() => "mock-uuid");

// Mock crypto globally
vi.stubGlobal("crypto", {
  randomUUID: mockRandomUUID,
});

import { useChatMessaging, generateMessageId } from "../useChatMessaging";

// Mock the MessagingContext
vi.mock("@/components/containers/MessagingProvider", () => ({
  useMessagingContext: () => ({
    sendMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the useFileUpload hook
vi.mock("../useFileUpload", () => ({
  useFileUpload: ({
    onUploadSuccess,
  }: {
    onUploadSuccess: (files: Array<{ id: string; filename: string }>) => void;
  }) => ({
    uploadFiles: (files: File[]) => {
      // Mock successful upload
      const uploadedFiles = files.map((file, index) => ({
        id: `file-${index}`,
        filename: file.name,
      }));

      // Call the success callback
      onUploadSuccess(uploadedFiles);

      return Promise.resolve(uploadedFiles);
    },
    isUploading: false,
    error: null,
  }),
}));

describe("useChatMessaging", () => {
  // Mock props
  const messageOrder: string[] = [];
  const addMessage = vi.fn();
  const updateMessage = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset the mock implementation
    mockRandomUUID.mockImplementation(() => "mock-uuid");
  });

  describe("generateMessageId", () => {
    it("should generate a UUID", () => {
      expect(generateMessageId()).toBe("mock-uuid");
      expect(mockRandomUUID).toHaveBeenCalled();
    });
  });

  describe("sendMessage", () => {
    it("should not send empty messages without attachments", async () => {
      // Arrange
      const { result } = renderHook(() =>
        useChatMessaging(messageOrder, addMessage, updateMessage),
      );

      // Act
      await act(async () => {
        await result.current.sendMessage("", "session-123");
      });

      // Assert
      expect(addMessage).not.toHaveBeenCalled();
    });

    it("should add user and assistant messages", async () => {
      // Arrange
      const { result } = renderHook(() =>
        useChatMessaging(messageOrder, addMessage, updateMessage),
      );

      // Act
      await act(async () => {
        await result.current.sendMessage("Hello, world!", "session-123");
      });

      // Assert - Should add both user and assistant messages
      expect(addMessage).toHaveBeenCalledTimes(2);

      // First call - User message
      expect(addMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          content: "Hello, world!",
          sender: "user",
          authorId: "user",
          attachments: [],
        }),
      );

      // Second call - Assistant message
      expect(addMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          content: "",
          sender: "assistant",
          authorId: "assistant",
          loading: { state: "loading" },
        }),
      );
    });

    it("should handle file attachments", async () => {
      // Arrange
      const { result } = renderHook(() =>
        useChatMessaging(messageOrder, addMessage, updateMessage),
      );

      // Setup files
      const files = [
        { id: "file-1", filename: "document.pdf" },
        { id: "file-2", filename: "image.jpg" },
      ];

      // Add file attachments
      act(() => {
        result.current.handleFileAttachments(files);
      });

      // Act - Send message with attachments
      await act(async () => {
        await result.current.sendMessage(
          "Message with attachments",
          "session-123",
        );
      });

      // Assert - User message should have attachments
      expect(addMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          content: "Message with attachments",
          attachments: files,
        }),
      );

      // Attachments should be cleared after sending
      await act(async () => {
        await result.current.sendMessage("Next message", "session-123");
      });

      expect(addMessage).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          content: "Next message",
          attachments: [],
        }),
      );
    });

    it("should handle file uploads", async () => {
      // Arrange
      const { result } = renderHook(() =>
        useChatMessaging(messageOrder, addMessage, updateMessage),
      );

      // Create a mock file
      const mockFile = new File(["dummy content"], "test.txt", {
        type: "text/plain",
      });

      // Act - Upload the file
      await act(async () => {
        await result.current.performFileUpload([mockFile]);
      });

      // Send a message
      await act(async () => {
        await result.current.sendMessage(
          "Message with uploaded file",
          "session-123",
        );
      });

      // Assert
      expect(addMessage).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          content: "Message with uploaded file",
          attachments: [{ id: "file-0", filename: "test.txt" }],
        }),
      );
    });
  });
});
