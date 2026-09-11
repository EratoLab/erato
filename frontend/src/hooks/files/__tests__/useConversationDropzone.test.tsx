import { renderHook, act, cleanup } from "@testing-library/react";
import { useDropzone } from "react-dropzone";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeFileWithSize } from "@/test/fileFixtures";
import { FileTypeUtil } from "@/utils/fileTypes";

import { UnsupportedFileTypeError, UploadTooLargeError } from "../errors";
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
let capturedOnError: (error: Error) => void = () => {};

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn((opts) => {
    capturedOnDrop = opts.onDrop ?? (() => {});
    capturedOnError = opts.onError ?? (() => {});
    return {
      // Echoes its argument so tests can reach the handlers the hook composes.
      getRootProps: vi.fn((props?: Record<string, unknown>) => props ?? {}),
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

    it("reports a wrong-type rejection and still uploads its accepted siblings", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          onError: mockOnError,
        }),
      );

      const accepted = makeFileWithSize("fine.pdf", 100);
      act(() => {
        capturedOnDrop(
          [accepted],
          [
            {
              file: makeFileWithSize("wrong.exe", 100),
              errors: [{ code: "file-invalid-type", message: "type" }],
            },
          ],
        );
      });

      expect(mockOnError).toHaveBeenCalledTimes(1);
      const err = mockOnError.mock.calls[0][0];
      expect(err).toBeInstanceOf(UnsupportedFileTypeError);
      expect(err.message).toContain("wrong.exe");
      expect(mockUploadFiles).toHaveBeenCalledWith([accepted]);
    });

    it("keeps naming the wrong-type file after the sibling upload cleared the store", async () => {
      const uploadThatResets = vi.fn(async (files: File[]) => {
        // The upload hook clears the shared error slot before it starts.
        useFileUploadStore.getState().setError(null);
        return files.map((file) => makeUploadedItem(file.name));
      });
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: uploadThatResets,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
        }),
      );

      await act(async () => {
        capturedOnDrop(
          [makeFileWithSize("fine.pdf", 100)],
          [
            {
              file: makeFileWithSize("wrong.exe", 100),
              errors: [{ code: "file-invalid-type", message: "type" }],
            },
          ],
        );
      });

      expect(mockOnUploaded).toHaveBeenCalledTimes(1);
      const storeError = useFileUploadStore.getState().error;
      expect(storeError).toBeInstanceOf(UnsupportedFileTypeError);
      expect(storeError?.message).toContain("wrong.exe");
    });

    it("names a file that fails both checks only in the unsupported-type error", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          maxSize: LIMIT,
          maxSizeFormatted: "15 MiB",
          onError: mockOnError,
        }),
      );

      const accepted = makeFileWithSize("fine.pdf", 100);
      act(() => {
        capturedOnDrop(
          [accepted],
          [
            {
              file: makeFileWithSize("both.exe", LIMIT + 1),
              errors: [
                { code: "file-invalid-type", message: "type" },
                { code: "file-too-large", message: "too large" },
              ],
            },
          ],
        );
      });

      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockOnError.mock.calls[0][0]).toBeInstanceOf(
        UnsupportedFileTypeError,
      );
      // Type outranks size, so the batch is not withheld as oversized.
      expect(mockUploadFiles).toHaveBeenCalledWith([accepted]);
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

  describe("onReceive", () => {
    function dropEvent(init: {
      types: string[];
      files?: number;
      items?: { kind: string }[];
      stopped?: boolean;
    }) {
      return {
        isPropagationStopped: () => init.stopped ?? false,
        dataTransfer: {
          types: init.types,
          files: { length: init.files ?? 0 },
          items: init.items ?? [],
        },
      };
    }

    it("fires with the dropped file count from the raw drop event", () => {
      const onReceive = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["Files"], files: 3 }),
        );
      });

      expect(onReceive).toHaveBeenCalledWith(3);
      // react-dropzone's own drop handling has not run yet at this point.
      expect(mockUploadFiles).not.toHaveBeenCalled();
    });

    it("counts file items when the file list is empty", () => {
      const onReceive = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({
            types: ["Files"],
            items: [{ kind: "file" }, { kind: "string" }, { kind: "file" }],
          }),
        );
      });

      expect(onReceive).toHaveBeenCalledWith(2);
    });

    it("stays quiet for a drag that carries no files", () => {
      const onReceive = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["maillistrow"] }),
        );
      });

      expect(onReceive).not.toHaveBeenCalled();
    });

    it("stays quiet when the consumer's onDrop stopped the event", () => {
      const onReceive = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps({ onDrop: vi.fn() });
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["Files"], files: 1, stopped: true }),
        );
      });

      expect(onReceive).not.toHaveBeenCalled();
    });

    it("keeps the consumer's own onDrop and forwards the rest of its props", () => {
      const onReceive = vi.fn();
      const consumerOnDrop = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps({
        onDrop: consumerOnDrop,
        className: "chat-body",
      });
      const event = dropEvent({ types: ["Files"], files: 1 });
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(event);
      });

      expect(rootProps.className).toBe("chat-body");
      expect(consumerOnDrop).toHaveBeenCalledWith(event);
      expect(onReceive).toHaveBeenCalledWith(1);
    });

    it("calls the release onReceive returned once the drop reaches the handler", () => {
      const release = vi.fn();
      const onReceive = vi.fn(() => release);
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["Files"], files: 1 }),
        );
      });
      expect(release).not.toHaveBeenCalled();

      // A fully rejected drop still reaches the handler, so the early
      // signal is always closed.
      act(() => {
        capturedOnDrop(
          [],
          [
            {
              file: makeFileWithSize("odd.xyz", 1),
              errors: [{ code: "file-invalid-type", message: "type" }],
            },
          ],
        );
      });
      expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases the early signal when react-dropzone fails to read the files", () => {
      const release = vi.fn();
      const onReceive = vi.fn(() => release);
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["Files"], files: 1 }),
        );
      });
      expect(release).not.toHaveBeenCalled();

      // A file item that yields no File makes react-dropzone reject before
      // onDrop; only its onError sees the drop end.
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      act(() => {
        capturedOnError(new Error("[object DataTransferItem] is not a File"));
      });
      consoleError.mockRestore();
      expect(release).toHaveBeenCalledTimes(1);
      expect(mockUploadFiles).not.toHaveBeenCalled();
    });

    it("stays quiet for a file drag that carries no file entries", () => {
      const onReceive = vi.fn();
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          onReceive,
        }),
      );

      const rootProps = result.current.getRootProps();
      act(() => {
        (rootProps.onDrop as (event: unknown) => void)(
          dropEvent({ types: ["Files"], items: [{ kind: "string" }] }),
        );
      });

      expect(onReceive).not.toHaveBeenCalled();
    });

    it("hands react-dropzone's root props through untouched when unused", () => {
      const { result } = renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
        }),
      );

      const rootProps = result.current.getRootProps({ className: "x" });

      expect(rootProps).toEqual({ className: "x" });
    });
  });

  describe("accept map", () => {
    const extras = { "message/rfc822": [".eml"] };
    const lastAccept = () =>
      vi.mocked(useDropzone).mock.calls.at(-1)?.[0]?.accept;

    it("accepts everything while no file types are known, even with extras", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          acceptedFileTypes: [],
          extraAcceptMimeTypes: extras,
        }),
      );

      // Capabilities are still loading: an extras-only map would reject every
      // ordinary file and keep the drop overlay hidden.
      expect(lastAccept()).toBeUndefined();
    });

    it("accepts everything when file types are undefined", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          extraAcceptMimeTypes: extras,
        }),
      );

      expect(lastAccept()).toBeUndefined();
    });

    it("uses the capability types alone when there are no extras", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          acceptedFileTypes: ["pdf"],
        }),
      );

      expect(lastAccept()).toEqual(FileTypeUtil.getAcceptObject(["pdf"]));
    });

    it("merges extras into the capability types once both are present", () => {
      renderHook(() =>
        useConversationDropzone({
          uploadFiles: mockUploadFiles,
          onUploaded: mockOnUploaded,
          acceptedFileTypes: ["pdf"],
          extraAcceptMimeTypes: extras,
        }),
      );

      expect(lastAccept()).toEqual({
        ...FileTypeUtil.getAcceptObject(["pdf"]),
        ...extras,
      });
    });
  });
});
