import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installMockWordDocument,
  uninstallMockWordDocument,
} from "../../../test/mocks/word/document";
import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import { applyWordEdits } from "../wordApplyEdits";
import {
  consumeProgrammaticSelectionEvent,
  markProgrammaticWordSelection,
  resetProgrammaticWordSelectionForTests,
} from "../wordProgrammaticSelection";
import {
  capturedWordAnchor,
  originalWordAnchor,
  readWordParagraphEntries,
  readWordTrackingMode,
  showWordParagraphs,
  showWordReviewLocation,
  WORD_SELECTION_TEXT_OPTIONS,
} from "../wordReviewLocation";

import type { MockWordHost } from "../../../test/mocks/word/document";
import type * as wordProgrammaticSelectionModule from "../wordProgrammaticSelection";
import type { WordDocumentCapture } from "@erato/frontend/word-review";

vi.mock("../wordProgrammaticSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof wordProgrammaticSelectionModule>();
  return {
    ...actual,
    markProgrammaticWordSelection: vi.fn(actual.markProgrammaticWordSelection),
  };
});

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

describe("Word navigation without paragraph IDs", () => {
  let host: MockWordHost;
  const noIds: WordDocumentCapture = {
    ...capture,
    ordinalMap: new Map(
      [...capture.ordinalMap].map(([ordinal, p]) => [
        ordinal,
        { ...p, uniqueLocalId: null },
      ]),
    ),
  };
  beforeEach(() => {
    host = installMockWordDocument([
      { text: "Same" },
      { text: "Same" },
      { text: "End" },
    ]);
    host.word.hideParagraphIds(true);
  });
  afterEach(uninstallMockWordDocument);

  it("tells repeated paragraphs apart by their neighbours", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 2, text: "Revised" },
      noIds,
    )!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    expect(host.word.selections()).toEqual([["id-2"]]);
    host.word.setParagraphs([
      { text: "Same" },
      { text: "Same" },
      { text: "End" },
      { text: "Same" },
      { text: "Same" },
      { text: "End" },
    ]);
    host.word.hideParagraphIds(true);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
    expect(host.word.writes()).toEqual([]);
  });

  it("locates a written result by its new text", async () => {
    const result = await applyWordEdits({
      edits: [{ paragraph: 3, text: "Finish" }],
      capture: noIds,
    });
    const anchor = result.resultAnchors!.get(0)!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    expect(host.word.selections()).toEqual([["id-3"]]);
  });

  it("anchors only ordinals the capture holds", () => {
    expect(capturedWordAnchor(noIds, 1, 3)?.span.paragraphs).toHaveLength(3);
    expect(capturedWordAnchor(noIds, 0)).toBeNull();
    expect(capturedWordAnchor(noIds, 2, 4)).toBeNull();
  });
});

describe("Word navigation where getText keeps the paragraph mark", () => {
  afterEach(uninstallMockWordDocument);

  it.each([true, false])(
    "anchors a written result on desktop hosts (IDs: %s)",
    async (ids) => {
      const host = installMockWordDocument([
        { text: "Same" },
        { text: "Same" },
        { text: "End" },
      ]);
      host.word.showParagraphMarks(true);
      host.word.hideParagraphIds(!ids);
      const marked: WordDocumentCapture = {
        ...capture,
        ordinalMap: new Map(
          [...capture.ordinalMap].map(([ordinal, p]) => [
            ordinal,
            {
              uniqueLocalId: ids ? p.uniqueLocalId : null,
              text: `${p.text}\r`,
            },
          ]),
        ),
      };
      const result = await applyWordEdits({
        edits: [{ paragraph: 3, text: "Finish" }],
        capture: marked,
      });
      expect(result.outcomes[0].status).toBe("applied");
      const anchor = result.resultAnchors!.get(0)!;
      expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
      expect(host.word.selections()).toEqual([["id-3"]]);
    },
  );
});

describe("Word navigation marks its own selection", () => {
  let host: MockWordHost;
  let selectionsAtMark: number[];
  const marked = vi.mocked(markProgrammaticWordSelection);
  beforeEach(async () => {
    host = installMockWordDocument([
      { text: "Same" },
      { text: "Same" },
      { text: "End" },
    ]);
    selectionsAtMark = [];
    const actual = await vi.importActual<
      typeof wordProgrammaticSelectionModule
    >("../wordProgrammaticSelection");
    marked.mockClear().mockImplementation(() => {
      selectionsAtMark.push(host.word.selections().length);
      return actual.markProgrammaticWordSelection();
    });
  });
  afterEach(uninstallMockWordDocument);

  it("marks before selecting a review location", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 2, text: "Revised" },
      capture,
    )!;
    expect(await showWordReviewLocation(anchor, identity)).toBe("selected");
    expect(selectionsAtMark).toEqual([0]);
    expect(host.word.selections()).toHaveLength(1);
  });

  it("marks before selecting written paragraphs", async () => {
    expect(await showWordParagraphs(["id-2", "id-3"], identity, identity)).toBe(
      "selected",
    );
    expect(selectionsAtMark).toEqual([0]);
    expect(host.word.selections()).toEqual([["id-2", "id-3"]]);
  });

  it("leaves no mark when nothing is selected", async () => {
    const anchor = originalWordAnchor(
      { paragraph: 2, text: "Revised" },
      capture,
    )!;
    host.word.setParagraphs([{ text: "Same" }, { text: "Changed" }]);
    expect(await showWordReviewLocation(anchor, identity)).toBe("changed");
    expect(await showWordParagraphs(["id-3", "id-1"], identity, identity)).toBe(
      "changed",
    );
    expect(markProgrammaticWordSelection).not.toHaveBeenCalled();
  });
});

describe("Word navigation marks its own selection on a selection host", () => {
  const TRACKED = {
    body: [
      { runs: "AA1 First paragraph.", id: "id-1" },
      {
        runs: [
          "TR1 Tracked ",
          { text: "inserted ", inserted: "Other Author" },
          "end.",
        ],
        id: "id-2",
      },
    ],
  };
  const marked = vi.mocked(markProgrammaticWordSelection);
  beforeEach(() => {
    resetProgrammaticWordSelectionForTests();
    marked.mockClear();
  });
  afterEach(uninstallWordSelectionHost);

  it("marks before selecting a tracked change, and the event it causes is claimed", async () => {
    vi.useFakeTimers();
    try {
      const host = installWordSelectionHost(TRACKED);
      const events: boolean[] = [];
      host.addHandlerAsync("documentSelectionChanged", () =>
        events.push(consumeProgrammaticSelectionEvent()),
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(await showWordParagraphs(["id-2"], identity, identity, true)).toBe(
        "selected",
      );
      expect(marked).toHaveBeenCalledTimes(1);
      expect(host.selectionText()).toBe("inserted ");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(events).toEqual([true]);
      host.select({ p: "AA1" });
      expect(events).toEqual([true, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no mark when the location is already selected, since Word raises no event", async () => {
    installWordSelectionHost(TRACKED);
    expect(await showWordParagraphs(["id-1"], identity, identity)).toBe(
      "selected",
    );
    expect(marked).toHaveBeenCalledTimes(1);
    resetProgrammaticWordSelectionForTests();
    expect(await showWordParagraphs(["id-1"], identity, identity)).toBe(
      "selected",
    );
    expect(marked).toHaveBeenCalledTimes(1);
    expect(consumeProgrammaticSelectionEvent()).toBe(false);
  });

  it("drops the mark when the select sync fails", async () => {
    const host = installWordSelectionHost(TRACKED);
    host.beforeSync((index) => {
      if (index === 3) throw new Error("GeneralException");
    });
    expect(await showWordParagraphs(["id-1"], identity, identity)).toBe(
      "unavailable",
    );
    expect(marked).toHaveBeenCalledTimes(1);
    expect(consumeProgrammaticSelectionEvent()).toBe(false);
  });
});

describe("readWordParagraphEntries", () => {
  function contextWith(getText: ReturnType<typeof vi.fn>) {
    return {
      document: {
        body: {
          paragraphs: {
            load: vi.fn(),
            items: [{ uniqueLocalId: "id-1", getText }],
          },
        },
      },
      sync: vi.fn(() => Promise.resolve()),
    } as unknown as Word.RequestContext;
  }

  it("forwards getText options when they are given", async () => {
    const getText = vi.fn(() => ({ value: "Visible" }));
    const { entries } = await readWordParagraphEntries(
      contextWith(getText),
      WORD_SELECTION_TEXT_OPTIONS,
    );
    expect(getText.mock.calls).toEqual([[WORD_SELECTION_TEXT_OPTIONS]]);
    expect(entries).toEqual([{ id: "id-1", text: "Visible" }]);
  });

  it("keeps the v1 call without options", async () => {
    const getText = vi.fn(() => ({ value: "Visible" }));
    await readWordParagraphEntries(contextWith(getText));
    expect(getText.mock.calls).toEqual([[]]);
  });
});
