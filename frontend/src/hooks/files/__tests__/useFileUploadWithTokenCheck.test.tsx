import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { useFileUploadWithTokenCheck } from "../useFileUploadWithTokenCheck";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

// Mock the underlying dropzone so we can control `isUploading` and the
// `baseUploadFiles` identity directly. The dropzone has many provider deps
// that aren't relevant to the token-check wrapper's identity contract.
const dropzoneState = {
  uploadFiles: vi.fn<(files: File[]) => Promise<FileUploadItem[] | undefined>>(
    () => Promise.resolve([]),
  ),
  uploadedFiles: [] as FileUploadItem[],
  isUploading: false,
  error: null as Error | string | null,
  clearFiles: vi.fn(),
};

vi.mock("../useFileDropzone", () => ({
  useFileDropzone: () => dropzoneState,
}));

describe("useFileUploadWithTokenCheck", () => {
  beforeEach(() => {
    dropzoneState.uploadFiles = vi.fn(() => Promise.resolve([]));
    dropzoneState.isUploading = false;
  });

  // Regression: the returned `uploadFiles` must keep a stable identity across
  // renders so consumers can list it in effect dep arrays without triggering
  // an upload→state-flip→re-fire loop.
  it("returns a stable uploadFiles identity when isUploading flips", () => {
    const { result, rerender } = renderHook(() =>
      useFileUploadWithTokenCheck({ message: "" }),
    );
    const initialUploadFiles = result.current.uploadFiles;

    dropzoneState.isUploading = true;
    rerender();
    expect(result.current.uploadFiles).toBe(initialUploadFiles);

    dropzoneState.isUploading = false;
    rerender();
    expect(result.current.uploadFiles).toBe(initialUploadFiles);
  });

  it("returns a stable uploadFiles identity when baseUploadFiles changes", () => {
    const { result, rerender } = renderHook(() =>
      useFileUploadWithTokenCheck({ message: "" }),
    );
    const initialUploadFiles = result.current.uploadFiles;

    dropzoneState.uploadFiles = vi.fn(() => Promise.resolve([]));
    rerender();

    expect(result.current.uploadFiles).toBe(initialUploadFiles);
  });

  it("invokes the latest baseUploadFiles when called, not the one captured at mount", async () => {
    const firstBase = vi.fn(() => Promise.resolve([] as FileUploadItem[]));
    const secondBase = vi.fn(() =>
      Promise.resolve([{ id: "f-2" } as FileUploadItem]),
    );
    dropzoneState.uploadFiles = firstBase;

    const { result, rerender } = renderHook(() =>
      useFileUploadWithTokenCheck({ message: "" }),
    );

    dropzoneState.uploadFiles = secondBase;
    rerender();

    const file = new File(["x"], "x.txt");
    const out = await result.current.uploadFiles([file]);

    expect(firstBase).not.toHaveBeenCalled();
    expect(secondBase).toHaveBeenCalledWith([file]);
    expect(out).toEqual([{ id: "f-2" }]);
  });

  it("short-circuits when disabled or already uploading", async () => {
    const base = vi.fn(() => Promise.resolve([] as FileUploadItem[]));
    dropzoneState.uploadFiles = base;

    const { result, rerender } = renderHook(
      ({ disabled }: { disabled: boolean }) =>
        useFileUploadWithTokenCheck({ message: "", disabled }),
      { initialProps: { disabled: true } },
    );

    expect(await result.current.uploadFiles([new File(["x"], "x.txt")])).toBe(
      undefined,
    );
    expect(base).not.toHaveBeenCalled();

    rerender({ disabled: false });
    dropzoneState.isUploading = true;
    rerender({ disabled: false });

    expect(await result.current.uploadFiles([new File(["x"], "x.txt")])).toBe(
      undefined,
    );
    expect(base).not.toHaveBeenCalled();
  });
});
