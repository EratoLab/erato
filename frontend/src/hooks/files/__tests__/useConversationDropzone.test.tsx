import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useDropzone } from "react-dropzone";

import { UploadTooLargeError } from "../errors";
import { useConversationDropzone } from "../useConversationDropzone";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Capture the onDrop callback react-dropzone receives so we can invoke it
// directly in tests without actually triggering DOM drag events.
let capturedOnDrop: (
  accepted: File[],
  rejected: { file: File; errors: { code: string; message: string }[] }[],
) => void = () => {};

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn((opts) => {
    capturedOnDrop = opts.onDrop ?? (() => {});
    return {
      getRootProps: vi.fn(() => ({})),
      getInputProps: vi.fn(() => ({})),
      isDragActive: false,
      isDragAccept: false,
    };
  }),
}));

const MiB = 1024 * 1024;
const LIMIT = 15 * MiB;

function makeFileWithSize(name: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)]);
  return new File([blob], name, { type: "application/octet-stream" });
}

function makeUploadedItem(filename: string): FileUploadItem {
  return {
    id: "id-" + filename,
    filename,
    download_url: "http://example.com/" + filename,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: { id: "other", operations: [] },
  };
}

describe("useConversationDropzone", () => {
  let mockUploadFiles: ReturnType<typeof vi.fn>;
  let mockOnUploaded: ReturnType<typeof vi.fn>;
  let mockOnError: ReturnType<typeof vi.fn>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadFiles = vi.fn();
    mockOnUploaded = vi.fn();
    mockOnError = vi.fn();

    mockUploadFiles.mockResolvedValue([makeUploadedItem("test.bin")]);
  });

  describe("without maxSize (backward-compatible defaults)", () => {
    it("calls uploadFiles with accepted files", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
        }),
      );

      const file = makeFileWithSize("ok.bin", 100);
      act(() => {
        capturedOnDrop([file], []);
      });

      expect(mockUploadFiles).toHaveBeenCalledWith([file]);
    });

    it("does not call onError when no onError is provided", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
        }),
      );

      // Simulate a dropzone size rejection even without maxSize configured
      const rejection = {
        file: makeFileWithSize("big.bin", LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      act(() => {
        capturedOnDrop([], [rejection]);
      });

      // Nothing should happen — no uploadFiles call, no error
      expect(mockUploadFiles).not.toHaveBeenCalled();
      expect(mockOnError).not.toHaveBeenCalled();
    });
  });

  describe("with maxSize and onError", () => {
    it("passes maxSize to useDropzone", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const lastCall = vi.mocked(useDropzone).mock.calls.at(-1)?.[0];
      expect(lastCall?.maxSize).toBe(LIMIT);
    });

    it("calls onError with UploadTooLargeError when a file-too-large rejection arrives", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          maxSizeFormatted: "15 MiB",
          onError: mockOnError,
        }),
      );

      const rejection = {
        file: makeFileWithSize("big.bin", LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      act(() => {
        capturedOnDrop([], [rejection]);
      });

      expect(mockOnError).toHaveBeenCalledTimes(1);
      const err = mockOnError.mock.calls[0][0];
      expect(err).toBeInstanceOf(UploadTooLargeError);
      expect(err.message).toContain("15 MiB");
    });

    it("does not call uploadFiles when a size rejection occurs", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const rejection = {
        file: makeFileWithSize("big.bin", LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      act(() => {
        capturedOnDrop([], [rejection]);
      });

      expect(mockUploadFiles).not.toHaveBeenCalled();
    });

    it("still uploads accepted files that are within the limit", async () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const validFile = makeFileWithSize("ok.bin", LIMIT - 1);
      await act(async () => {
        capturedOnDrop([validFile], []);
      });

      expect(mockUploadFiles).toHaveBeenCalledWith([validFile]);
    });
  });
});
