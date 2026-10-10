import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  consumeProgrammaticSelectionEvent,
  resetProgrammaticWordSelectionForTests,
} from "../wordProgrammaticSelection";
import { replaceWordSelection } from "../wordReplaceSelection";
import { emptySelectionCapture } from "../wordSelectionAnchor";
import { captureWordSelection } from "../wordSelectionCapture";
import { currentWordSelectionSupport } from "../wordSelectionSupport";
import {
  checkTargetVerification,
  proveWordSelectionTarget,
  queueTargetVerification,
  showWordSelection,
  showWrittenWordSelection,
  WORD_SELECTION_SHOW_TIMEOUT_MS,
} from "../wordSelectionTarget";

import type {
  MockSelectionDocument,
  MockSelectionTarget,
  WordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import type {
  WordSelectionShape,
  WordSelectionSnapshot,
} from "../wordSelectionAnchor";

const HOSTS = ["mac", "pc", "web"] as const;
const PARAGRAPHS = new Set<WordSelectionShape>(["paragraph"]);
const INLINE = new Set<WordSelectionShape>(["paragraph", "inline"]);
const ALL = new Set<WordSelectionShape>([
  "paragraph",
  "inline",
  "multi_paragraph",
  "table_cell",
]);

afterEach(() => {
  vi.useRealTimers();
  uninstallWordSelectionHost();
  resetProgrammaticWordSelectionForTests();
  delete window.WORD_FORCE_NO_PARAGRAPH_IDS;
});

async function captureParagraph(
  host: WordSelectionHost,
  p: string,
): Promise<WordSelectionSnapshot> {
  host.select({ p });
  const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  expect(read.value.role).toBe("rewrite");
  return read.value;
}

async function captureSpan(
  host: WordSelectionHost,
  target: MockSelectionTarget,
): Promise<WordSelectionSnapshot> {
  host.select(target);
  const read = await captureWordSelection("user", 15_000, INLINE);
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  expect(read.value).toMatchObject({ role: "rewrite", shape: "inline" });
  return read.value;
}

async function captureAny(
  host: WordSelectionHost,
  target: MockSelectionTarget,
  shape: WordSelectionShape,
): Promise<WordSelectionSnapshot> {
  host.select(target);
  const read = await captureWordSelection("user", 15_000, ALL);
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  expect(read.value).toMatchObject({ role: "rewrite", shape });
  return read.value;
}

async function prove(
  selection: WordSelectionSnapshot,
  shapes: ReadonlySet<WordSelectionShape> = PARAGRAPHS,
) {
  return Word.run(async (context) => {
    const support = currentWordSelectionSupport();
    const proof = await proveWordSelectionTarget(
      context,
      selection,
      support,
      shapes,
    );
    if ("refused" in proof) return proof;
    const verify = queueTargetVerification(
      context,
      proof.parts,
      selection.paragraphs,
      support,
    );
    await context.sync();
    const [part] = proof.parts;
    return {
      positions: proof.positions,
      part: part.kind === "part" ? part.part : null,
      kinds: proof.parts.map((each) => each.kind),
      check: checkTargetVerification(selection, verify(), support),
    };
  });
}

describe.each(HOSTS)("proveWordSelectionTarget on %s", (flavour) => {
  const install = (document: MockSelectionDocument = SV2_MAIN_DOCUMENT) =>
    installWordSelectionHost(document, { host: flavour });

  it("finds the captured paragraph after the cursor moved and reads its backup", async () => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    host.select({ p: "MP2", text: "xray" });
    const callsBefore = host.calls().length;
    const proven = await prove(selection);
    expect(proven).toMatchObject({
      positions: [2],
      check: { trackingOn: false, formats: [{ font: {}, unresolved: [] }] },
    });
    expect(host.writeSyncs()).toEqual([]);
    expect(host.calls().slice(callsBefore)).not.toContain(
      "Document.getSelection",
    );
  });

  it("finds it after a paragraph was inserted above", async () => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    host.insertParagraphs({ p: "H1" }, ["New paragraph above."], "After");
    expect(await prove(selection)).toMatchObject({ positions: [3] });
  });

  it.each([
    [
      "edited inside",
      (h: WordSelectionHost) =>
        h.insertText({ p: "PL1", text: "kilo" }, "KILO"),
      "TARGET_TEXT_MISMATCH",
    ],
    [
      "deleted",
      (h: WordSelectionHost) => h.deleteParagraphs({ p: "PL1" }),
      "TARGET_NOT_FOUND",
    ],
  ] as const)("refuses a paragraph %s", async (_, change, refused) => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    change(host);
    expect(await prove(selection)).toEqual({ refused });
  });

  it("refuses when the style changed since Send", async () => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    host.setParagraphStyle({ p: "PL1" }, "Heading 2");
    expect(await prove(selection)).toMatchObject({
      check: { refused: "TARGET_TEXT_MISMATCH" },
    });
  });

  it("refuses when a hazard was added since Send", async () => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    host.format({ p: "PL1", text: "kilo" }, { link: "https://example.com/" });
    expect(await prove(selection)).toMatchObject({
      check: { refused: "UNSUPPORTED_CONTENT" },
    });
  });

  it("reports Track Changes and keeps the backup", async () => {
    const host = install();
    const selection = await captureParagraph(host, "PL1");
    host.setTrackingMode("TrackAll");
    expect(await prove(selection)).toMatchObject({
      check: { trackingOn: true, backups: [expect.stringContaining("PL1")] },
    });
  });

  it("refuses a copy it cannot tell apart from the original without IDs", async () => {
    window.WORD_FORCE_NO_PARAGRAPH_IDS = true;
    const host = install({
      body: ["Intro.", "Same clause.", "Middle.", "Other.", "End."],
    });
    const selection = await captureParagraph(host, "Same");
    host.insertParagraphs({ paragraph: 3 }, ["Same clause."], "After");
    host.insertParagraphs({ paragraph: 0 }, ["Intro."], "After");
    expect(await prove(selection)).toEqual({ refused: "AMBIGUOUS_TARGET" });
  });

  it("refuses an inline span while that shape is not enabled", async () => {
    const host = install();
    host.select({ p: "PL1", text: "lima mike" });
    const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
    if (read.status !== "ok" || !read.value) throw new Error("no capture");
    expect(await prove(read.value)).toEqual({
      refused: "UNSUPPORTED_CONTENT",
    });
  });
});

describe.each(HOSTS)(
  "proveWordSelectionTarget for an inline span on %s",
  (flavour) => {
    const install = () =>
      installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: flavour });
    const SPAN = { p: "PL1", text: "lima mike" } as const;

    it("pinpoints the span after the cursor moved", async () => {
      const host = install();
      const selection = await captureSpan(host, SPAN);
      host.select({ p: "MP2", text: "xray" });
      expect(await prove(selection, INLINE)).toMatchObject({
        positions: [2],
        part: "lima mike",
        check: { trackingOn: false, formats: [{ font: {}, unresolved: [] }] },
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it("pinpoints it after a paragraph was inserted above", async () => {
      const host = install();
      const selection = await captureSpan(host, SPAN);
      host.insertParagraphs({ p: "H1" }, ["New paragraph above."], "After");
      expect(await prove(selection, INLINE)).toMatchObject({
        positions: [3],
        part: "lima mike",
      });
    });

    it("pinpoints the captured one of three equal passages", async () => {
      const host = install();
      const selection = await captureSpan(host, {
        p: "RP1",
        text: "Repeated word one.",
        occ: 2,
      });
      expect(selection.occurrence).toBe(2);
      expect(await prove(selection, INLINE)).toMatchObject({
        part: "Repeated word one.",
        check: { formats: [expect.anything()] },
      });
    });

    it.each([
      ["inside the span", "lima", "LIMA"],
      ["elsewhere in its paragraph", "kilo", "KILO"],
    ] as const)(
      "refuses a paragraph edited %s",
      async (_, text, replacement) => {
        const host = install();
        const selection = await captureSpan(host, SPAN);
        host.insertText({ p: "PL1", text }, replacement);
        expect(await prove(selection, INLINE)).toEqual({
          refused: "TARGET_TEXT_MISMATCH",
        });
      },
    );

    it("refuses when a link was added next to the span since Send", async () => {
      const host = install();
      const selection = await captureSpan(host, SPAN);
      host.format({ p: "PL1", text: "kilo" }, { link: "https://example.com/" });
      expect(await prove(selection, INLINE)).toMatchObject({
        check: { refused: "UNSUPPORTED_CONTENT" },
      });
    });

    it("refuses when Word's search no longer lines up with the captured text", async () => {
      const host = install();
      const selection = await captureSpan(host, SPAN);
      host.onSearch((hits) => [...hits, ...hits]);
      expect(await prove(selection, INLINE)).toEqual({
        refused: "TARGET_RANGE_UNPROVEN",
      });
      expect(host.writeSyncs()).toEqual([]);
    });
  },
);

describe.each(HOSTS)("showWordSelection of an inline span on %s", (flavour) => {
  it("selects exactly the span and marks the select as Erato's", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: flavour });
    const selection = await captureSpan(host, {
      p: "RP1",
      text: "Repeated word one.",
      occ: 1,
    });
    host.select({ p: "MP2", text: "xray" });
    const before = host.ooxml({ p: "RP1" });
    expect(await showWordSelection(selection, "doc", "doc", INLINE)).toBe(
      "selected",
    );
    expect(host.selectionText()).toBe("Repeated word one.");
    expect(consumeProgrammaticSelectionEvent()).toBe(true);
    expect(host.ooxml({ p: "RP1" })).toBe(before);
    expect(host.writeSyncs()).toEqual([]);
    if (flavour === "web")
      expect(host.calls().filter((call) => call.endsWith(".expandTo"))).toEqual(
        [],
      );
  });

  it("never selects after its proof timed out", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: flavour });
    const selection = await captureSpan(host, {
      p: "PL1",
      text: "lima mike",
    });
    host.select({ p: "MP2", text: "xray" });
    vi.useFakeTimers();
    const hang = host.hangSync();
    const shown = showWordSelection(selection, "doc", "doc", INLINE);
    await hang.reached;
    await vi.advanceTimersByTimeAsync(WORD_SELECTION_SHOW_TIMEOUT_MS);
    expect(await shown).toBe("unavailable");
    hang.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.calls()).not.toContain("Range.select");
    expect(host.selectionText()).toBe("xray");
  });
});

describe("showWordSelection", () => {
  it("selects only the proven paragraph and marks the select as Erato's", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: "web" });
    const selection = await captureParagraph(host, "PL1");
    host.select({ p: "MP2", text: "xray" });
    expect(await showWordSelection(selection, "doc", "doc")).toBe("selected");
    // The web selects the paragraph mark with a whole paragraph's content (SV2:127).
    expect(host.selectionText()).toBe(
      "PL1 Plain paragraph kilo lima mike november oscar papa.\r",
    );
    expect(consumeProgrammaticSelectionEvent()).toBe(true);
    expect(host.writeSyncs()).toEqual([]);
  });

  it("selects nothing when the passage changed or the document is another", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const selection = await captureParagraph(host, "PL1");
    host.select({ p: "MP2", text: "xray" });
    expect(await showWordSelection(selection, "doc", "other")).toBe(
      "identity-mismatch",
    );
    host.insertText({ p: "PL1", text: "kilo" }, "KILO");
    expect(await showWordSelection(selection, "doc", "doc")).toBe("changed");
    expect(host.selectionText()).toBe("xray");
  });

  it("never selects after its proof timed out", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const selection = await captureParagraph(host, "PL1");
    host.select({ p: "MP2", text: "xray" });
    vi.useFakeTimers();
    const hang = host.hangSync();
    const shown = showWordSelection(selection, "doc", "doc");
    await hang.reached;
    await vi.advanceTimersByTimeAsync(WORD_SELECTION_SHOW_TIMEOUT_MS);
    expect(await shown).toBe("unavailable");
    hang.release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(host.calls()).not.toContain("Range.select");
    expect(host.selectionText()).toBe("xray");
  });
});

const MULTI_SPAN = {
  p: "MP1",
  text: "victor whiskey.",
  to: { p: "MP3", text: "MP3 Multi" },
} as const;

describe.each(HOSTS)(
  "proveWordSelectionTarget for several paragraphs and a cell on %s",
  (flavour) => {
    const install = () =>
      installWordSelectionHost(SV2_MAIN_DOCUMENT, { host: flavour });

    it("proves each covered paragraph, with part ranges for the partial edges", async () => {
      const host = install();
      const selection = await captureAny(host, MULTI_SPAN, "multi_paragraph");
      host.insertParagraphs({ p: "H1" }, ["New paragraph above."], "After");
      host.select({ p: "PL1", text: "kilo" });
      expect(await prove(selection, ALL)).toMatchObject({
        positions: [6, 7, 8],
        part: "victor whiskey.",
        kinds: ["part", "whole", "part"],
        check: {
          trackingOn: false,
          backups: [
            expect.stringContaining("MP1"),
            expect.stringContaining("MP2"),
            expect.stringContaining("MP3"),
          ],
          cellTables: [null, null, null],
        },
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it.each([
      [
        "in the unselected start of the first paragraph",
        "MP1",
        "uniform",
        "UNIFORM",
      ],
      ["in the unselected end of the last paragraph", "MP3", "zulu", "ZULU"],
      ["in a middle paragraph", "MP2", "xray", "XRAY"],
    ] as const)("refuses a span edited %s", async (_, p, text, replacement) => {
      const host = install();
      const selection = await captureAny(host, MULTI_SPAN, "multi_paragraph");
      host.insertText({ p, text }, replacement);
      expect(await prove(selection, ALL)).toEqual({
        refused: "TARGET_TEXT_MISMATCH",
      });
    });

    it.each([true, false])(
      "refuses a span with a paragraph inserted inside it (IDs: %s)",
      async (ids) => {
        if (!ids) window.WORD_FORCE_NO_PARAGRAPH_IDS = true;
        const host = install();
        const selection = await captureAny(host, MULTI_SPAN, "multi_paragraph");
        host.insertParagraphs({ p: "MP1" }, ["Typed inside."], "After");
        const proven = await prove(selection, ALL);
        expect(["TARGET_TEXT_MISMATCH", "TARGET_NOT_FOUND"]).toContain(
          "refused" in proven ? proven.refused : null,
        );
        expect(host.writeSyncs()).toEqual([]);
      },
    );

    it("proves a cell's paragraph whole or in part, and reads its table", async () => {
      const host = install();
      const whole = await captureAny(
        host,
        { table: 0, cell: [1, 1] },
        "table_cell",
      );
      expect(await prove(whole, ALL)).toMatchObject({
        kinds: ["whole"],
        check: { cellTables: [{ nesting: 1, rows: 2, cells: 4 }] },
      });
      const part = await captureAny(
        host,
        { p: "CB2", text: "B2" },
        "table_cell",
      );
      expect(await prove(part, ALL)).toMatchObject({
        part: "B2",
        kinds: ["part"],
      });
    });

    it("refuses a cell edited since Send, and leaves a neighbouring cell's edit alone", async () => {
      const host = install();
      const selection = await captureAny(
        host,
        { table: 0, cell: [1, 1] },
        "table_cell",
      );
      host.insertText({ p: "CA2", text: "A2" }, "AA2");
      expect(await prove(selection, ALL)).toMatchObject({ kinds: ["whole"] });
      host.insertText({ p: "CB2", text: "B2" }, "BB2");
      expect(await prove(selection, ALL)).toEqual({
        refused: "TARGET_TEXT_MISMATCH",
      });
    });

    it("refuses an inline span or several paragraphs while their shape is not enabled", async () => {
      const host = install();
      const selection = await captureAny(host, MULTI_SPAN, "multi_paragraph");
      expect(await prove(selection, INLINE)).toEqual({
        refused: "UNSUPPORTED_CONTENT",
      });
    });
  },
);

describe.each(HOSTS)(
  "checkTargetVerification of an inline part on %s",
  (flavour) => {
    it("refuses once the built part range reads other text in the final read", async () => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: flavour,
      });
      const selection = await captureSpan(host, {
        p: "PL1",
        text: "lima mike",
      });
      const verification = await Word.run(async (context) => {
        const proof = await proveWordSelectionTarget(
          context,
          selection,
          currentWordSelectionSupport(),
          INLINE,
        );
        if ("refused" in proof) throw new Error("not proven");
        const verify = queueTargetVerification(
          context,
          proof.parts,
          selection.paragraphs,
          currentWordSelectionSupport(),
        );
        await context.sync();
        return verify();
      });
      const support = currentWordSelectionSupport();
      const [live] = verification.paragraphs;
      expect(live.partText).toBe("lima mike");
      expect(
        checkTargetVerification(selection, verification, support),
      ).toMatchObject({ formats: [expect.anything()] });
      expect(
        checkTargetVerification(
          selection,
          { ...verification, paragraphs: [{ ...live, partText: "lima mik" }] },
          support,
        ),
      ).toEqual({ refused: "TARGET_RANGE_UNPROVEN" });
    });
  },
);

describe("checkTargetVerification of a cell", () => {
  it("refuses a cell paragraph that left its cell or moved into a nested table", async () => {
    const host = installWordSelectionHost(SV2_MAIN_DOCUMENT);
    const selection = await captureAny(
      host,
      { table: 0, cell: [1, 1] },
      "table_cell",
    );
    const verification = await Word.run(async (context) => {
      const proof = await proveWordSelectionTarget(
        context,
        selection,
        currentWordSelectionSupport(),
        ALL,
      );
      if ("refused" in proof) throw new Error("not proven");
      const verify = queueTargetVerification(
        context,
        proof.parts,
        selection.paragraphs,
        currentWordSelectionSupport(),
      );
      await context.sync();
      return verify();
    });
    const support = currentWordSelectionSupport();
    const [live] = verification.paragraphs;
    expect(
      checkTargetVerification(selection, verification, support),
    ).toMatchObject({
      formats: [expect.anything()],
    });
    for (const changed of [
      { ...live, tableNestingLevel: 2 },
      { ...live, tableNestingLevel: 0 },
    ])
      expect(
        checkTargetVerification(
          selection,
          { ...verification, paragraphs: [changed] },
          support,
        ),
      ).toEqual({ refused: "TARGET_TEXT_MISMATCH" });
  });
});

describe.each(HOSTS)(
  "showWordSelection of several paragraphs on %s",
  (flavour) => {
    /** Runs the web rewrites when a range across paragraphs is selected or read (ERMAIN-932). */
    const DOCUMENT: MockSelectionDocument = {
      body: [
        "Intro.",
        {
          runs: [
            { text: "SM1 Bold", font: { bold: true } },
            " start words here.",
          ],
        },
        "SM2 Middle words.",
        {
          runs: [
            "SM3 End words then ",
            { text: "large", font: { size: 14 } },
            " tail.",
          ],
        },
        "Outro.",
      ],
    };
    const SPAN = {
      p: "SM1",
      text: "start words here.",
      to: { p: "SM3", text: "SM3 End" },
    } as const;

    it(
      flavour === "web"
        ? "selects only the first part and leaves the document unchanged"
        : "selects the whole span",
      async () => {
        const host = installWordSelectionHost(DOCUMENT, { host: flavour });
        const selection = await captureAny(host, SPAN, "multi_paragraph");
        host.select({ p: "SM2", text: "Middle" });
        const before = [1, 2, 3].map((paragraph) => host.ooxml({ paragraph }));
        expect(await showWordSelection(selection, "doc", "doc", ALL)).toBe(
          "selected",
        );
        expect([1, 2, 3].map((paragraph) => host.ooxml({ paragraph }))).toEqual(
          before,
        );
        expect(consumeProgrammaticSelectionEvent()).toBe(true);
        expect(host.selectionText()).toBe(
          flavour === "web"
            ? "start words here."
            : "start words here.\rSM2 Middle words.\rSM3 End",
        );
        expect(host.writeSyncs()).toEqual([]);
        if (flavour === "web")
          expect(
            host.calls().filter((call) => call.endsWith(".expandTo")),
          ).toEqual([]);
      },
    );

    it("selects what a Replace wrote, and reports a passage edited since as changed", async () => {
      const host = installWordSelectionHost(DOCUMENT, { host: flavour });
      const selection = await captureAny(host, SPAN, "multi_paragraph");
      const result = await replaceWordSelection({
        capture: emptySelectionCapture("doc", selection),
        fenceContent: "opening words.\nSM2 Centre words.\nSM3 Final",
        enabledShapes: ALL,
      });
      if (result.status !== "applied") throw new Error("not applied");
      host.select({ paragraph: 0 });
      expect(await showWrittenWordSelection(result.written, "doc", "doc")).toBe(
        "selected",
      );
      expect(host.selectionText()).toBe(
        flavour === "web"
          ? "opening words."
          : "opening words.\rSM2 Centre words.\rSM3 Final",
      );
      host.insertText({ p: "SM2", text: "Centre" }, "Center");
      expect(await showWrittenWordSelection(result.written, "doc", "doc")).toBe(
        "changed",
      );
    });

    it("never selects after its proof timed out", async () => {
      const host = installWordSelectionHost(DOCUMENT, { host: flavour });
      const selection = await captureAny(host, SPAN, "multi_paragraph");
      host.select({ p: "SM2", text: "Middle" });
      vi.useFakeTimers();
      const hang = host.hangSync();
      const shown = showWordSelection(selection, "doc", "doc", ALL);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(WORD_SELECTION_SHOW_TIMEOUT_MS);
      expect(await shown).toBe("unavailable");
      hang.release();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(host.calls()).not.toContain("Range.select");
      expect(host.selectionText()).toBe("Middle");
    });
  },
);
