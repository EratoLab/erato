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
    expect(await revertWordSelection(result.backup, result.written)).toBe(
      "reverted",
    );
    expect(
      host.paragraphs().map(({ text, style, runs }) => ({ text, style, runs })),
    ).toEqual(before.map(({ text, style, runs }) => ({ text, style, runs })));

    const again = await replace(await captureOf(host, { p: "PL1" }));
    if (again.status !== "applied" || !again.backup)
      throw new Error("not applied");
    host.insertText({ p: "PL1", text: "shorter" }, "SHORTER");
    expect(await revertWordSelection(again.backup, again.written)).toBe(
      "stale",
    );
  });

  it("refuses to undo under Track Changes", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    const result = await replace(capture);
    if (result.status !== "applied" || !result.backup)
      throw new Error("not applied");
    host.setTrackingMode("TrackAll");
    expect(await revertWordSelection(result.backup, result.written)).toBe(
      "tracking",
    );
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
