import { renderHook, act, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { fetchUploadFile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { UploadTooLargeError } from "../errors";
import { useStandaloneFileUpload } from "../useStandaloneFileUpload";

const MiB = 1024 * 1024;
const CUSTOM_LIMIT = 15 * MiB;

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchUploadFile: vi.fn(),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUploadFeature: vi.fn(() => ({
    enabled: true,
    maxSizeBytes: CUSTOM_LIMIT,
    maxSizeFormatted: "15 MiB",
  })),
}));

function makeFileWithSize(name: string, size: number): File {
  const blob = new Blob([new Uint8Array(size)]);
  return new File([blob], name, { type: "application/octet-stream" });
}

describe("useStandaloneFileUpload", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchUploadFile).mockResolvedValue({
      files: [
        {
          id: "file1",
          filename: "test.bin",
          download_url: "http://example.com/test.bin",
          file_contents_unavailable_missing_permissions: false,
          is_sharepoint_file: false,
          file_capability: { id: "other", operations: [] },
        },
      ],
    });
  });

  describe("file size preflight", () => {
    it("does not call fetchUploadFile when a file is oversized", async () => {
      const { result } = renderHook(() => useStandaloneFileUpload());
      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(vi.mocked(fetchUploadFile)).not.toHaveBeenCalled();
    });

    it("sets an UploadTooLargeError with the configured formatted limit", async () => {
      const { result } = renderHook(() => useStandaloneFileUpload());
      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
      // Must contain the runtime-formatted limit, never a hard-coded '—'
      expect(result.current.error?.message).toContain("15 MiB");
      expect(result.current.error?.message).not.toContain("—");
    });

    it("accepts a file exactly at the limit", async () => {
      const { result } = renderHook(() => useStandaloneFileUpload());
      const exactFile = makeFileWithSize("exact.bin", CUSTOM_LIMIT);

      await act(async () => {
        await result.current.uploadFiles([exactFile]);
      });

      expect(vi.mocked(fetchUploadFile)).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    });

    it("rejects the entire batch when one file is oversized", async () => {
      const { result } = renderHook(() => useStandaloneFileUpload());
      const files = [
        makeFileWithSize("ok.bin", CUSTOM_LIMIT),
        makeFileWithSize("toobig.bin", CUSTOM_LIMIT + 1),
      ];

      await act(async () => {
        await result.current.uploadFiles(files);
      });

      expect(vi.mocked(fetchUploadFile)).not.toHaveBeenCalled();
      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
    });

    it("does not set isUploading to true on a preflight rejection", async () => {
      const { result } = renderHook(() => useStandaloneFileUpload());
      const oversizedFile = makeFileWithSize("big.bin", CUSTOM_LIMIT + 1);

      await act(async () => {
        await result.current.uploadFiles([oversizedFile]);
      });

      expect(result.current.isUploading).toBe(false);
    });
  });

  describe("HTTP 413 fallback", () => {
    it("includes the configured formatted limit in the error, not '—'", async () => {
      vi.mocked(fetchUploadFile).mockRejectedValue({ status: 413 });

      const { result } = renderHook(() => useStandaloneFileUpload());
      const smallFile = makeFileWithSize("small.bin", 100);

      await act(async () => {
        await result.current.uploadFiles([smallFile]);
      });

      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
      expect(result.current.error?.message).toContain("15 MiB");
      expect(result.current.error?.message).not.toContain("—");
    });

    it("recognises string '413' status as too-large", async () => {
      vi.mocked(fetchUploadFile).mockRejectedValue({ status: "413" });

      const { result } = renderHook(() => useStandaloneFileUpload());
      const smallFile = makeFileWithSize("small.bin", 100);

      await act(async () => {
        await result.current.uploadFiles([smallFile]);
      });

      expect(result.current.error).toBeInstanceOf(UploadTooLargeError);
    });
  });
});
