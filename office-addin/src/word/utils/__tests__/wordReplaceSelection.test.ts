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
  WORD_REVERT_SELECTION_MS_PER_PARAGRAPH,
  WORD_REVERT_SELECTION_TIMEOUT_MS,
} from "../wordReplaceSelection";
import { emptySelectionCapture } from "../wordSelectionAnchor";
import {
  captureWordSelection,
  WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
} from "../wordSelectionCapture";

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
    expect(result.backups?.[0].rangeText).toBe(before[2].text);
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
      backups: null,
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
    if (result.status !== "applied" || !result.backups)
      throw new Error("not applied");
    expect(
      await revertWordSelection(result.backups, result.written),
    ).toMatchObject({
      status: "reverted",
    });
    expect(
      host.paragraphs().map(({ text, style, runs }) => ({ text, style, runs })),
    ).toEqual(before.map(({ text, style, runs }) => ({ text, style, runs })));

    const again = await replace(await captureOf(host, { p: "PL1" }));
    if (again.status !== "applied" || !again.backups)
      throw new Error("not applied");
    host.insertText({ p: "PL1", text: "shorter" }, "SHORTER");
    expect(
      await revertWordSelection(again.backups, again.written),
    ).toMatchObject({
      status: "stale",
    });
  });

  it("reports an Undo that left an extra paragraph as unverified", async () => {
    const host = install();
    const result = await replace(await captureOf(host, { p: "PL1" }));
    if (result.status !== "applied" || !result.backups)
      throw new Error("not applied");
    const backups = [
      {
        ...result.backups[0],
        ooxml: result.backups[0].ooxml.replace("</w:body>", "<w:p/></w:body>"),
      },
    ];
    expect(await revertWordSelection(backups, result.written)).toMatchObject({
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
    if (result.status !== "applied" || !result.backups)
      throw new Error("not applied");
    host.setSectionBreaks(["PL1"]);
    expect(
      await revertWordSelection(result.backups, result.written),
    ).toMatchObject({ status: "stale" });
  });

  it("rewrites the text around a field, keeps the field and undoes it exactly", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "FD1" });
    expect(capture.selection?.paragraphs[0].kept?.markers).toEqual([
      expect.objectContaining({ number: 1, kind: "field", end: "point" }),
    ]);
    const before = host.paragraphs();
    const result = await replace(
      capture,
      "FD1 Feld vor \u27E61\u27E7 Feld danach.",
    );
    expect(result).toMatchObject({ status: "applied", trackingOn: false });
    expect(host.writeSyncs()).toHaveLength(1);
    const after = host.paragraphs();
    expect(after.find((p) => p.text.startsWith("FD1"))?.text).toBe(
      "FD1 Feld vor 2026-10-06 Feld danach.",
    );
    expect(host.ooxml({ p: "FD1" })).toMatch(/fldCharType="begin"[\s\S]*DATE/);
    expect(others(after, "FD1")).toEqual(others(before, "FD1"));
    if (result.status !== "applied" || !result.backups)
      throw new Error("not applied");
    expect(
      await revertWordSelection(result.backups, result.written),
    ).toMatchObject({ status: "reverted" });
    expect(
      host.paragraphs().map(({ text, style, runs }) => ({ text, style, runs })),
    ).toEqual(before.map(({ text, style, runs }) => ({ text, style, runs })));
  });

  it("keeps a link and a field while rewriting the link's text", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "MX1" });
    const result = await replace(
      capture,
      "MX1 Alpha Bravo foxtrot \u27E61\u27E7Verweis\u27E6/1\u27E7 golf \u27E62\u27E7 hotel.",
    );
    expect(result).toMatchObject({ status: "applied" });
    expect(host.paragraphs().find((p) => p.text.startsWith("MX1"))?.text).toBe(
      "MX1 Alpha Bravo foxtrot Verweis golf 2026-10-06 hotel.",
    );
    const ooxml = host.ooxml({ p: "MX1" });
    expect(ooxml).toMatch(
      /<w:hyperlink[^>]*>[\s\S]*Verweis[\s\S]*<\/w:hyperlink>/,
    );
    expect(ooxml).toContain("DATE");
  });

  it("refuses a proposal that lost a kept item's marker and writes nothing", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "FD1" });
    expect(await replace(capture, "FD1 Feld vor Feld danach.")).toMatchObject({
      status: "refused",
      code: "MARKERS_CHANGED",
    });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("refuses a passage with kept items under Track Changes and writes nothing", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "FD1" });
    host.setTrackingMode("TrackAll");
    expect(
      await replace(capture, "FD1 Feld vor \u27E61\u27E7 Feld danach."),
    ).toMatchObject({ status: "refused", code: "TRACKED_ITEMS" });
    expect(host.writeSyncs()).toEqual([]);
  });

  it.each([
    ["a colour", "FD1", { font: { color: "#C00000" } }],
    ["a character style", "FD1", { rStyle: "Strong" }],
    ["superscript", "FD1", { font: { superscript: true } }],
    ["bold the card did not announce", "FD1", { font: { bold: true } }],
    ["superscript", "PL1", { font: { superscript: true } }],
    ["bold the card did not announce", "PL1", { font: { bold: true } }],
    ["a bookmark", "PL1", { bookmark: "Intro938" }],
  ] as const)(
    "refuses once %s was put on part of %s since Send, and writes nothing",
    async (_, p, format) => {
      const host = install();
      const capture = await captureOf(host, { p });
      expect(capture.selection).toMatchObject({ role: "rewrite" });
      expect(capture.selection?.flattensEmphasis).toBeUndefined();
      host.format({ p, text: p === "PL1" ? "lima mike" : "before" }, format);
      const before = host.ooxml({ p });
      expect(
        await replace(
          capture,
          p === "PL1" ? REWRITE : "FD1 Feld vor \u27E61\u27E7 Feld danach.",
        ),
      ).toMatchObject({ status: "refused", code: "UNSUPPORTED_CONTENT" });
      expect(host.writeSyncs()).toEqual([]);
      expect(host.ooxml({ p })).toBe(before);
    },
  );

  it("flattens bold on part of a passage the card announced, with or without kept items", async () => {
    const host = install({
      body: [
        "Intro.",
        { runs: ["Mixed ", { text: "bold", font: { bold: true } }, " words."] },
        {
          runs: [
            "Kept ",
            { text: "bold", font: { bold: true } },
            " ",
            { text: "3", field: "PAGE" },
            " end.",
          ],
        },
        "Outro.",
      ],
    });
    const plain = await captureOf(host, { paragraph: 1 });
    const kept = await captureOf(host, { paragraph: 2 });
    expect(plain.selection?.flattensEmphasis).toBe(true);
    expect(kept.selection?.flattensEmphasis).toBe(true);
    expect(await replace(plain, "Now plain words.")).toMatchObject({
      status: "applied",
    });
    expect(await replace(kept, "Kept plain \u27E61\u27E7 end.")).toMatchObject({
      status: "applied",
    });
    const [, plainAfter, keptAfter] = host.paragraphs();
    expect(plainAfter.runs.some((run) => run.font?.bold)).toBe(false);
    expect(keptAfter.text).toBe("Kept plain 3 end.");
    expect(
      keptAfter.runs.filter((run) => !run.field).some((run) => run.font?.bold),
    ).toBe(false);
  });

  it("refuses to undo under Track Changes", async () => {
    const host = install();
    const capture = await captureOf(host, { p: "PL1" });
    const result = await replace(capture);
    if (result.status !== "applied" || !result.backups)
      throw new Error("not applied");
    host.setTrackingMode("TrackAll");
    expect(
      await revertWordSelection(result.backups, result.written),
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
  "replaceWordSelection of a paragraph with bookmarks on %s",
  (flavour) => {
    const HEADING = {
      runs: [{ text: "H1 Selection probe heading", bookmark: "_Toc938001" }],
      style: "Heading 1",
    };
    const STACKED = {
      runs: [{ text: "H2 Scope", bookmark: ["_Toc938003", "_Ref938004"] }],
      style: "Heading 2",
    };
    const CAPTION = {
      runs: [
        { text: "Figure ", bookmark: "_Ref938005" },
        { text: "1", field: "SEQ Figure", bookmark: "_Ref938005" },
        ": Sales by region.",
      ],
    };
    const USER = {
      runs: [
        "PB Plain kilo ",
        { text: "lima mike", bookmark: "Intro938" },
        " papa.",
      ],
    };
    const install = () =>
      installWordSelectionHost(
        { body: ["Intro.", HEADING, STACKED, CAPTION, USER, "Outro."] },
        { host: flavour },
      );
    const covered = (host: WordSelectionHost, paragraph: number) => {
      const { runs } = host.paragraphs()[paragraph];
      return runs.map(({ text, bookmarks }) => [text, bookmarks ?? []]);
    };
    const INLINE = new Set<WordSelectionShape>(["paragraph", "inline"]);
    const captureInline = async (
      host: WordSelectionHost,
      target: MockSelectionTarget,
    ) => {
      host.select(target);
      const read = await captureWordSelection("user", 15_000, INLINE);
      if (read.status !== "ok" || !read.value) throw new Error("no capture");
      return emptySelectionCapture("doc", read.value);
    };

    it.each([
      [
        "a heading inside its table of contents bookmark",
        1,
        "H1 A shorter heading",
        [["H1 A shorter heading", ["_Toc938001"]]],
      ],
      [
        "a heading inside both its bookmarks",
        2,
        "H2 Purpose",
        [["H2 Purpose", ["_Toc938003", "_Ref938004"]]],
      ],
      [
        "a caption, its bookmark still around the label and its field",
        3,
        "Abbildung \u27E61\u27E7: Umsatz nach Region.",
        [
          ["Abbildung ", ["_Ref938005"]],
          ["1", ["_Ref938005"]],
          [": Umsatz nach Region.", []],
        ],
      ],
    ] as const)(
      "rewrites %s and undoes it exactly",
      async (_, paragraph, rewrite, after) => {
        const host = install();
        const before = host.paragraphs();
        const capture = await captureOf(host, { paragraph });
        expect(capture.selection).toMatchObject({ role: "rewrite" });
        const result = await replace(capture, rewrite);
        expect(result).toMatchObject({ status: "applied" });
        expect(covered(host, paragraph)).toEqual(after);
        expect(host.paragraphs()[paragraph].style).toBe(
          before[paragraph].style,
        );
        expect(others(host.paragraphs(), "PB")).toHaveLength(5);
        if (result.status !== "applied" || !result.backups)
          throw new Error("not applied");
        expect(
          await revertWordSelection(result.backups, result.written),
        ).toMatchObject({ status: "reverted" });
        expect(
          host
            .paragraphs()
            .map(({ text, style, runs }) => ({ text, style, runs })),
        ).toEqual(
          before.map(({ text, style, runs }) => ({ text, style, runs })),
        );
      },
    );

    it.each([
      [
        "a word inside a heading's bookmark",
        { p: "H1", text: "probe" },
        "test",
        1,
        [["H1 Selection test heading", ["_Toc938001"]]],
      ],
      [
        "words before a bookmark",
        { p: "PB", text: "Plain kilo" },
        "Short",
        4,
        [
          ["PB Short ", []],
          ["lima mike", ["Intro938"]],
          [" papa.", []],
        ],
      ],
      [
        "exactly the bookmarked words",
        { p: "PB", text: "lima mike" },
        "Lima und Mike",
        4,
        [
          ["PB Plain kilo ", []],
          ["Lima und Mike", ["Intro938"]],
          [" papa.", []],
        ],
      ],
    ] as const)(
      "rewrites %s and leaves the bookmark over the same text",
      async (_, target, rewrite, paragraph, after) => {
        const host = install();
        const result = await replaceWordSelection({
          capture: await captureInline(host, target),
          fenceContent: rewrite,
          enabledShapes: INLINE,
        });
        expect(result).toMatchObject({ status: "applied" });
        expect(covered(host, paragraph)).toEqual(after);
      },
    );

    it("reports unverified when the heading's bookmark moved by the read-back", async () => {
      const host = install();
      const capture = await captureOf(host, { p: "H1" });
      let moved = false;
      // In the read-back's run: the web applies an OOXML write only once its own run has ended.
      host.beforeSync(() => {
        if (host.writeSyncs().length === 1 && !moved) {
          moved = true;
          host.clearBookmarks({ p: "H1", text: "H1 " });
        }
      });
      expect(await replace(capture, "H1 A shorter heading")).toMatchObject({
        status: "unverified",
      });
    });

    it("refuses a heading with a bookmark under Track Changes and writes nothing", async () => {
      const host = install();
      const capture = await captureOf(host, { p: "H1" });
      host.setTrackingMode("TrackAll");
      expect(await replace(capture, "H1 A shorter heading")).toMatchObject({
        status: "refused",
        code: "TRACKED_ITEMS",
      });
      expect(host.writeSyncs()).toEqual([]);
    });
  },
);

describe("replaceWordSelection on Mac when its OOXML leaves out bookmarks", () => {
  it.each([
    [
      "a heading's whole text",
      "H1",
      "H1 Selection probe heading",
      "H1 Shorter heading",
    ],
    ["two words of a plain paragraph", "PL1", "lima mike", REWRITE],
    [
      "a paragraph that keeps a field",
      "FD1",
      "before",
      "FD1 Feld vor \u27E61\u27E7 Feld danach.",
    ],
  ] as const)(
    "refuses once a bookmark was put on %s since Send, and writes nothing",
    async (_, p, text, rewrite) => {
      const host = installWordSelectionHost(SV2_MAIN_DOCUMENT, {
        host: "mac",
        ooxmlOmitsBookmarks: true,
      });
      const capture = await captureOf(host, { p });
      expect(capture.selection).toMatchObject({ role: "rewrite" });
      host.format({ p, text }, { bookmark: "_Toc938001" });
      expect(host.ooxml({ p })).not.toContain("bookmark");
      const before = host.paragraphs();
      expect(await replace(capture, rewrite)).toMatchObject({
        status: "refused",
        code: "UNSUPPORTED_CONTENT",
      });
      expect(host.writeSyncs()).toEqual([]);
      expect(host.paragraphs()).toEqual(before);
    },
  );
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
      expect(result.backups?.[0].rangeText).toBe(
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

    it("refuses when a copy of its paragraph appeared right above the one its ID names", async () => {
      const host = install();
      const capture = await captureSpan(host, { p: "PL1", text: "lima mike" });
      // Where Word moved the ID onto a copy split off below (office-js #5784), the document reads
      // the same as this: the original, then the paragraph holding the ID.
      host.insertParagraphs(
        { p: "PL1" },
        ["PL1 Plain paragraph kilo lima mike november oscar papa."],
        "Before",
      );
      expect(await replaceSpan(capture, "kilo")).toMatchObject({
        status: "refused",
        code: "AMBIGUOUS_TARGET",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

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
        backups: null,
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
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      expect(
        await revertWordSelection(result.backups, result.written),
      ).toMatchObject({ status: "reverted" });
      // insertOoxml gives the restored paragraph a new ID.
      expect({ ...paragraphOf(host, "BN1"), id: before.id }).toEqual(before);
    });
  },
);

describe.each(HOSTS)(
  "replaceWordSelection of several paragraphs and a cell on %s",
  (flavour) => {
    const ALL = new Set<WordSelectionShape>([
      "paragraph",
      "inline",
      "multi_paragraph",
      "table_cell",
    ]);
    const DOCUMENT: MockSelectionDocument = {
      body: [
        ...SV2_MAIN_DOCUMENT.body,
        { runs: "HM1 Heading start words.", style: "Heading 2" },
        { runs: "HM2 Listed item words.", style: "List Paragraph", list: true },
      ],
    };
    const SPAN = {
      p: "MP1",
      text: "victor whiskey.",
      to: { p: "MP3", text: "MP3 Multi" },
    } as const;
    const install = (document: MockSelectionDocument = DOCUMENT) =>
      installWordSelectionHost(document, { host: flavour });
    const captureAll = async (
      host: WordSelectionHost,
      target: MockSelectionTarget,
      shape: WordSelectionShape,
    ) => {
      host.select(target);
      const read = await captureWordSelection("user", 15_000, ALL);
      if (read.status !== "ok" || !read.value) throw new Error("no capture");
      expect(read.value).toMatchObject({ role: "rewrite", shape });
      return emptySelectionCapture("doc", read.value);
    };
    const replaceAll = (
      capture: WordSelectionCapture,
      fenceContent: string,
      timeoutMs?: number,
    ) =>
      replaceWordSelection({
        capture,
        fenceContent,
        enabledShapes: ALL,
        timeoutMs,
      });
    const texts = (host: WordSelectionHost) =>
      host.paragraphs().map((p) => p.text);
    const REWRITE_MP = "victor yankee.\nMP2 Changed middle.\nMP3 Several";
    /** The syncs a Replace of SPAN runs before its write, measured on a fresh host. */
    const syncsBeforeWrite = async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const before = host.syncCount();
      await replaceAll(capture, REWRITE_MP);
      const [write] = host.writeSyncs();
      uninstallWordSelectionHost();
      return write.index - before;
    };

    it("writes each changed paragraph's part in one sync, last to first, and nothing else", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      host.select({ p: "PL1", text: "kilo" });
      const before = host.paragraphs();
      const result = await replaceAll(capture, REWRITE_MP);
      expect(result).toMatchObject({ status: "applied", trackingOn: false });
      expect(host.writeSyncs()).toHaveLength(1);
      const writes = host
        .writeSyncs()[0]
        .writes.filter((write) => write.endsWith(".insertText"));
      expect(writes).toHaveLength(3);
      const after = host.paragraphs();
      expect(after.slice(5, 8).map((p) => p.text)).toEqual([
        "MP1 Multi paragraph uniform victor yankee.",
        "MP2 Changed middle.",
        "MP3 Several paragraph uniform zulu omega.",
      ]);
      expect([...after.slice(0, 5), ...after.slice(8)]).toEqual([
        ...before.slice(0, 5),
        ...before.slice(8),
      ]);
      expect(host.selectionText()).toBe("kilo");
      if (result.status !== "applied") throw new Error("not applied");
      expect(result.written).toMatchObject({
        rangeTexts: after.slice(5, 8).map((p) => p.text),
        startOffset: 28,
        endOffset: 11,
      });
      expect(result.backups?.map((backup) => backup.position)).toEqual([
        0, 1, 2,
      ]);
    });

    it("writes the paragraphs from the last to the first", async () => {
      const host = install();
      const capture = await captureAll(
        host,
        { p: "MP1", to: { p: "MP2", text: "MP2 Multi" } },
        "multi_paragraph",
      );
      expect(
        await replaceAll(capture, "MP1 First rewritten.\nMP2 Second"),
      ).toMatchObject({ status: "applied" });
      const [write] = host.writeSyncs();
      expect(
        write.writes.filter((command) => command.endsWith(".insertText")),
      ).toEqual(["Range.insertText", "Paragraph.insertText"]);
    });

    it("skips an unchanged middle line and backs up only what it wrote", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const result = await replaceAll(
        capture,
        "victor yankee.\nMP2 Multi paragraph uniform xray yankee.\nMP3 Several",
      );
      expect(
        host
          .writeSyncs()[0]
          .writes.filter((write) => write.endsWith(".insertText")),
      ).toHaveLength(2);
      if (result.status !== "applied") throw new Error("not applied");
      expect(result.backups?.map((backup) => backup.position)).toEqual([0, 2]);
    });

    it("keeps heading and list styles", async () => {
      const host = install();
      const capture = await captureAll(
        host,
        {
          p: "HM1",
          text: "start words.",
          to: { p: "HM2", text: "HM2 Listed" },
        },
        "multi_paragraph",
      );
      expect(
        await replaceAll(capture, "opening words.\nHM2 Numbered"),
      ).toMatchObject({ status: "applied" });
      const [heading, item] = host.paragraphs().slice(-2);
      expect(heading).toMatchObject({
        text: "HM1 Heading opening words.",
        style: "Heading 2",
      });
      expect(item).toMatchObject({
        text: "HM2 Numbered item words.",
        style: "List Paragraph",
        list: true,
      });
    });

    it("empties a paragraph for an empty line but never removes it", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const count = host.paragraphs().length;
      expect(
        await replaceAll(capture, "victor yankee.\n\nMP3 Several"),
      ).toMatchObject({ status: "applied" });
      expect(host.paragraphs()).toHaveLength(count);
      expect(host.paragraphs()[6].text).toBe("");
    });

    it("refuses a reply with another number of lines and writes nothing", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const callsBefore = host.calls().length;
      expect(
        await replaceAll(capture, "victor yankee.\nMP3 Several"),
      ).toMatchObject({ status: "refused", code: "PARAGRAPH_COUNT_MISMATCH" });
      expect(host.calls().slice(callsBefore)).toEqual([]);
      expect(host.writeSyncs()).toEqual([]);
    });

    it("refuses a span whose partial edge Word's search can no longer pinpoint", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      host.onSearch((hits) => [...hits, ...hits]);
      expect(await replaceAll(capture, REWRITE_MP)).toMatchObject({
        status: "refused",
        code: "TARGET_RANGE_UNPROVEN",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it("refuses a span whose paragraphs ended a section since Send", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      host.setSectionBreaks(["MP2"]);
      expect(await replaceAll(capture, REWRITE_MP)).toMatchObject({
        status: "refused",
        code: "UNSUPPORTED_CONTENT",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it("reports unverified, never applied, when a covered paragraph was edited outside the span between the final read and the write", async () => {
      const offset = await syncsBeforeWrite();
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const writeSync = host.syncCount() + offset;
      host.beforeSync((index) => {
        if (index === writeSync)
          host.insertText({ p: "MP1", text: "uniform" }, "UNIFORM");
      });
      expect(await replaceAll(capture, REWRITE_MP)).toMatchObject({
        status: "unverified",
      });
    });

    it("reports unverified, never applied, when a paragraph appeared elsewhere between the final read and the write", async () => {
      const offset = await syncsBeforeWrite();
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const writeSync = host.syncCount() + offset;
      host.beforeSync((index) => {
        if (index === writeSync)
          host.insertParagraphs({ p: "HM2" }, ["Typed at the end."], "After");
      });
      expect(await replaceAll(capture, REWRITE_MP)).toMatchObject({
        status: "unverified",
      });
      expect(texts(host).slice(5, 8)).toEqual([
        "MP1 Multi paragraph uniform victor yankee.",
        "MP2 Changed middle.",
        "MP3 Several paragraph uniform zulu omega.",
      ]);
    });

    it("leaves the document untouched when the final read does not answer", async () => {
      const offset = await syncsBeforeWrite();
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      const before = texts(host);
      vi.useFakeTimers();
      const hang = host.hangSync({ at: host.syncCount() + offset - 1 });
      const result = replaceAll(capture, REWRITE_MP, 1_000);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({ status: "failed", timedOut: true });
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.writeSyncs()).toEqual([]);
      expect(texts(host)).toEqual(before);
    });

    it("reports a write whose reply never came as unverified", async () => {
      const offset = await syncsBeforeWrite();
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      vi.useFakeTimers();
      const hang = host.hangSync({
        at: host.syncCount() + offset,
        execute: "immediately",
      });
      const result = replaceAll(capture, REWRITE_MP, 1_000);
      await hang.reached;
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await result).toMatchObject({
        status: "unverified",
        timedOut: true,
      });
      hang.release();
    });

    it("gives the final read the capture's span-check allowance per covered paragraph", async () => {
      const offset = await syncsBeforeWrite();
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      vi.useFakeTimers();
      const hang = host.hangSync({ at: host.syncCount() + offset - 1 });
      let done = false;
      const result = replaceAll(capture, REWRITE_MP).finally(() => {
        done = true;
      });
      await hang.reached;
      await vi.advanceTimersByTimeAsync(WORD_REPLACE_SELECTION_TIMEOUT_MS);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(
        3 * WORD_SELECTION_SPAN_CHECK_MS_PER_PARAGRAPH,
      );
      expect(await result).toMatchObject({ status: "failed", timedOut: true });
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.writeSyncs()).toEqual([]);
    });

    it("gives the restore more time for each paragraph it restores", async () => {
      const host = install();
      const result = await replaceAll(
        await captureAll(host, SPAN, "multi_paragraph"),
        REWRITE_MP,
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      vi.useFakeTimers();
      const hang = host.hangSync();
      let done = false;
      const revert = revertWordSelection(
        result.backups,
        result.written,
      ).finally(() => {
        done = true;
      });
      await hang.reached;
      await vi.advanceTimersByTimeAsync(WORD_REVERT_SELECTION_TIMEOUT_MS);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(
        3 * WORD_REVERT_SELECTION_MS_PER_PARAGRAPH,
      );
      expect(await revert).toMatchObject({ status: "failed", timedOut: true });
      hang.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(host.writeSyncs()).toHaveLength(1);
    });

    it("writes deletions and insertions of the covered parts only under Track Changes", async () => {
      const host = install();
      const capture = await captureAll(host, SPAN, "multi_paragraph");
      host.setTrackingMode("TrackAll");
      expect(await replaceAll(capture, REWRITE_MP)).toMatchObject({
        status: "applied",
        trackingOn: true,
        backups: null,
      });
      expect(
        host
          .revisions()
          .filter((revision) => revision.author !== "Other Author")
          .filter((revision) => revision.type !== "Formatted")
          .map(({ type, text }) => [type, text])
          .sort(),
      ).toEqual(
        [
          ["Added", "victor yankee."],
          ["Added", "MP2 Changed middle."],
          ["Added", "MP3 Several"],
          ["Deleted", "victor whiskey."],
          ["Deleted", "MP2 Multi paragraph uniform xray yankee."],
          ["Deleted", "MP3 Multi"],
        ].sort(),
      );
    });

    it("undoes every written paragraph in one sync, verified in another run", async () => {
      const host = install();
      const before = host.paragraphs();
      const result = await replaceAll(
        await captureAll(host, SPAN, "multi_paragraph"),
        REWRITE_MP,
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      const syncsBefore = host.writeSyncs().length;
      expect(
        await revertWordSelection(result.backups, result.written),
      ).toMatchObject({ status: "reverted" });
      const restores = host.writeSyncs().slice(syncsBefore);
      expect(restores).toHaveLength(1);
      expect(
        restores[0].writes.filter((write) => write.endsWith(".insertOoxml")),
      ).toHaveLength(3);
      expect(
        host
          .syncLog()
          .some(
            (entry) =>
              entry.index > restores[0].index &&
              entry.context !== restores[0].context,
          ),
      ).toBe(true);
      // insertOoxml gives each restored paragraph a new ID.
      expect(host.paragraphs().map(({ id: _, ...rest }) => rest)).toEqual(
        before.map(({ id: _, ...rest }) => rest),
      );
    });

    it("restores the paragraphs from the last to the first", async () => {
      const host = install();
      const result = await replaceAll(
        await captureAll(host, SPAN, "multi_paragraph"),
        REWRITE_MP,
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      expect(
        await revertWordSelection(result.backups, result.written),
      ).toMatchObject({ status: "reverted" });
      // Each insertOoxml gives its paragraph the mock's next ID, so the IDs show the restore order.
      const ids = host
        .paragraphs()
        .slice(5, 8)
        .map((p) => p.id);
      expect(ids).toEqual([...ids].sort().reverse());
      expect(new Set(ids).size).toBe(3);
    });

    it("refuses to undo once any written paragraph changed again", async () => {
      const host = install();
      const result = await replaceAll(
        await captureAll(host, SPAN, "multi_paragraph"),
        REWRITE_MP,
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      host.insertText({ p: "MP2", text: "middle" }, "centre");
      const writes = host.writeSyncs().length;
      expect(
        await revertWordSelection(result.backups, result.written),
      ).toMatchObject({ status: "stale" });
      expect(host.writeSyncs()).toHaveLength(writes);
    });

    it("reports an Undo that left an extra paragraph as unverified", async () => {
      const host = install();
      const result = await replaceAll(
        await captureAll(host, SPAN, "multi_paragraph"),
        REWRITE_MP,
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      const backups = result.backups.map((backup, i) =>
        i === 1
          ? {
              ...backup,
              ooxml: backup.ooxml.replace("</w:body>", "<w:p/></w:body>"),
            }
          : backup,
      );
      expect(await revertWordSelection(backups, result.written)).toMatchObject({
        status: "unverified",
      });
    });

    it.each([
      [
        "whole",
        { table: 0, cell: [1, 1] },
        "CB2 New cell text",
        "CB2 New cell text",
      ],
      ["in part", { p: "CB2", text: "B2 text" }, "B9 text", "CB2 Cell B9 text"],
    ] as const)(
      "replaces a cell's paragraph %s, leaves the other cells, and undoes it exactly",
      async (_, target, fence, expected) => {
        const host = install();
        const before = host.paragraphs();
        const result = await replaceAll(
          await captureAll(host, target, "table_cell"),
          fence,
        );
        expect(result).toMatchObject({ status: "applied" });
        expect(host.writeSyncs()).toHaveLength(1);
        const after = host.paragraphs();
        expect(after).toHaveLength(before.length);
        const cell = after.findIndex((p) => p.text === expected);
        expect(after[cell].nesting).toBe(1);
        expect(after.filter((_, i) => i !== cell)).toEqual(
          before.filter((_, i) => i !== cell),
        );
        if (result.status !== "applied" || !result.backups)
          throw new Error("not applied");
        expect(
          await revertWordSelection(result.backups, result.written),
        ).toMatchObject({ status: "reverted" });
        expect(host.paragraphs().map(({ id: _, ...rest }) => rest)).toEqual(
          before.map(({ id: _, ...rest }) => rest),
        );
      },
    );

    it("never writes a nested table's cell, even when its capture is forced to rewrite", async () => {
      const host = install({
        body: [
          "Intro.",
          {
            table: [
              [[{ table: [["NT1 Nested cell text."]] }], "NO1 Outer cell."],
            ],
          },
          "Outro.",
        ],
      });
      host.select({ p: "NT1" });
      const read = await captureWordSelection("user", 15_000, ALL);
      if (read.status !== "ok" || !read.value) throw new Error("no capture");
      expect(read.value).toMatchObject({
        role: "context_only",
        reasonCode: "nested_table",
        shape: "table_cell",
      });
      const forced = emptySelectionCapture("doc", {
        ...read.value,
        role: "rewrite",
        reasonCode: null,
      });
      expect(await replaceAll(forced, "NT1 Never written.")).toMatchObject({
        status: "refused",
        code: "UNSUPPORTED_CONTENT",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    it("confirms a cell written under Track Changes, though desktop's getText ends it with a tab", async () => {
      const host = install();
      const capture = await captureAll(
        host,
        { table: 0, cell: [1, 1] },
        "table_cell",
      );
      host.setTrackingMode("TrackAll");
      expect(await replaceAll(capture, "CB2 New cell text")).toMatchObject({
        status: "applied",
        trackingOn: true,
        backups: null,
      });
    });

    it("refuses a cell edited since Send and writes nothing", async () => {
      const host = install();
      const capture = await captureAll(
        host,
        { table: 0, cell: [1, 1] },
        "table_cell",
      );
      host.insertText({ p: "CB2", text: "B2" }, "BB2");
      expect(await replaceAll(capture, "CB2 New")).toMatchObject({
        status: "refused",
        code: "TARGET_TEXT_MISMATCH",
      });
      expect(host.writeSyncs()).toEqual([]);
    });

    /** Merges the written cell into its neighbour once `writes` write syncs have run. */
    const mergeAfterWrite = (host: WordSelectionHost, writes: number) => {
      let merged = false;
      host.afterSync(() => {
        if (merged || host.writeSyncs().length !== writes) return;
        merged = true;
        host.mergeCellIntoPrevious(0, [1, 1]);
      });
      return () => merged;
    };

    it("reports unverified when the cell's table lost a cell by the read-back", async () => {
      const host = install();
      const capture = await captureAll(
        host,
        { table: 0, cell: [1, 1] },
        "table_cell",
      );
      const count = host.paragraphs().length;
      const merged = mergeAfterWrite(host, 1);
      expect(await replaceAll(capture, "CB2 New cell text")).toMatchObject({
        status: "unverified",
      });
      expect(merged()).toBe(true);
      expect(host.paragraphs()).toHaveLength(count);
      expect(texts(host)).toContain("CB2 New cell text");
    });

    it("reports unverified when the cell's table lost a cell by the restore's check", async () => {
      const host = install();
      const result = await replaceAll(
        await captureAll(host, { table: 0, cell: [1, 1] }, "table_cell"),
        "CB2 New cell text",
      );
      if (result.status !== "applied" || !result.backups)
        throw new Error("not applied");
      const count = host.paragraphs().length;
      const merged = mergeAfterWrite(host, 2);
      expect(
        await revertWordSelection(result.backups, result.written),
      ).toMatchObject({ status: "unverified" });
      expect(merged()).toBe(true);
      expect(host.paragraphs()).toHaveLength(count);
      expect(texts(host)).toContain("CB2 Cell B2 text");
    });
  },
);
