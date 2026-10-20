import { describe, expect, it } from "vitest";

import {
  claimedFileIdsOf,
  includedEstimatesOf,
  includedUploadsOf,
  unclaimedFiles,
} from "../composerLaneFiles";

import type { ComposerContextItem, ComposerContextState } from "../types";

const estimate = (name: string) => new File(["x"], name);

const item = (
  id: string,
  state: ComposerContextState,
  extra: Partial<ComposerContextItem> = {},
): ComposerContextItem =>
  ({
    id,
    kind: "test",
    state,
    label: id,
    icon: "file",
    origin: "user",
    ...extra,
  }) as ComposerContextItem;

describe("composerLaneFiles", () => {
  it("claims files only for items that say they send them", () => {
    const claimed = claimedFileIdsOf([
      item("a", "included", { claimsFileIds: ["1", "2"] }),
      item("b", "loading", { claimsFileIds: ["3"] }),
      item("c", "suggested", { claimsFileIds: ["4"] }),
      item("d", "error", { claimsFileIds: ["5"] }),
    ]);
    expect([...claimed].sort()).toEqual(["1", "2", "3"]);
    expect(claimedFileIdsOf(undefined).size).toBe(0);
  });

  it("keeps the same list when nothing is claimed", () => {
    const files = [{ id: "1" }, { id: "2" }];
    expect(unclaimedFiles(files, new Set())).toBe(files);
    expect(unclaimedFiles(files, new Set(["1"]))).toEqual([{ id: "2" }]);
  });

  it("counts estimates of included items only, uploads apart", () => {
    const thread = estimate("thread.eml");
    const facet = estimate("word_selection.txt");
    const items = [
      item("thread", "included", { estimate: thread, estimateUpload: true }),
      item("facet", "included", { estimate: facet }),
      item("off", "suggested", {
        estimate: estimate("off.txt"),
        estimateUpload: true,
      }),
    ];
    expect(includedEstimatesOf(items)).toEqual([thread, facet]);
    expect(includedUploadsOf(items)).toEqual([thread]);
  });
});
