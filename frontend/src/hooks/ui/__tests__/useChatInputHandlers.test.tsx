import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { useChatInputHandlers } from "../useChatInputHandlers";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

describe("useChatInputHandlers", () => {
  const mockFileAttachmentHandler = vi.fn();
  const mockSendMessage = vi.fn();
  const mockResetMessage = vi.fn();

  const mockFiles: FileUploadItem[] = [
    { id: "file1", filename: "test1.pdf" },
    { id: "file2", filename: "test2.jpg" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with default values", () => {
    const { result } = renderHook(() => useChatInputHandlers());

    expect(result.current.attachedFiles).toEqual([]);
    expect(result.current.fileError).toBeNull();
  });

  it("should initialize with initial files", () => {
    const { result } = renderHook(() =>
      useChatInputHandlers(5, mockFileAttachmentHandler, mockFiles),
    );

    expect(result.current.attachedFiles).toEqual(mockFiles);
  });

  it("should handle files uploaded", () => {
    const { result } = renderHook(() =>
      useChatInputHandlers(5, mockFileAttachmentHandler),
    );

    act(() => {
      result.current.handleFilesUploaded(mockFiles);
    });

    expect(result.current.attachedFiles).toEqual(mockFiles);
    expect(mockFileAttachmentHandler).toHaveBeenCalledWith(mockFiles);
  });

  it("should respect maxFiles limit", () => {
    const maxFiles = 1;
    const { result } = renderHook(() =>
      useChatInputHandlers(maxFiles, mockFileAttachmentHandler),
    );

    act(() => {
      result.current.handleFilesUploaded(mockFiles);
    });

    // Should only keep the first file due to maxFiles = 1
    expect(result.current.attachedFiles).toEqual([mockFiles[0]]);
    expect(mockFileAttachmentHandler).toHaveBeenCalledWith([mockFiles[0]]);
  });

  it("should handle removing a file by ID", () => {
    const { result } = renderHook(() =>
      useChatInputHandlers(5, mockFileAttachmentHandler, mockFiles),
    );

    act(() => {
      result.current.handleRemoveFile("file1");
    });

    expect(result.current.attachedFiles).toEqual([mockFiles[1]]);
    expect(mockFileAttachmentHandler).toHaveBeenCalledWith([mockFiles[1]]);
  });

  it("should handle removing a file by object", () => {
    const { result } = renderHook(() =>
      useChatInputHandlers(5, mockFileAttachmentHandler, mockFiles),
    );

    act(() => {
      result.current.handleRemoveFile(mockFiles[0]);
    });

    expect(result.current.attachedFiles).toEqual([mockFiles[1]]);
    expect(mockFileAttachmentHandler).toHaveBeenCalledWith([mockFiles[1]]);
  });

  it("should handle removing all files", () => {
    const { result } = renderHook(() =>
      useChatInputHandlers(5, mockFileAttachmentHandler, mockFiles),
    );

    act(() => {
      result.current.handleRemoveAllFiles();
    });

    expect(result.current.attachedFiles).toEqual([]);
    expect(mockFileAttachmentHandler).toHaveBeenCalledWith([]);
  });

  it("should create a submit handler that validates input", () => {
    const { result } = renderHook(() => useChatInputHandlers());

    // Create the submit handler with dependencies
    const handleSubmit = result.current.createSubmitHandler(
      "test message",
      mockSendMessage,
      false, // isLoading
      false, // disabled
      mockResetMessage,
    );

    // Mock event object
    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    // Execute the submit handler
    act(() => {
      handleSubmit(mockEvent);
    });

    // Verify behavior
    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledWith("test message");
    expect(mockResetMessage).toHaveBeenCalled();
  });

  it("should not submit when loading", () => {
    const { result } = renderHook(() => useChatInputHandlers());

    const handleSubmit = result.current.createSubmitHandler(
      "test message",
      mockSendMessage,
      true, // isLoading
      false, // disabled
      mockResetMessage,
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    act(() => {
      handleSubmit(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockResetMessage).not.toHaveBeenCalled();
  });

  it("should not submit when disabled", () => {
    const { result } = renderHook(() => useChatInputHandlers());

    const handleSubmit = result.current.createSubmitHandler(
      "test message",
      mockSendMessage,
      false, // isLoading
      true, // disabled
      mockResetMessage,
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    act(() => {
      handleSubmit(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockResetMessage).not.toHaveBeenCalled();
  });

  it("should not submit empty messages", () => {
    const { result } = renderHook(() => useChatInputHandlers());

    const handleSubmit = result.current.createSubmitHandler(
      "   ", // Empty after trim
      mockSendMessage,
      false, // isLoading
      false, // disabled
      mockResetMessage,
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.FormEvent;

    act(() => {
      handleSubmit(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockResetMessage).not.toHaveBeenCalled();
  });
});
