import { renderHook, act, cleanup } from "@testing-library/react";
import { useDropzone } from "react-dropzone";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeFileWithSize } from "@/test/fileFixtures";
import { FileTypeUtil } from "@/utils/fileTypes";

import { UploadTooLargeError } from "../errors";
import { useConversationDropzone } from "../useConversationDropzone";
import { useFileUploadStore } from "../useFileUploadStore";

import type { UploadError } from "../errors";
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

function makeUploadedItem(filename: string): FileUploadItem {
  return {
    id: "id-" + filename,
    filename,
    download_url: "http://example.com/" + filename,
    file_contents_unavailable_missing_permissions: false,
    is_sharepoint_file: false,
    file_capability: FileTypeUtil.createMockFileCapability(filename),
  };
}

describe("useConversationDropzone", () => {
  let mockUploadFiles: ReturnType<
    typeof vi.fn<(files: File[]) => Promise<FileUploadItem[] | undefined>>
  >;
  let mockOnUploaded: ReturnType<
    typeof vi.fn<(items: FileUploadItem[]) => void>
  >;
  let mockOnError: ReturnType<typeof vi.fn<(error: UploadError) => void>>;

  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The hook's default error sink is the shared store; without this an
    // error set by one case leaks into the next.
    useFileUploadStore.getState().reset();
    mockUploadFiles = vi.fn(() =>
      Promise.resolve([makeUploadedItem("test.bin")]),
    );
    mockOnUploaded = vi.fn();
    mockOnError = vi.fn();
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

    it("falls back to the shared upload store when no onError is given", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
        }),
      );

      const rejection = {
        file: makeFileWithSize("big.bin", LIMIT + 1),
        errors: [{ code: "file-too-large", message: "File is too large" }],
      };
      act(() => {
        capturedOnDrop([], [rejection]);
      });

      // The default sink is the store the composer's alert renders, so the
      // rejection has to land there rather than nowhere.
      expect(mockUploadFiles).not.toHaveBeenCalled();
      const storeError = useFileUploadStore.getState().error;
      expect(storeError).toBeInstanceOf(UploadTooLargeError);
      expect(storeError?.message).toContain("big.bin");
    });
  });

  describe("with maxSize and onError", () => {
    it("rejects an oversized file through the validator", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const validator = vi
        .mocked(useDropzone)
        .mock.calls.at(-1)?.[0]?.validator;

      expect(validator?.(makeFileWithSize("ok.bin", LIMIT))).toBeNull();
      expect(validator?.(makeFileWithSize("big.bin", LIMIT + 1))).toMatchObject(
        {
          code: "file-too-large",
        },
      );
    });

    it("accepts an item whose size is unknown", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const validator = vi
        .mocked(useDropzone)
        .mock.calls.at(-1)?.[0]?.validator;

      // react-dropzone runs this validator on dragenter against
      // DataTransferItems, which carry no size. Rejecting those would make
      // `isDragAccept` false and hide the conversation drop overlay.
      const dragItem = { name: "dragged", type: "application/pdf" } as File;

      expect(validator?.(dragItem)).toBeNull();
    });

    it("spares a file the isSizeExempt predicate accepts", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
          isSizeExempt: (file) => file.name.endsWith(".eml"),
        }),
      );

      const validator = vi
        .mocked(useDropzone)
        .mock.calls.at(-1)?.[0]?.validator;

      expect(validator?.(makeFileWithSize("thread.eml", LIMIT + 1))).toBeNull();
      expect(validator?.(makeFileWithSize("big.bin", LIMIT + 1))).toMatchObject(
        {
          code: "file-too-large",
        },
      );
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

    it("withholds accepted siblings when one file is oversized", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      act(() => {
        capturedOnDrop(
          [makeFileWithSize("small.pdf", 100)],
          [
            {
              file: makeFileWithSize("big.pdf", LIMIT + 1),
              errors: [{ code: "file-too-large", message: "too large" }],
            },
          ],
        );
      });

      // Uploads are atomic: the small file is not sent behind the error.
      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockUploadFiles).not.toHaveBeenCalled();
    });

    it("still hands size-exempt siblings on when one file is oversized", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
          isSizeExempt: (file) => file.name.endsWith(".eml"),
        }),
      );

      const thread = makeFileWithSize("thread.eml", LIMIT + 1);
      act(() => {
        capturedOnDrop(
          [makeFileWithSize("small.pdf", 100), thread],
          [
            {
              file: makeFileWithSize("big.pdf", LIMIT + 1),
              errors: [{ code: "file-too-large", message: "too large" }],
            },
          ],
        );
      });

      // The email is staged, not transmitted, so it is not part of the
      // atomic batch — dropping it would lose something the user can still
      // trim to fit. The PDF beside it is withheld like any other sibling.
      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockUploadFiles).toHaveBeenCalledWith([thread]);
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
