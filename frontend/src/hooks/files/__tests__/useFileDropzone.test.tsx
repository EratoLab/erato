import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  NEW_CHAT_STREAM_KEY,
  useMessagingStore,
} from "@/hooks/chat/store/messagingStore";
import {
  useUploadFile,
  useCreateChat,
  fetchUploadFile,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useUploadFeature } from "@/providers/FeatureConfigProvider";
import { FileTypeUtil } from "@/utils/fileTypes";

import { UploadTooLargeError } from "../errors";
import { useFileDropzone } from "../useFileDropzone";
import { useFileUploadStore } from "../useFileUploadStore";

const MiB = 1024 * 1024;
const DEFAULT_MAX_SIZE = 20 * MiB;

// Mock the API hook
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useUploadFile: vi.fn(),
  useCreateChat: vi.fn(),
  fetchUploadFile: vi.fn(),
}));

// Mock FeatureConfigProvider
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: vi.fn(() => ({
    enabled: true,
    maxSizeBytes: DEFAULT_MAX_SIZE,
    maxSizeFormatted: "20 MB",
  })),
}));

// Mock FileCapabilitiesProvider
vi.mock("@/providers/FileCapabilitiesProvider", () => ({
  useFileCapabilitiesContext: vi.fn(() => ({
    capabilities: [
      {
        id: "pdf",
        extensions: ["pdf"],
        mime_types: ["application/pdf"],
        operations: ["extract_text"],
      },
      {
        id: "image",
        extensions: ["jpg", "jpeg", "png"],
        mime_types: ["image/*"],
        operations: ["analyze_image"],
      },
      {
        id: "text",
        extensions: ["txt"],
        mime_types: ["text/plain"],
        operations: ["extract_text"],
      },
    ],
    isLoading: false,
    error: null,
  })),
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

  const createMockUploadedFile = (id: string, filename: string) => ({
    id,
    filename,
    download_url: `http://example.com/${filename}`,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: FileTypeUtil.createMockFileCapability(filename),
  });

  // Setup mocks for each test
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset the Zustand stores
    act(() => {
      useFileUploadStore.getState().reset();
      useMessagingStore.setState({
        isAwaitingFirstStreamChunkForNewChat: false,
        newlyCreatedChatId: null,
        streamingByKey: {},
        streamKeyAliases: {},
        activeStreamKey: NEW_CHAT_STREAM_KEY,
      });
    });

    // Setup fetchUploadFile mock using vi.mocked
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [
        createMockUploadedFile("file1", "test1.pdf"),
        createMockUploadedFile("file2", "test2.jpg"),
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
        createMockUploadedFile("file1", "test1.pdf"),
        createMockUploadedFile("file2", "test2.jpg"),
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
        createMockUploadedFile("file1", "test1.pdf"),
        createMockUploadedFile("file2", "test2.jpg"),
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
      createMockUploadedFile("file1", "test1.pdf"),
      createMockUploadedFile("file2", "test2.jpg"),
    ]);
    expect(result.current.error).toBeNull();

    // Check callback
    expect(mockOnFilesUploaded).toHaveBeenCalledWith([
      createMockUploadedFile("file1", "test1.pdf"),
      createMockUploadedFile("file2", "test2.jpg"),
    ]);
  });

  it("should respect the multiple and maxFiles settings", async () => {
    // Mock fetchUploadFile to return successful response for single file
    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [createMockUploadedFile("file1", "test1.pdf")],
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

  it("routes a first-turn upload to the streaming chat instead of orphaning it", async () => {
    act(() => {
      useMessagingStore.setState({
        isAwaitingFirstStreamChunkForNewChat: true,
        newlyCreatedChatId: "streaming-chat-id",
      });
    });

    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [createMockUploadedFile("file1", "test1.pdf")],
    });

    const { result } = renderHook(() =>
      useFileDropzone({ chatId: null, multiple: true }),
    );

    const testFile = new File(["test content"], "test1.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    expect(mockCreateChatMutateAsync).not.toHaveBeenCalled();
    expect(mockFetchUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: { chat_id: "streaming-chat-id" },
      }),
    );
    expect(useFileUploadStore.getState().silentChatId).toBeNull();
  });

  it("waits for chat_created before uploading a first-turn file", async () => {
    act(() => {
      useMessagingStore.setState({
        isAwaitingFirstStreamChunkForNewChat: true,
        newlyCreatedChatId: null,
      });
    });

    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [createMockUploadedFile("file1", "test1.pdf")],
    });

    const { result } = renderHook(() =>
      useFileDropzone({ chatId: null, multiple: true }),
    );

    const testFile = new File(["test content"], "test1.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      const uploadPromise = result.current.uploadFiles([testFile]);
      // chat_created lands just after the file is attached.
      useMessagingStore.getState().setNewlyCreatedChatIdInStore("late-chat-id");
      await uploadPromise;
    });

    expect(mockCreateChatMutateAsync).not.toHaveBeenCalled();
    expect(mockFetchUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: { chat_id: "late-chat-id" },
      }),
    );
  });

  it("creates a silent chat for a fresh compose with no streaming first turn", async () => {
    mockCreateChatMutateAsync.mockResolvedValue({ chat_id: "silent-chat-id" });

    const mockFetchUploadFile = vi.mocked(fetchUploadFile);
    mockFetchUploadFile.mockResolvedValue({
      files: [createMockUploadedFile("file1", "test1.pdf")],
    });

    const { result } = renderHook(() =>
      useFileDropzone({ chatId: null, multiple: true }),
    );

    const testFile = new File(["test content"], "test1.pdf", {
      type: "application/pdf",
    });

    await act(async () => {
      await result.current.uploadFiles([testFile]);
    });

    expect(mockCreateChatMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchUploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        queryParams: { chat_id: "silent-chat-id" },
      }),
    );
    expect(useFileUploadStore.getState().silentChatId).toBe("silent-chat-id");
  });

  describe("file size preflight", () => {
    const CUSTOM_LIMIT = 15 * MiB;

    function makeFileWithSize(name: string, size: number): File {
      const blob = new Blob([new Uint8Array(size)]);
      return new File([blob], name, { type: "application/octet-stream" });
    }

    beforeEach(() => {
      vi.mocked(useUploadFeature).mockReturnValue({
        enabled: true,
        maxSizeBytes: CUSTOM_LIMIT,
        maxSizeFormatted: "15 MiB",
      });
    });

    it("does not call fetchUploadFile or useCreateChat when a file is oversized", async () => {
      const mockFetchUploadFile = vi.mocked(fetchUploadFile);

      const { result } = renderHook(() =>
        useFileDropzone({ chatId: null, multiple: true }),
      );

      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(mockFetchUploadFile).not.toHaveBeenCalled();
      expect(mockCreateChatMutateAsync).not.toHaveBeenCalled();
    });

    it("sets an UploadTooLargeError with the formatted limit on size rejection", async () => {
      const { result } = renderHook(() =>
        useFileDropzone({ chatId: "existing-chat-id" }),
      );

      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
      expect(result.current.error?.message).toContain("15 MiB");
    });

    it("accepts a file exactly at the limit", async () => {
      const mockFetchUploadFile = vi.mocked(fetchUploadFile);
      mockFetchUploadFile.mockResolvedValue({
        files: [createMockUploadedFile("file1", "exact.pdf")],
      });

      const { result } = renderHook(() =>
        useFileDropzone({ chatId: "existing-chat-id" }),
      );

      // Use a PDF so it passes the capability check in the mock
      const exactBytes = new Uint8Array(CUSTOM_LIMIT);
      const blob = new Blob([exactBytes], { type: "application/pdf" });
      const exactFile = new File([blob], "exact.pdf", { type: "application/pdf" });

      await act(async () => {
        await result.current.uploadFiles([exactFile]);
      });

      expect(mockFetchUploadFile).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    });

    it("rejects the entire batch when one file is oversized, uploading nothing", async () => {
      const mockFetchUploadFile = vi.mocked(fetchUploadFile);

      const { result } = renderHook(() =>
        useFileDropzone({ chatId: "existing-chat-id", multiple: true }),
      );

      const files = [
        makeFileWithSize("ok.bin", CUSTOM_LIMIT),
        makeFileWithSize("toobig.bin", CUSTOM_LIMIT + 1),
      ];

      await act(async () => {
        await result.current.uploadFiles(files);
      });

      expect(mockFetchUploadFile).not.toHaveBeenCalled();
      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
    });

    it("does not set isUploading to true when files are rejected by preflight", async () => {
      const { result } = renderHook(() =>
        useFileDropzone({ chatId: "existing-chat-id" }),
      );

      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(result.current.isUploading).toBe(false);
    });

    it("still uploads valid files when they are within the limit", async () => {
      const mockFetchUploadFile = vi.mocked(fetchUploadFile);
      mockFetchUploadFile.mockResolvedValue({
        files: [createMockUploadedFile("file1", "valid.pdf")],
      });

      const { result } = renderHook(() =>
        useFileDropzone({ chatId: "existing-chat-id" }),
      );

      // Use a PDF so it passes the capability check in the mock
      const validBytes = new Uint8Array(CUSTOM_LIMIT - 1);
      const blob = new Blob([validBytes], { type: "application/pdf" });
      const validFile = new File([blob], "valid.pdf", { type: "application/pdf" });

      await act(async () => {
        await result.current.uploadFiles([validFile]);
      });

      expect(mockFetchUploadFile).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    });
  });
});
