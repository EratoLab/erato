import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCloudSelection } from "./useCloudSelection";

import type { CloudItem } from "@/lib/api/cloudProviders/types";

const file: CloudItem = {
  id: "same-id",
  drive_id: "finance",
  name: "Budget.pdf",
  is_folder: false,
  provider: "sharepoint",
};
const other = { ...file, drive_id: "sales" };

describe("cloud selection", () => {
  it("selects and removes identical item IDs in different drives independently", () => {
    const { result } = renderHook(() =>
      useCloudSelection({ multiple: true, maxFiles: 2 }),
    );
    act(() => result.current.toggleFile(file));
    expect(result.current.isSelected(other)).toBe(false);
    act(() => result.current.toggleFile(other));
    expect(result.current.selectedFiles).toHaveLength(2);
    expect(result.current.canSelect({ ...file, id: "third" })).toBe(false);
    expect(result.current.canSelect(file)).toBe(true);
    act(() => result.current.removeFile(result.current.selectedFiles[0]));
    expect(result.current.isSelected(file)).toBe(false);
    expect(result.current.isSelected(other)).toBe(true);
  });

  it("rejects unsupported types and folders, and replaces single selections", () => {
    const { result } = renderHook(() =>
      useCloudSelection({ acceptedFileTypes: ["pdf"] }),
    );
    act(() => result.current.toggleFile({ ...file, name: "Budget.exe" }));
    act(() => result.current.toggleFile({ ...file, is_folder: true }));
    expect(result.current.selectedFiles).toHaveLength(0);
    act(() => result.current.toggleFile(file));
    act(() => result.current.toggleFile(other));
    expect(result.current.selectedFiles).toHaveLength(1);
    expect(result.current.isSelected(other)).toBe(true);
    act(() => result.current.clearSelection());
    expect(result.current.selectedFiles).toHaveLength(0);
  });
});
