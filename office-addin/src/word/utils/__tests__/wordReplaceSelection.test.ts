import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  replaceWordSelection,
  revertWordSelection,
  WORD_REPLACE_SELECTION_TIMEOUT_MS,
} from "../wordReplaceSelection";
import { emptySelectionCapture } from "../wordSelectionAnchor";
import { captureWordSelection } from "../wordSelectionCapture";

import type {
  MockParagraphState,
  MockSelectionDocument,
  MockSelectionTarget,
  WordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import type {
  WordSelectionCapture,
  WordSelectionShape,
} from "../wordSelectionAnchor";

const HOSTS = ["mac", "pc", "web"] as const;
const PARAGRAPHS = new Set<WordSelectionShape>(["paragraph"]);
const REWRITE = "PL1 A shorter plain paragraph.";

afterEach(() => {
  vi.useRealTimers();
  uninstallWordSelectionHost();
});

async function captureOf(
  host: WordSelectionHost,
  target: MockSelectionTarget,
): Promise<WordSelectionCapture> {
  host.select(target);
  const read = await captureWordSelection("user", 15_000, PARAGRAPHS);
  if (read.status !== "ok" || !read.value) throw new Error("no capture");
  return emptySelectionCapture("doc", read.value);
}

const replace = (
  capture: WordSelectionCapture,
  fenceContent = REWRITE,
  timeoutMs?: number,
) =>
  replaceWordSelection({
    capture,
    fenceContent,
    enabledShapes: PARAGRAPHS,
    timeoutMs,
  });

const others = (paragraphs: MockParagraphState[], except: string) =>
  paragraphs.filter((p) => !p.text.startsWith(except));

describe.each(HOSTS)("replaceWordSelection on %s", (flavour) => {
  const install = (document: MockSelectionDocument = SV2_MAIN_DOCUMENT) =>
    installWordSelectionHost(document, { host: flavour });

  it("writes the rewrite onto the captured paragraph in one sync and nowhere else", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    host.select({ p: "MP2", text: "xray" });
    const before = host.paragraphs();
    const syncsBefore = host.syncCount();
    const result = await replace(capture);
    expect(result).toMatchObject({ status: "applied", trackingOn: false });
    expect(host.writeSyncs()).toHaveLength(1);
    const after = host.paragraphs();
    expect(after[2].text).toBe(REWRITE);
    expect(after[2].style).toBe(before[2].style);
    expect(others(after, "PL1")).toEqual(others(before, "PL1"));
    expect(host.selectionText()).toBe("xray");
    expect(host.syncCount() - syncsBefore).toBeGreaterThan(1);
    if (result.status !== "applied") throw new Error("not applied");
    expect(result.written.rangeTexts).toEqual([REWRITE]);
    expect(result.backup?.rangeText).toBe(before[2].text);
  });

  it("joins the lines of a single-paragraph rewrite", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    await replace(capture, "PL1 First line\nsecond line.");
    expect(host.paragraphs()[2].text).toBe("PL1 First line second line.");
  });

  it("writes nothing when the proposal equals the passage", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    expect(
      await replace(
        capture,
        "PL1 Plain paragraph kilo lima mike november oscar papa.",
      ),
    ).toMatchObject({ status: "unchanged" });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("refuses an edited passage and writes nothing", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    host.insertText({ p: "PL1", text: "kilo" }, "KILO");
    expect(await replace(capture)).toMatchObject({
      status: "refused",
      code: "TARGET_TEXT_MISMATCH",
    });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("never writes a context-only or not-enabled capture", async () => {
    const host = install();
    const inline = await captureOf(host, { p: "PL1", text: "lima mike" });
    expect(await replace(inline)).toMatchObject({
      status: "refused",
      code: "UNSUPPORTED_CONTENT",
    });
    const paragraph = await captureOf(host, { p: "PL1" });
    expect(
      await replaceWordSelection({
        capture: paragraph,
        fenceContent: REWRITE,
        enabledShapes: new Set(),
      }),
    ).toMatchObject({ status: "refused", code: "UNSUPPORTED_CONTENT" });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("keeps uniform bold bold and gives a mixed toggle the style's value", async () => {
    const host = install({
      body: [
        "Intro.",
        { runs: [{ text: "All bold words.", font: { bold: true } }] },
        { runs: [{ text: "First", font: { bold: true } }, " word bold."] },
        "Outro.",
      ],
    });
    const bold = await captureOf(host, { paragraph: 1 });
    const mixed = await captureOf(host, { paragraph: 2 });
    await replace(bold, "Still bold.");
    await replace(mixed, "No longer partly bold.");
    const [, boldAfter, mixedAfter] = host.paragraphs();
    expect(boldAfter.runs).toEqual([
      expect.objectContaining({
        text: "Still bold.",
        font: expect.objectContaining({ bold: true }),
      }),
    ]);
    expect(mixedAfter.runs.map((run) => run.font?.bold ?? false)).toEqual([
      false,
    ]);
  });

  it("leaves the document untouched when Word does not answer before the write", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    vi.useFakeTimers();
    const finalRead = host.syncCount() + 3;
    const hang = host.hangSync({ at: finalRead });
    const result = replace(capture, REWRITE, 1_000);
    await hang.reached;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ status: "failed", timedOut: true });
    hang.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.writeSyncs()).toEqual([]);
    expect(host.paragraphs()[2].text).not.toBe(REWRITE);
  });

  it("reports a write whose reply never came as unverified", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    vi.useFakeTimers();
    const writeSync = host.syncCount() + 4;
    const hang = host.hangSync({ at: writeSync, execute: "immediately" });
    const result = replace(capture, REWRITE, 1_000);
    await hang.reached;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({
      status: "unverified",
      timedOut: true,
    });
    hang.release();
  });

  it("reports unverified when the document moved between the final read and the write", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    const writeSync = host.syncCount() + 4;
    host.beforeSync((index) => {
      if (index === writeSync)
        host.insertParagraphs({ p: "H1" }, ["Typed meanwhile."], "After");
    });
    expect(await replace(capture)).toMatchObject({ status: "unverified" });
  });

  it("writes a deletion plus an insertion under Track Changes and keeps no backup", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    host.setTrackingMode("TrackAll");
    const original = host.paragraphs()[2].text;
    expect(await replace(capture)).toMatchObject({
      status: "applied",
      trackingOn: true,
      backup: null,
    });
    expect(
      host
        .revisions()
        .filter((revision) => revision.author !== "Other Author")
        .map((r) => r.type)
        .sort(),
    ).toEqual(["Added", "Deleted"]);
    host.rejectAllRevisions();
    expect(host.paragraphs()[2].text).toBe(original);
  });

  it("undoes the write exactly, and refuses once the paragraph changed again", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    const before = host.paragraphs();
    const result = await replace(capture);
    if (result.status !== "applied" || !result.backup)
      throw new Error("not applied");
    expect(
      await revertWordSelection(result.backup, result.written),
    ).toMatchObject({
      status: "reverted",
    });
    expect(
      host.paragraphs().map(({ text, style, runs }) => ({ text, style, runs })),
    ).toEqual(before.map(({ text, style, runs }) => ({ text, style, runs })));

    const again = await replace(await captureOf(host, { p: "PL1" }));
    if (again.status !== "applied" || !again.backup)
      throw new Error("not applied");
    host.insertText({ p: "PL1", text: "shorter" }, "SHORTER");
    expect(
      await revertWordSelection(again.backup, again.written),
    ).toMatchObject({
      status: "stale",
    });
  });

  it("reports an Undo that left an extra paragraph as unverified", async () => {
    const host = install();
    const result = await replace(await captureOf(host, { p: "PL1" }));
    if (result.status !== "applied" || !result.backup)
      throw new Error("not applied");
    const backup = {
      ...result.backup,
      ooxml: result.backup.ooxml.replace("</w:body>", "<w:p/></w:body>"),
    };
    expect(await revertWordSelection(backup, result.written)).toMatchObject({
      status: "unverified",
    });
  });

  it("refuses a paragraph that ended a section since Send, and an Undo once it does", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    host.setSectionBreaks(["PL1"]);
    const before = host.paragraphs();
    expect(await replace(capture)).toMatchObject({
      status: "refused",
      code: "UNSUPPORTED_CONTENT",
    });
    expect(host.paragraphs()).toEqual(before);

    host.setSectionBreaks([]);
    const result = await replace(capture);
    if (result.status !== "applied" || !result.backup)
      throw new Error("not applied");
    host.setSectionBreaks(["PL1"]);
    expect(
      await revertWordSelection(result.backup, result.written),
    ).toMatchObject({ status: "stale" });
  });

  it("refuses to undo under Track Changes", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    const result = await replace(capture);
    if (result.status !== "applied" || !result.backup)
      throw new Error("not applied");
    host.setTrackingMode("TrackAll");
    expect(
      await revertWordSelection(result.backup, result.written),
    ).toMatchObject({
      status: "tracking",
    });
  });
});

describe("replaceWordSelection across hosts", () => {
  it("leaves the same runs on every host", async () => {
    const runs = [];
    for (const host of HOSTS) {
      const word = installWordSelectionHost(
        {
          body: [
            "Intro.",
            {
              runs: [
                { text: "Bold first", font: { bold: true } },
                " then plain.",
              ],
            },
          ],
        },
        { host },
      );
      await replace(
        await captureOf(word, { paragraph: 1 }),
        "Rewritten words.",
      );
      runs.push(word.paragraphs()[1].runs);
    }
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it("times out by default after the documented limit", () => {
    expect(WORD_REPLACE_SELECTION_TIMEOUT_MS).toBe(30_000);
  });
});

describe("replaceWordSelection on the web", () => {
  it("rewrites a paragraph whose bold word carries the web's own bold twin", async () => {
    const host = installWordSelectionHost(
      {
        body: [
          "Intro.",
          {
            runs: [
              { text: "Bold", font: { bold: true, boldBidirectional: true } },
              " then plain words.",
            ],
          },
        ],
      },
      { host: "web" },
    );
    const capture = await captureOf(host, { paragraph: 1 });
    expect(capture.selection?.role).toBe("rewrite");
    expect(await replace(capture, "Rewritten words.")).toMatchObject({
      status: "applied",
    });
  });
});

describe.each(HOSTS)(
  "replaceWordSelection of an inline span on %s",
  (flavour) => {
    const INLINE = new Set<WordSelectionShape>(["paragraph", "inline"]);
    const DOCUMENT: MockSelectionDocument = {
      body: [
        ...SV2_MAIN_DOCUMENT.body,
        {
          runs: [
            "BN1 Plain ",
            { text: "bold words", font: { bold: true } },
            " then the plain end.",
          ],
        },
      ],
    };
    const install = () => installWordSelectionHost(DOCUMENT, { host: flavour });
    const captureSpan = async (
      host: WordSelectionHost,
      target: MockSelectionTarget,
    ) => {
      host.select(target);
      const read = await captureWordSelection("user", 15_000, INLINE);
      if (read.status !== "ok" || !read.value) throw new Error("no capture");
      expect(read.value).toMatchObject({ role: "rewrite", shape: "inline" });
      return emptySelectionCapture("doc", read.value);
    };
    const replaceSpan = (
      capture: WordSelectionCapture,
      fenceContent: string,
      timeoutMs?: number,
    ) =>
      replaceWordSelection({
        capture,
        fenceContent,
        enabledShapes: INLINE,
        timeoutMs,
      });
    const paragraphOf = (host: WordSelectionHost, prefix: string) => {
      const found = host.paragraphs().find((p) => p.text.startsWith(prefix));
      if (!found) throw new Error(`no paragraph ${prefix}`);
      return found;
    };
    /** Syncs from the start of a Replace to its final read: the story, the search, desktop's prefixes. */
    const finalReadAfter = flavour === "web" ? 4 : 5;

    it("writes only the span, in one sync, and keeps the rest of its paragraph's runs", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "BN1", text: "the plain" });
      host.select({ p: "MP2", text: "xray" });
      const before = host.paragraphs();
      const result = await replaceSpan(capture, "a simpler");
      expect(result).toMatchObject({ status: "applied", trackingOn: false });
      expect(host.writeSyncs()).toHaveLength(1);
      const after = paragraphOf(host, "BN1");
      expect(after.text).toBe("BN1 Plain bold words then a simpler end.");
      expect(after.runs.slice(0, 2)).toEqual(
        paragraphOf(
          { paragraphs: () => before } as WordSelectionHost,
          "BN1",
        ).runs.slice(0, 2),
      );
      expect(others(host.paragraphs(), "BN1")).toEqual(others(before, "BN1"));
      expect(host.selectionText()).toBe("xray");
      if (result.status !== "applied") throw new Error("not applied");
      expect(result.written).toMatchObject({
        rangeTexts: ["BN1 Plain bold words then a simpler end."],
        startOffset: 26,
        endOffset: 35,
      });
      expect(result.backup?.rangeText).toBe(
        "BN1 Plain bold words then the plain end.",
      );
    });

    it("writes the captured one of three equal passages and leaves the others", async () => {
      const host = install();
      const capture = await captureSpan(host, {
        p: "RP1",
        text: "Repeated word one.",
        occ: 1,
      });
      expect(await replaceSpan(capture, "Second changed.")).toMatchObject({
        status: "applied",
      });
      expect(paragraphOf(host, "RP1").text).toBe(
        "RP1 Repeated word one. Second changed. Repeated word one.",
      );
    });

    it("does not make a rewrite next to a bold word bold, and keeps a bold span bold", async () => {
      const host = install();
      await replaceSpan(
        await captureSpan(host, { p: "BN1", text: "Plain " }),
        "Simple ",
      );
      await replaceSpan(
        await captureSpan(host, { p: "BN1", text: "bold words" }),
        "strong words",
      );
      const runs = paragraphOf(host, "BN1").runs;
      expect(runs.map((run) => [run.text, !!run.font?.bold])).toEqual([
        ["BN1 Simple ", false],
        ["strong words", true],
        [" then the plain end.", false],
      ]);
    });

    it("writes nothing when the proposal equals the span", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      expect(await replaceSpan(capture, "lima mike")).toMatchObject({
        status: "unchanged",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it.each([
      ["inside the span", "lima", "LIMA"],
      ["elsewhere in its paragraph", "oscar", "OSCAR"],
    ] as const)(
      "refuses a paragraph edited %s and writes nothing",
      async (_, text, replacement) => {
        const host = install();
        const capture = await captureSpan(host, {
          p: "PL1",
          text: "lima mike",
        });
        host.insertText({ p: "PL1", text }, replacement);
        expect(await replaceSpan(capture, "kilo")).toMatchObject({
          status: "refused",
          code: "TARGET_TEXT_MISMATCH",
        });
        expect(host.writeSyncs()).toEqual([]);
      },
    );

    it("refuses a span Word's search can no longer pinpoint and writes nothing", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      host.onSearch((hits) => [...hits, ...hits]);
      expect(await replaceSpan(capture, "kilo")).toMatchObject({
        status: "refused",
        code: "TARGET_RANGE_UNPROVEN",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it("reports unverified, never applied, when its paragraph was edited between the final read and the write", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      const writeSync = host.syncCount() + finalReadAfter + 1;
      host.beforeSync((index) => {
        if (index === writeSync)
          host.insertText({ p: "PL1", text: "oscar" }, "OSCAR");
      });
      expect(await replaceSpan(capture, "kilo")).toMatchObject({
        status: "unverified",
      });
    });

    it("leaves the document untouched when the final read does not answer", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      vi.useFakeTimers();
      const hang = host.hangSync({ at: host.syncCount() + finalReadAfter });
      const result = replaceSpan(capture, "kilo", 1_000);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({ status: "failed", timedOut: true });
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.writeSyncs()).toEqual([]);
      expect(paragraphOf(host, "PL1").text).toContain("lima mike");
    });

    it("reports a write whose reply never came as unverified", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      vi.useFakeTimers();
      const hang = host.hangSync({
        at: host.syncCount() + finalReadAfter + 1,
        execute: "immediately",
      });
      const result = replaceSpan(capture, "kilo", 1_000);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({
        status: "unverified",
        timedOut: true,
      });
      hang.release();
    });

    it("writes a deletion and an insertion of the span only under Track Changes", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      host.setTrackingMode("TrackAll");
      expect(await replaceSpan(capture, "kilo two")).toMatchObject({
        status: "applied",
        trackingOn: true,
        backup: null,
      });
      expect(
        host
          .revisions()
          .filter((revision) => revision.author !== "Other Author")
          .map(({ type, text }) => [type, text])
          .sort(),
      ).toEqual([
        ["Added", "kilo two"],
        ["Deleted", "lima mike"],
      ]);
    });

    it("undoes the write back to the paragraph's original runs", async () => {
      const host = install();
      const before = paragraphOf(host, "BN1");
      const result = await replaceSpan(
        await captureSpan(host, { p: "BN1", text: "the plain" }),
        "a simpler",
      );
      if (result.status !== "applied" || !result.backup)
        throw new Error("not applied");
      expect(
        await revertWordSelection(result.backup, result.written),
      ).toMatchObject({ status: "reverted" });
      // insertOoxml gives the restored paragraph a new ID.
      expect({ ...paragraphOf(host, "BN1"), id: before.id }).toEqual(before);
    });
  },
);
