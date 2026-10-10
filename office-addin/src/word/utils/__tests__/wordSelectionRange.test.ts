import { afterEach, describe, expect, it } from "vitest";

import {
  installWordSelectionHost,
  SV2_MAIN_DOCUMENT,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  buildWordSelectionRanges,
  searchStartsOf,
} from "../wordSelectionRange";
import { currentWordSelectionSupport } from "../wordSelectionSupport";

import type {
  MockSelectionDocument,
  WordSelectionHostOptions,
} from "../../../test/mocks/word/selectionHost";

const HOSTS = ["mac", "pc", "web"] as const;

const LONG = `LG1 ${Array.from({ length: 70 }, (_, i) => `term${i}`).join(" ")}.`;
const DOCUMENT: MockSelectionDocument = {
  body: [
    ...SV2_MAIN_DOCUMENT.body,
    LONG,
    "TB1 Label:\tvalue here.",
    "QV1 Say 'quoted' and ‘quoted’ again.",
    "QV2 First ‘x’ then 'x' end.",
  ],
};

afterEach(uninstallWordSelectionHost);

type Built =
  | { refused: string }
  | { whole: true }
  | { text: string; hits: number };

/**
 * Builds the part of the paragraph tagged `tag` and reads the built range's text. A text start
 * stands for its first match in the paragraph.
 */
async function build(
  tag: string,
  from: number | string,
  to?: number,
): Promise<Built> {
  return Word.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load("items/text");
    await context.sync();
    const paragraph = paragraphs.items.find((p) =>
      p.text.startsWith(`${tag} `),
    );
    if (!paragraph) throw new Error(`no paragraph ${tag}`);
    const start =
      typeof from === "string" ? paragraph.text.indexOf(from) : from;
    const end =
      typeof from === "string"
        ? start + from.length
        : (to ?? paragraph.text.length);
    const built = await buildWordSelectionRanges(
      context,
      [{ paragraph, rangeText: paragraph.text, start, end }],
      currentWordSelectionSupport(),
    );
    if ("refused" in built) return built;
    const [part] = built.parts;
    if (part.kind === "whole") return { whole: true as const };
    part.range.load("text");
    await context.sync();
    return {
      text: part.range.text,
      hits: searchStartsOf(paragraph.text, part.part).length,
    };
  });
}

const PL1 = "PL1 Plain paragraph kilo lima mike november oscar papa.";
const RP1 = "RP1 Repeated word one. Repeated word one. Repeated word one.";

describe.each(HOSTS)("buildWordSelectionRanges on %s", (flavour) => {
  const install = (options: WordSelectionHostOptions = {}) =>
    installWordSelectionHost(DOCUMENT, { host: flavour, ...options });

  it.each([
    ["a unique passage", "PL1", 25, 34, "lima mike"],
    ["the second of three equal passages", "RP1", 23, 41, RP1.slice(23, 41)],
    ["a passage at the paragraph's start", "PL1", 0, 9, "PL1 Plain"],
    ["a passage at its end", "PL1", 50, 55, "papa."],
  ] as const)(
    "builds %s on exactly its text",
    async (_, tag, start, end, text) => {
      install();
      expect(await build(tag, start, end)).toMatchObject({ text });
    },
  );

  it("takes a whole paragraph as the paragraph itself, with no search", async () => {
    const host = install();
    expect(await build("PL1", 0, PL1.length)).toEqual({ whole: true });
    expect(host.calls()).not.toContain("Paragraph.search");
  });

  it("builds several paragraphs one by one: a suffix, whole paragraphs and a prefix, never across them", async () => {
    const host = install();
    const before = ["MP1", "MP2", "MP3"].map((p) => host.ooxml({ p }));
    const built = await Word.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load("items/text");
      await context.sync();
      const covered = ["MP1", "MP2", "MP3"].map(
        (tag) => paragraphs.items.find((p) => p.text.startsWith(`${tag} `))!,
      );
      const result = await buildWordSelectionRanges(
        context,
        covered.map((paragraph, i) => ({
          paragraph,
          rangeText: paragraph.text,
          start: i === 0 ? 28 : 0,
          end: i === 2 ? 9 : paragraph.text.length,
        })),
        currentWordSelectionSupport(),
      );
      if ("refused" in result) return result;
      const texts = result.parts.map((part) => {
        if (part.kind === "whole") return null;
        part.range.load("text");
        return part.range;
      });
      await context.sync();
      return texts.map((range) => range?.text ?? "whole");
    });
    expect(built).toEqual(["victor whiskey.", "whole", "MP3 Multi"]);
    expect(["MP1", "MP2", "MP3"].map((p) => host.ooxml({ p }))).toEqual(before);
    if (flavour === "web")
      expect(host.calls().filter((call) => call.endsWith(".expandTo"))).toEqual(
        [],
      );
  });

  it("refuses when Word's Find also matches the curly-quoted copy", async () => {
    const host = install({ searchMatchesQuoteVariants: true });
    expect(await build("QV1", 8, 16)).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
    expect(host.writeSyncs()).toEqual([]);
    install();
    expect(await build("QV1", 8, 16)).toMatchObject({ text: "'quoted'" });
  });

  it("refuses hits that come back out of order or repeated", async () => {
    const host = install();
    const reversed = host.onSearch((hits) => [...hits].reverse());
    expect(await build("RP1", 23, 41)).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
    reversed();
    host.onSearch((hits) => [hits[0], ...hits.slice(0, -1)]);
    expect(await build("RP1", 23, 41)).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("refuses when Word misses a match, which would shift every later hit's index", async () => {
    const host = install();
    host.onSearch((hits) => hits.slice(1));
    expect(await build("RP1", 23, 41)).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("refuses a hit whose text differs even when the count lines up", async () => {
    const host = install({ searchMatchesQuoteVariants: true });
    // Find returns the curly copy first; keeping only it leaves one hit, as the text has one match.
    host.onSearch((hits) => hits.slice(0, 1));
    expect(await build("QV2", "'x'")).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
    expect(host.writeSyncs()).toEqual([]);
  });

  it("refuses when Word returns more hits than the paragraph text has matches", async () => {
    const host = install();
    host.onSearch((hits) => [...hits, ...hits]);
    expect(await build("PL1", 25, 34)).toEqual({
      refused: "TARGET_RANGE_UNPROVEN",
    });
  });

  if (flavour === "web") {
    it("builds no expandTo range and leaves the paragraph's runs unchanged", async () => {
      const host = install();
      const targets = [
        { p: "PL1" },
        { p: "RP1" },
        { p: "MX1" },
        { p: "HT1" },
        { p: "RT1" },
      ];
      const before = targets.map((target) => host.ooxml(target));
      await build("PL1", 25, 34);
      await build("RP1", 23, 41);
      await build("MX1", "Alpha");
      await build("HT1", "Hidden");
      await build("RT1", "ABC");
      expect(targets.map((target) => host.ooxml(target))).toEqual(before);
      expect(host.calls().filter((call) => call.endsWith(".expandTo"))).toEqual(
        [],
      );
    });

    it.each([
      ["longer than Word's search takes", "LG1", 4, 304],
      ["holding a tab", "TB1", 4, 16],
    ] as const)(
      "refuses a part %s, which only an expandTo range could reach",
      async (_, tag, start, end) => {
        const host = install();
        expect(await build(tag, start, end)).toEqual({
          refused: "TARGET_RANGE_UNPROVEN",
        });
        expect(host.calls().filter((c) => c.endsWith(".expandTo"))).toEqual([]);
      },
    );
  } else {
    it.each([
      ["longer than Word's search takes", "LG1", 4, 304, LONG.slice(4, 304)],
      ["holding a tab", "TB1", 4, 16, "Label:\tvalue"],
    ] as const)(
      "builds a part %s between two proven snippet points",
      async (_, tag, start, end, text) => {
        const host = install();
        expect(await build(tag, start, end)).toMatchObject({ text });
        expect(host.calls()).toContain("Range.expandTo");
        expect(host.writeSyncs()).toEqual([]);
      },
    );

    it("refuses a part whose range between the snippet points no longer reads as the part", async () => {
      const host = install();
      let edited = false;
      host.beforeSync(() => {
        const expands = host.calls().filter((c) => c === "Range.expandTo");
        // Both points' prefixes and the part range itself are queued: only its text read is left.
        if (!edited && expands.length === 3) {
          edited = true;
          host.insertText({ p: "LG1", text: "term10 " }, "termX ");
        }
      });
      expect(await build("LG1", 4, 304)).toEqual({
        refused: "TARGET_RANGE_UNPROVEN",
      });
      expect(edited).toBe(true);
    });

    it("refuses when a hit's prefix no longer reads as the paragraph text before it", async () => {
      const host = install();
      let syncs = 0;
      host.beforeSync(() => {
        syncs += 1;
        // After the search sync, before the sync that reads the prefixes.
        if (syncs === 3)
          host.insertText({ p: "RP1", text: "Repeated" }, "X", "Start");
      });
      expect(await build("RP1", 23, 41)).toEqual({
        refused: "TARGET_RANGE_UNPROVEN",
      });
      expect(host.writeSyncs()).toEqual([]);
    });
  }
});

describe("searchStartsOf", () => {
  it("counts matches left to right without overlap, as Word's search does", () => {
    expect(searchStartsOf("aaaa", "aa")).toEqual([0, 2]);
    expect(searchStartsOf("abc", "")).toEqual([]);
  });
});
