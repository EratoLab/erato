import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useChatInputHandlers } from "../useChatInputHandlers";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

describe("useChatInputHandlers", () => {
  it("deduplicates uploaded files by id when the same upload is reported twice", () => {
    const onAttachmentsChanged = vi.fn();
    const uploadedFile = {
      id: "file-1",
      filename: "sample-report-compressed.pdf",
      download_url: "https://files.example.com/sample-report-compressed.pdf",
    } as FileUploadItem;

    const { result } = renderHook(() =>
      useChatInputHandlers(5, onAttachmentsChanged),
    );

    act(() => {
      result.current.handleFilesUploaded([uploadedFile]);
    });

    act(() => {
      result.current.handleFilesUploaded([uploadedFile]);
    });

    expect(result.current.attachedFiles).toEqual([uploadedFile]);
    expect(onAttachmentsChanged).toHaveBeenLastCalledWith([uploadedFile]);
  });
});
