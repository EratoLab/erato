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
import { captureWordSelection } from "../wordSelectionCapture";
import { currentWordSelectionSupport } from "../wordSelectionSupport";
import {
  checkTargetVerification,
  proveWordSelectionTarget,
  queueTargetVerification,
  showWordSelection,
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
    const verify = queueTargetVerification(context, proof.parts);
    await context.sync();
    const [part] = proof.parts;
    return {
      positions: proof.positions,
      part: part.kind === "part" ? part.part : null,
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
