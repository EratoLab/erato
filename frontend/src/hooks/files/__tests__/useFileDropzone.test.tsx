import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  useUploadFile,
  useCreateChat,
  fetchUploadFile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { useFileDropzone } from "../useFileDropzone";
import { useFileUploadStore } from "../useFileUploadStore";

// Mock the API hook
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useUploadFile: vi.fn(),
  useCreateChat: vi.fn(),
  fetchUploadFile: vi.fn(),
}));

// Mock react-dropzone
vi.mock("react-dropzone", () => {
  return {
    useDropzone: vi.fn(() => ({
      getRootProps: vi.fn(),
      getInputProps: vi.fn(),
      isDragActive: false,
      isDragAccept: false,
      isDragReject: false,
      open: vi.fn(),
    })),
  };
});

describe("useFileDropzone", () => {
  const mockMutateAsync = vi.fn();
  const mockCreateChatMutateAsync = vi.fn();
  const mockOnFilesUploaded = vi.fn();

  // Setup mocks for each test
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the Zustand store
    act(() => {
      useFileUploadStore.getState().reset();
    });

    // Setup fetchUploadFile mock using vi.mocked
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [
        {
          id: "file1",
          filename: "test1.pdf",
          download_url: "http://example.com/file1.pdf",
        },
        {
          id: "file2",
          filename: "test2.jpg",
          download_url: "http://example.com/file2.jpg",
        },
      ],
    });

    // Default API mock implementation
    (useUploadFile as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: false,
      error: null,
    });

    // Default create chat mock implementation
    (useCreateChat as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: mockCreateChatMutateAsync,
      isPending: false,
      isError: false,
      error: null,
    });

    // Default successful upload response
    mockMutateAsync.mockResolvedValue({
      files: [
        {
          id: "file1",
          filename: "test1.pdf",
          download_url: "http://example.com/file1.pdf",
        },
        {
          id: "file2",
          filename: "test2.jpg",
          download_url: "http://example.com/file2.jpg",
        },
      ],
    });

    // Default successful chat creation response
    mockCreateChatMutateAsync.mockResolvedValue({
      id: "new-chat-id",
      title: "New Chat",
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should initialize with default values", () => {
    const { result } = renderHook(() => useFileDropzone({}));

    expect(result.current.uploadedFiles).toEqual([]);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should handle file uploads successfully", async () => {
    // Mock fetchUploadFile to return successful response
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [
        {
          id: "file1",
          filename: "test1.pdf",
          download_url: "http://example.com/file1.pdf",
        },
        {
          id: "file2",
          filename: "test2.jpg",
          download_url: "http://example.com/file2.jpg",
        },
      ],
    });

    const { result } = renderHook(() =>
      useFileDropzone({
        onFilesUploaded: mockOnFilesUploaded,
        multiple: true,
        chatId: "existing-chat-id", // Provide existing chat ID to avoid chat creation
      }),
    );

    // Create test files
    const testFiles = [
      new File(["test content"], "test1.pdf", { type: "application/pdf" }),
      new File(["test image"], "test2.jpg", { type: "image/jpeg" }),
    ];

    // Upload files
    await act(async () => {
      await result.current.uploadFiles(testFiles);
    });

    // Check if fetchUploadFile was called correctly
    expect(mockFetchUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: {
          chat_id: "existing-chat-id",
        },
        body: expect.any(FormData),
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }),
    );

    // Check state updates
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadedFiles).toEqual([
      {
        id: "file1",
        filename: "test1.pdf",
        download_url: "http://example.com/file1.pdf",
      },
      {
        id: "file2",
        filename: "test2.jpg",
        download_url: "http://example.com/file2.jpg",
      },
    ]);
    expect(result.current.error).toBeNull();

    // Check callback
    expect(mockOnFilesUploaded).toHaveBeenCalledWith([
      {
        id: "file1",
        filename: "test1.pdf",
        download_url: "http://example.com/file1.pdf",
      },
      {
        id: "file2",
        filename: "test2.jpg",
        download_url: "http://example.com/file2.jpg",
      },
    ]);
  });

  it("should respect the multiple and maxFiles settings", async () => {
    // Mock fetchUploadFile to return successful response for single file
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [
        {
          id: "file1",
          filename: "test1.pdf",
          download_url: "http://example.com/file1.pdf",
        },
      ],
    });

    const { result } = renderHook(() =>
      useFileDropzone({
        multiple: false,
        maxFiles: 1,
        chatId: "existing-chat-id", // Provide existing chat ID to avoid chat creation
      }),
    );

    const testFiles = [
      new File(["test content"], "test1.pdf", { type: "application/pdf" }),
      new File(["test image"], "test2.jpg", { type: "image/jpeg" }),
      new File(["another file"], "test3.txt", { type: "text/plain" }),
    ];

    await act(async () => {
      await result.current.uploadFiles(testFiles);
    });

    // Should only upload the first file (maxFiles: 1, multiple: false)
    expect(mockFetchUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: {
          chat_id: "existing-chat-id",
        },
        body: expect.any(FormData),
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }),
    );

    // Check that only one file was uploaded
    expect(result.current.uploadedFiles).toHaveLength(1);
    expect(result.current.uploadedFiles[0].filename).toBe("test1.pdf");
  });

  it("should handle upload errors", async () => {
    // Mock fetchUploadFile to throw an error
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    const mockError = new Error("Upload failed");
    mockFetchUploadFile.mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useFileDropzone({
        chatId: "existing-chat-id", // Provide existing chat ID to avoid chat creation
      }),
    );

    const testFile = new File(["test content"], "error.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    // Check error handling
    expect(result.current.isUploading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
    if (result.current.error instanceof Error) {
      expect(result.current.error.message).toContain("Upload failed");
    }
  });

  it("should clear uploaded files", async () => {
    const { result } = renderHook(() => useFileDropzone({}));

    // Upload files first
    const testFile = new File(["test content"], "test.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    // Verify files are uploaded
    expect(result.current.uploadedFiles.length).toBeGreaterThan(0);

    // Clear files
    act(() => {
      result.current.clearFiles();
    });

    // Check that files are cleared
    expect(result.current.uploadedFiles).toEqual([]);
  });

  it("should not upload when disabled", async () => {
    const { result } = renderHook(() =>
      useFileDropzone({
        disabled: true,
      }),
    );

    const testFile = new File(["test content"], "test.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    // API should not be called
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("should not upload when already uploading", async () => {
    // Set initial state to uploading
    act(() => {
      useFileUploadStore.getState().setUploading(true);
    });

    const { result } = renderHook(() => useFileDropzone({}));

    const testFile = new File(["test content"], "test.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    // API should not be called
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
