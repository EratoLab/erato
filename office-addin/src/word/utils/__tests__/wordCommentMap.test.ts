import {
  WORD_COMMENT_ARG_TARGET_BYTES,
  WORD_COMMENT_GIST_CHARS,
  parseWordCommentEnvelope,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it } from "vitest";

import {
  V3C_COMMENT_DOCUMENT,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { buildWordDocumentArgs } from "../buildWordDocumentArgs";
import { wordCommentModelOf } from "../wordCommentEnvelope";
import {
  WORD_COMMENT_MAP_PAGE_ROWS,
  WORD_COMMENT_MAP_SECTION_CHARS,
  buildWordCommentMap,
  parseWordCommentMapCursor,
  wordCommentGist,
  wordCommentHeadingsFromBuild,
  wordCommentHeadingsFromInventory,
  wordCommentMapCursor,
  wordCommentMapPage,
  wordCommentMapRow,
  wordCommentSections,
} from "../wordCommentMap";
import { readWordComments } from "../wordCommentReader";
import { createWordCommentRefRegistry } from "../wordCommentRefs";

import type { CommentHostFlavour } from "../../../test/mocks/word/commentHost";
import type {
  WordCommentModel,
  WordCommentModelThread,
} from "../wordCommentEnvelope";
import type { WordCommentHeading } from "../wordCommentMap";
import type { WordCommentReadOptions } from "../wordCommentReader";
import type { WordCommentThread } from "@erato/frontend/word-review";

const NOW = new Date("2026-10-12T08:30:00Z");
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

function modelThread(
  i: number,
  changes: Partial<WordCommentThread> = {},
  replies: number | null = 2,
): WordCommentModelThread {
  return {
    replies,
    thread: {
      id: `t${(i + 1296).toString(36)}`,
      pos: i + 1,
      status: i % 4 === 3 ? "resolved" : "open",
      where: {
        para: i * 3 + 2,
        quote: `Lieferung binnen ${i} Tagen nach Auftragseingang beim Lieferanten`,
        in: "body",
      },
      first_at: "2026-10-02T09:14Z",
      last_at: "2026-10-03T11:02Z",
      entries: [
        {
          n: 0,
          by: "Maya Krüger",
          at: "2026-10-02T09:14Z",
          age: 1,
          day: "2026-10-02",
          text: `Ist die Lieferfrist von ${i} Tagen realistisch? Bitte mit der Logistik klären und die Vertragsstrafe in Abschnitt 7 prüfen, bevor wir unterschreiben.`,
        },
      ],
      ...changes,
    },
  };
}

const modelOf = (
  threads: WordCommentModelThread[],
  unplaced = { open: 0, resolved: 0 },
): WordCommentModel => ({ threads, unplaced, legacy: false });

const sections = wordCommentSections([
  { ordinal: 1, level: 1, text: "Liefervertrag" },
  { ordinal: 40, level: 2, text: "§ 4 Lieferfristen und Verzug" },
  { ordinal: 300, level: 2, text: "§ 7 Haftung" },
]);

afterEach(() => uninstallWordCommentHost());

describe("rows", () => {
  it("keeps each row within about 150–250 bytes", () => {
    const short = (i: number) =>
      modelThread(i, {
        entries: [
          {
            n: 0,
            by: "Jonas Weber",
            at: "2026-10-02T09:14Z",
            age: 1,
            day: "2026-10-02",
            text: `Quelle für Absatz ${i} fehlt.`,
          },
        ],
      });
    const rows = Array.from({ length: 50 }, (_, i) =>
      wordCommentMapRow(i % 2 ? modelThread(i) : short(i), sections(i * 3 + 2)),
    );
    for (const row of rows) {
      expect(bytes(row)).toBeGreaterThanOrEqual(120);
      expect(bytes(row)).toBeLessThanOrEqual(300);
    }
    const average = rows.reduce((n, row) => n + bytes(row), 0) / rows.length;
    expect(average).toBeGreaterThanOrEqual(150);
    expect(average).toBeLessThanOrEqual(250);
  });

  it("holds ref, section, paragraph, short quote, author, status, replies, time and gist", () => {
    expect(wordCommentMapRow(modelThread(14), sections(44))).toEqual({
      id: "t10e",
      sec: "Liefervertrag > § 4 Lieferfristen und Verzug",
      para: 44,
      q: "Lieferung binnen 14 Tagen nach…",
      by: "Maya Krüger",
      st: "open",
      r: 2,
      at: "2026-10-03T11:02Z",
      g: "Ist die Lieferfrist von 14 Tagen realistisch? Bitte mit der Logistik klären und die Vertragsstrafe…",
    });
  });

  it("cuts the gist to about 100 characters at a word", () => {
    const gist = wordCommentGist(`${"Wort ".repeat(40)}Ende`);
    expect(gist.length).toBeLessThanOrEqual(WORD_COMMENT_GIST_CHARS);
    expect(gist.length).toBeGreaterThan(WORD_COMMENT_GIST_CHARS * 0.6);
    expect(gist).toMatch(/Wort…$/);
    expect(wordCommentGist(" Kurz\n\nund  knapp ")).toBe("Kurz und knapp");
    expect(wordCommentGist("x".repeat(150))).toBe(`${"x".repeat(99)}…`);
  });

  it("never cuts the gist inside an emoji", () => {
    expect(wordCommentGist(`${"x".repeat(98)}😀${"y".repeat(10)}`)).toBe(
      `${"x".repeat(98)}…`,
    );
  });

  it("gives a null reply count when the replies were not read", () => {
    expect(wordCommentMapRow(modelThread(1, {}, null)).r).toBeNull();
  });

  it("leaves out an empty quote and an empty gist", () => {
    const row = wordCommentMapRow(
      modelThread(1, {
        where: { para: 9, quote: "", point: true, after: "kilo", in: "body" },
        entries: [
          { n: 0, by: "Jonas", at: null, age: null, day: null, text: "" },
        ],
      }),
    );
    expect(row).not.toHaveProperty("q");
    expect(row).not.toHaveProperty("g");
    expect(row).not.toHaveProperty("sec");
  });
});

describe("section paths", () => {
  it("follows the heading chain and resets at a heading of the same level", () => {
    const at = wordCommentSections([
      { ordinal: 2, level: 1, text: "Teil A" },
      { ordinal: 5, level: 2, text: "Fristen" },
      { ordinal: 9, level: 3, text: "Verzug" },
      { ordinal: 12, level: 2, text: "Preise" },
      { ordinal: 20, level: 1, text: "Teil B" },
    ]);
    expect(at(1)).toBeUndefined();
    expect(at(2)).toBe("Teil A");
    expect(at(10)).toBe("Teil A > Fristen > Verzug");
    expect(at(12)).toBe("Teil A > Preise");
    expect(at(25)).toBe("Teil B");
  });

  it("keeps the innermost headings of a long chain", () => {
    const long: WordCommentHeading[] = Array.from({ length: 6 }, (_, i) => ({
      ordinal: i + 1,
      level: i + 1,
      text: `Überschrift Ebene ${i + 1} mit Text`,
    }));
    const path = wordCommentSections(long)(10)!;
    expect(path.length).toBeLessThanOrEqual(WORD_COMMENT_MAP_SECTION_CHARS);
    expect(path).toMatch(/^… > .*Ebene 6 mit Text$/);
  });

  it("takes headings from the document build and the reader's inventory", () => {
    const build = buildWordDocumentArgs([
      {
        ordinal: 1,
        text: "Titel",
        uniqueLocalId: "a",
        styleBuiltIn: "Title",
        outlineLevel: 10,
      },
      {
        ordinal: 2,
        text: "Body",
        uniqueLocalId: "b",
        styleBuiltIn: "Normal",
        outlineLevel: 10,
      },
      {
        ordinal: 3,
        text: "Kapitel",
        uniqueLocalId: "c",
        styleBuiltIn: "Heading2",
        outlineLevel: 2,
      },
    ]);
    expect(wordCommentHeadingsFromBuild(build.headings)).toEqual([
      { ordinal: 1, level: 1, text: "Titel" },
      { ordinal: 3, level: 2, text: "Kapitel" },
    ]);
    expect(
      wordCommentHeadingsFromInventory([
        { ordinal: 1, id: "a", heading: 1, text: "Titel" },
        { ordinal: 2, id: "b", heading: null },
        { ordinal: 3, id: "c", heading: 2 },
      ]),
    ).toEqual([{ ordinal: 1, level: 1, text: "Titel" }]);
  });
});

describe("pages", () => {
  const map = buildWordCommentMap({
    model: modelOf(
      Array.from({ length: 300 }, (_, i) => modelThread(i)),
      { open: 1, resolved: 1 },
    ),
    now: NOW,
    userTz: "Europe/Berlin",
    sections,
  });

  it("caps the first page with an honest not_shown count and a cursor", () => {
    const first = wordCommentMapPage(map)!;
    const shown = first.index.length;
    expect(bytes(first)).toBeLessThanOrEqual(WORD_COMMENT_ARG_TARGET_BYTES);
    expect(shown).toBeGreaterThan(50);
    expect(shown).toBeLessThanOrEqual(WORD_COMMENT_MAP_PAGE_ROWS);
    expect(first.threads).toEqual([]);
    expect(first.scope).toBe("document");
    expect(first.cursor).toBe(`map:${shown}`);
    expect(first.coverage).toMatchObject({
      threads_total: 302,
      open: 226,
      resolved: 76,
      sent_full: 0,
      sent_index_only: shown,
      not_shown: 302 - shown,
      complete: false,
    });
    expect(first.coverage.line).toBe(
      `Comment map: rows 1–${shown} of 300, for 302 comment threads in the document (226 open, 76 resolved); ${302 - shown} not shown. 2 with no known paragraph. More rows: word_read_comments with cursor map:${shown}.`,
    );
    expect(parseWordCommentEnvelope(JSON.stringify(first))).toEqual(first);
  });

  it("continues from a cursor to the last page, which has none", () => {
    const roomy = { maxBytes: 1 << 20 };
    const first = wordCommentMapPage(map, 0, roomy)!;
    expect(first.index).toHaveLength(WORD_COMMENT_MAP_PAGE_ROWS);
    const second = wordCommentMapPage(
      map,
      parseWordCommentMapCursor(first.cursor!)!,
      roomy,
    )!;
    expect(second.index[0].id).toBe(map.rows[100].id);
    expect(second.cursor).toBe("map:200");
    const last = wordCommentMapPage(map, 200, roomy)!;
    expect(last.index).toHaveLength(100);
    expect(last).not.toHaveProperty("cursor");
    expect(wordCommentMapPage(map, 300)).toBeNull();
    expect(wordCommentMapPage(map, -1)).toBeNull();
  });

  it("caps a page by bytes before rows", () => {
    const page = wordCommentMapPage(map, 0, { maxBytes: 4096 })!;
    expect(bytes(page)).toBeLessThanOrEqual(4096);
    expect(page.index.length).toBeGreaterThan(5);
    expect(page.index.length).toBeLessThan(30);
    expect(page.cursor).toBe(wordCommentMapCursor(page.index.length));
  });

  it("is complete when every thread fits", () => {
    const small = buildWordCommentMap({
      model: modelOf([modelThread(0), modelThread(1)]),
      now: NOW,
      userTz: "UTC",
    });
    const page = wordCommentMapPage(small)!;
    expect(page.coverage).toMatchObject({ not_shown: 0, complete: true });
    expect(page).not.toHaveProperty("cursor");
    expect(page.now).toBe("2026-10-12T08:30Z");
  });

  it("reads only its own cursors", () => {
    expect(parseWordCommentMapCursor("map:0")).toBe(0);
    expect(parseWordCommentMapCursor("map:250")).toBe(250);
    for (const bad of ["map:", "map:-1", "map:01", "page:2", "map:1.5"])
      expect(parseWordCommentMapCursor(bad), bad).toBeNull();
  });
});

describe("the ERMAIN-947 fixture's map", () => {
  async function mapOf(
    flavour: CommentHostFlavour,
    options: Omit<WordCommentReadOptions, "now"> = {},
  ) {
    const host = installWordCommentHost({
      host: flavour,
      document: V3C_COMMENT_DOCUMENT,
    });
    const result = await readWordComments({ ...options, now: host.now });
    if (!result.ok) throw new Error(result.error);
    const { refs, model } = wordCommentModelOf(result, {
      registry: createWordCommentRefRegistry("doc"),
      selection: null,
      people: { principalEmail: null },
      now: NOW,
      userTz: "Europe/Berlin",
    });
    const map = buildWordCommentMap({
      model,
      now: NOW,
      userTz: "Europe/Berlin",
      sections: wordCommentSections(
        wordCommentHeadingsFromInventory(result.inventory?.paragraphs ?? []),
      ),
    });
    const rowOf = (key: string) =>
      map.rows.find(
        (row) =>
          row.id ===
          refs.threads.find((t) => t.commentId === host.commentId(key))!.ref,
      )!;
    return { map, rowOf };
  }

  it("lists every thread in document order with its section", async () => {
    const { map, rowOf } = await mapOf("pc");
    expect(map.rows).toHaveLength(14);
    expect(rowOf("T1")).toMatchObject({
      sec: "Introduction",
      q: "alpha bravo",
      by: "Maya Krüger",
      st: "open",
      r: 2,
      at: "2026-09-04T07:00Z",
      g: "T1 root: please check the alpha bravo wording.",
    });
    expect(rowOf("T2")).toMatchObject({ st: "resolved", r: 1 });
    expect(rowOf("T3").sec).toBe("Introduction > Spans and cells");
    expect(rowOf("T6").sec).toBe("Introduction > Inline anchors");
    expect(rowOf("T5")).not.toHaveProperty("q");
    expect(map.rows.map((row) => row.para)).toEqual(
      [...map.rows.map((row) => row.para)].sort((a, b) => a - b),
    );
  });

  it("lists roots only on Word for Mac when replies were not asked for", async () => {
    const { rowOf } = await mapOf("mac", { replies: "requested" });
    expect(rowOf("T1")).toMatchObject({ r: null, at: "2026-09-03T08:15Z" });
  });
});
