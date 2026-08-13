/**
 * Regression tests for useChatFileSources — specifically the onSelectFiles
 * (handleSelectedFiles) path that accepts already-resolved File objects.
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeFileWithSize } from "@/test/fileFixtures";

import { UploadTooLargeError } from "../errors";
import { useChatFileSources } from "../useChatFileSources";
import { useFileUploadStore } from "../useFileUploadStore";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const MiB = 1024 * 1024;
const CUSTOM_LIMIT = 15 * MiB;

// ─── mock dependencies ───────────────────────────────────────────────────────

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: vi.fn(() => ({
    enabled: true,
    maxSizeBytes: CUSTOM_LIMIT,
    maxSizeFormatted: "15 MiB",
  })),
  useCloudProvidersFeature: vi.fn(() => ({ availableProviders: [] })),
}));

const mockUploadFiles =
  vi.fn<(files: File[]) => Promise<FileUploadItem[] | undefined>>();
vi.mock("@/hooks/files/useFileUploadWithTokenCheck", () => ({
  useFileUploadWithTokenCheck: vi.fn(() => ({
    uploadFiles: mockUploadFiles,
    isUploading: false,
    isEstimating: false,
    uploadError: null,
    exceedsTokenLimit: false,
    uploadedFiles: [],
    clearFiles: vi.fn(),
  })),
}));

vi.mock("react-dropzone", () => ({
  useDropzone: vi.fn(() => ({
    open: vi.fn(),
    getRootProps: vi.fn(() => ({})),
    getInputProps: vi.fn(() => ({})),
  })),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useCreateChat: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useLinkFile: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

// ─────────────────────────────────────────────────────────────────────────────

function renderUseChatFileSources(
  props: Partial<Parameters<typeof useChatFileSources>[0]> = {},
) {
  return renderHook(() =>
    useChatFileSources({
      message: "",
      chatId: "test-chat-id",
      ...props,
    }),
  );
}

describe("useChatFileSources — onSelectFiles preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useFileUploadStore.getState().reset();
    });
    mockUploadFiles.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not call the upload function when a file is oversized", async () => {
    const { result } = renderUseChatFileSources();
    const oversized = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

    await act(async () => {
      await result.current.onSelectFiles([oversized]);
    });

    expect(mockUploadFiles).not.toHaveBeenCalled();
  });

  it("sets UploadTooLargeError with the formatted limit on size rejection", async () => {
    const { result } = renderUseChatFileSources();
    const oversized = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

    await act(async () => {
      await result.current.onSelectFiles([oversized]);
    });

    const storeError = useFileUploadStore.getState().error;
    expect(storeError).toBeInstanceOf(UploadTooLargeError);
    expect(storeError?.message).toContain("15 MiB");
  });

  it("allows upload for a file exactly at the limit", async () => {
    const { result } = renderUseChatFileSources();
    const exact = makeFileWithSize("exact.bin", CUSTOM_LIMIT);

    await act(async () => {
      await result.current.onSelectFiles([exact]);
    });

    expect(mockUploadFiles).toHaveBeenCalledWith([exact]);
  });

  it("rejects the entire batch when one file is oversized", async () => {
    const { result } = renderUseChatFileSources();
    const files = [
      makeFileWithSize("ok.bin", CUSTOM_LIMIT),
      makeFileWithSize("toobig.bin", CUSTOM_LIMIT + 1),
    ];

    await act(async () => {
      await result.current.onSelectFiles(files);
    });

    expect(mockUploadFiles).not.toHaveBeenCalled();
    expect(useFileUploadStore.getState().error).toBeInstanceOf(
      UploadTooLargeError,
    );
  });
});
