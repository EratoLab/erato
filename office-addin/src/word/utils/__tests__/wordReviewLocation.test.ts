import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import { applyWordEdits } from "../wordApplyEdits";
import {
  originalWordAnchor,
  readWordTrackingMode,
  showWordReviewLocation,
} from "../wordReviewLocation";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type { WordDocumentCapture } from "../wordDocumentCapture";

const identity = "test-document";
const capture: WordDocumentCapture = {
  identity,
  ordinalMap: new Map([
    [1, { uniqueLocalId: "id-1", text: "Same" }],
    [2, { uniqueLocalId: "id-2", text: "Same" }],
    [3, { uniqueLocalId: "id-3", text: "End" }],
  ]),
  renderedOrdinals: new Set([1, 2, 3]),
  paragraphsSent: 3,
  partialOrdinal: null,
};
describe("verified Word navigation", () => {
  let host: MockWordHost;
  beforeEach(() => {
    host = installMockWordDocument([
      { text: "Same" },
      { text: "Same" },
      { text: "End" },
    ]);
  });
  afterEach(uninstallMockWordDocument);
  it("selects the exact ID among repeated paragraphs without writing", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 2, text: "Revised" },
      capture,
    )!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    expect(host.word.selections()).toEqual([["id-2"]]);
    expect(host.word.writes()).toEqual([]);
  });
  it("selects the full original range only when it is still contiguous", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 1, through: 2, text: "Merged" },
      capture,
    )!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    expect(host.word.selections()).toEqual([["id-1", "id-2"]]);
    host.word.setParagraphs([
      { text: "Same", uniqueLocalId: "id-1" },
      { text: "New", uniqueLocalId: "new" },
      { text: "Same", uniqueLocalId: "id-2" },
    ]);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
    expect(
      (
        await applyWordEdits({
          edits: [{ paragraph: 1, through: 2, text: "Merged" }],
          capture,
        })
      ).outcomes[0].status,
    ).toBe("changed");
    expect(host.word.writes()).toEqual([]);
  });
  it("rejects wrong documents, stale text, deleted targets, and incomplete capture", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 2, text: "Revised" },
      capture,
    )!;
    expect(await showWordReviewLocation(anchor, "other")).toBe(
      "identity-mismatch",
    );
    host.word.setParagraphs([{ text: "Same" }, { text: "Changed" }]);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
    host.word.setParagraphs([{ text: "Same" }]);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
    expect(
      originalWordAnchor(
        { paragraph: 2, text: "Revised" },
        { ...capture, partialOrdinal: 2 },
      ),
    ).toBeNull();
    expect(host.word.selections()).toEqual([]);
  });
  it("records and reverifies an exact single-paragraph result", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 2, text: "Revised" }],
      capture,
    });
    const anchor = result.resultAnchors!.get(0)!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    host.word.setParagraphs([{ text: "Same" }, { text: "Changed again" }]);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
  });
  it("locates a verified cleared paragraph, and disables unproven range/newline results", async () => {
    const cleared = await applyWordEdits({
      edits: [{ paragraph: 2, text: "" }],
      capture,
    });
    expect(
      await showWordReviewLocation(cleared.resultAnchors!.get(0)!, identity),
    ).toBe("cleared");
    const expanded = await applyWordEdits({
      edits: [{ paragraph: 1, text: "One\nTwo" }],
      capture,
    });
    expect(expanded.resultAnchors!.size).toBe(0);
  });
  it.each(["Off", "TrackAll", "TrackMineOnly"] as const)(
    "reads %s without toggling tracking or writing",
    async (mode) => {
      host.word.setTrackingMode(mode);
      expect(await readWordTrackingMode()).toBe(mode === "Off" ? "off" : "on");
      expect(host.word.writes()).toEqual([]);
    },
  );
});
