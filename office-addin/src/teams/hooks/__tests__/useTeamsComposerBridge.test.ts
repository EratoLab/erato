import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTeamsComposerBridge } from "../useTeamsComposerBridge";

import type { TeamsTranscriptRecord } from "../../utils/teamsComposerTranscripts";
import type { FileUploadItem } from "@erato/frontend/library";

interface StoreDouble {
  isUploading: boolean;
  error: unknown;
  setError: (error: unknown) => void;
}

const store = vi.hoisted(() => {
  const double: StoreDouble = {
    isUploading: false,
    error: null,
    setError: (error) => {
      double.error = error;
    },
  };
  return double;
});

vi.mock("@erato/frontend/library", () => ({
  useFileUploadStore: { getState: () => store },
  validateFileSizes: (files: File[], max: number) => {
    const oversizedFiles = files.filter((file) => file.size > max);
    return oversizedFiles.length === 0
      ? { valid: true }
      : { valid: false, oversizedFiles };
  },
  UploadTooLargeError: class UploadTooLargeError extends Error {
    constructor(
      readonly limit: string,
      readonly names: string[],
    ) {
      super(`too large: ${names.join(", ")}`);
    }
  },
}));

const file = (name: string, size = 10) =>
  new File(["x".repeat(size)], name, { type: "text/plain" });
const upload = (id: string, filename: string) =>
  ({ id, filename }) as FileUploadItem;

const transcript = file("teams-chats-3.md");
const assets = Array.from({ length: 6 }, (_, index) =>
  file(`teams-file-0000000${index}-a${index}.pdf`),
);

const record = (
  transcriptUploadId: string,
  assetUploadIds: string[],
): TeamsTranscriptRecord => ({
  lineage: "lineage-1",
  transcriptUploadId,
  assetUploadIds,
  assetNames: [],
  excludedAssetNames: [],
  file: transcript,
  selections: [],
  messageLimit: 200,
});

function setup(
  uploadFiles?: (files: File[]) => Promise<FileUploadItem[] | undefined>,
  initial: FileUploadItem[] = [],
) {
  const calls: string[] = [];
  const controls = {
    addUploadedFiles: vi.fn((files: FileUploadItem[]) =>
      calls.push(`add:${files.map((entry) => entry.id).join(",")}`),
    ),
    removeUploadedFiles: vi.fn((ids: string[]) =>
      calls.push(`remove:${ids.join(",")}`),
    ),
    focusInput: vi.fn(),
  };
  const announce = vi.fn();
  const hook = renderHook(() => {
    const [staged, setStaged] = useState<FileUploadItem[]>(initial);
    const stagedRef = useRef<readonly FileUploadItem[]>(staged);
    stagedRef.current = staged;
    const bridge = useTeamsComposerBridge({
      uploadFiles,
      controls,
      stagedRef,
      setStaged,
      announce,
      maxSizeBytes: 1000,
      maxSizeFormatted: "1 KB",
    });
    return { bridge, staged };
  });
  return { hook, controls, calls, announce };
}

beforeEach(() => {
  store.isUploading = false;
  store.error = null;
});
afterEach(() => vi.restoreAllMocks());

describe("useTeamsComposerBridge", () => {
  it("uploads without staging and keeps the assets the composer took", async () => {
    // The composer uploads at most `maxFiles` (5): the transcript and four.
    const uploadFiles = vi.fn(async (files: File[]) =>
      files.slice(0, 5).map((entry, index) => upload(`u${index}`, entry.name)),
    );
    const { hook, controls } = setup(uploadFiles);

    let uploaded: FileUploadItem[] | null = null;
    await act(async () => {
      uploaded = await hook.result.current.bridge.upload([
        transcript,
        ...assets,
      ]);
    });

    expect(uploadFiles).toHaveBeenCalledWith([transcript, ...assets]);
    expect(uploaded).toHaveLength(5);
    expect(controls.addUploadedFiles).not.toHaveBeenCalled();
    expect(hook.result.current.staged).toEqual([]);
  });

  it("refuses an oversized file with the composer's own error", async () => {
    const uploadFiles = vi.fn();
    const { hook } = setup(uploadFiles);
    const big = file("teams-file-00000000-big.pdf", 2000);

    await expect(
      hook.result.current.bridge.upload([transcript, big]),
    ).resolves.toBeNull();
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(store.error).toMatchObject({
      limit: "1 KB",
      names: ["teams-file-00000000-big.pdf"],
    });
  });

  it("returns null while uploading, on a throw, on nothing back or without the transcript", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    store.isUploading = true;
    const uploadFiles = vi.fn(async () => [upload("t", transcript.name)]);
    const busy = setup(uploadFiles).hook.result.current.bridge;
    await expect(busy.upload([transcript])).resolves.toBeNull();
    expect(uploadFiles).not.toHaveBeenCalled();
    store.isUploading = false;

    const throwing = setup(async () => {
      throw new Error("500");
    }).hook.result.current.bridge;
    await expect(throwing.upload([transcript])).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();

    const empty = setup(async () => undefined).hook.result.current.bridge;
    await expect(empty.upload([transcript])).resolves.toBeNull();

    const noTranscript = setup(async () => [upload("a0", assets[0].name)]).hook
      .result.current.bridge;
    await expect(
      noTranscript.upload([transcript, assets[0]]),
    ).resolves.toBeNull();

    const withoutPath = setup(undefined).hook.result.current.bridge;
    await expect(withoutPath.upload([transcript])).resolves.toBeNull();
  });

  it("stages in the composer and in the mirror in one go", () => {
    const { hook, controls } = setup(undefined, [upload("u", "holiday.pdf")]);
    const added = [upload("t", transcript.name), upload("a", assets[0].name)];

    act(() => hook.result.current.bridge.add(added));

    expect(controls.addUploadedFiles).toHaveBeenCalledWith(added);
    expect(hook.result.current.staged.map((entry) => entry.id)).toEqual([
      "u",
      "t",
      "a",
    ]);
  });

  it("replaces by removing what the old record still has staged before adding", () => {
    const { hook, calls } = setup(undefined, [
      upload("t1", transcript.name),
      upload("a1", assets[0].name),
      upload("u", "holiday.pdf"),
    ]);
    const previous = record("t1", ["a1", "gone"]);
    const next = [upload("t2", transcript.name), upload("a2", assets[1].name)];

    expect(hook.result.current.bridge.claimedIds(previous)).toEqual([
      "t1",
      "a1",
    ]);
    act(() => hook.result.current.bridge.replace(previous, next));

    expect(calls).toEqual(["remove:t1,a1", "add:t2,a2"]);
    expect(hook.result.current.staged.map((entry) => entry.id)).toEqual([
      "u",
      "t2",
      "a2",
    ]);
  });

  it("removes by id and focuses the composer on request", () => {
    const { hook, controls } = setup(undefined, [
      upload("t1", transcript.name),
      upload("a1", assets[0].name),
    ]);

    act(() => hook.result.current.bridge.remove(["a1"]));
    expect(controls.removeUploadedFiles).toHaveBeenCalledWith(["a1"]);
    expect(hook.result.current.staged.map((entry) => entry.id)).toEqual(["t1"]);

    act(() => hook.result.current.bridge.remove([]));
    expect(controls.removeUploadedFiles).toHaveBeenCalledTimes(1);

    hook.result.current.bridge.focusComposer();
    expect(controls.focusInput).toHaveBeenCalled();
  });
});
