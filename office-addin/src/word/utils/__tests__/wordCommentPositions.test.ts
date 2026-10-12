import { afterEach, describe, expect, it } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  V3C_ANCHORS,
  v3cRangeText,
} from "../../../test/mocks/word/commentPackages";
import {
  wordCommentContainer,
  wordCommentCoordinates,
  wordCommentPositionInput,
  wordCommentPositions,
  wordCommentSelection,
  wordCommentSelectionCoordinates,
  wordCommentShortQuote,
  wordCommentWhere,
} from "../wordCommentPositions";
import { readWordComments } from "../wordCommentReader";

import type {
  CommentHost,
  CommentHostFlavour,
} from "../../../test/mocks/word/commentHost";
import type {
  WordCommentCoordinates,
  WordCommentPosition,
  WordCommentPositionInput,
  WordCommentSelectionCoordinates,
} from "../wordCommentPositions";
import type {
  WordCommentParagraphRef,
  WordCommentThreadRecord,
} from "../wordCommentReader";
import type { WordCommentContainer } from "@erato/frontend/word-review";

const at = (
  first: number,
  start: number | null,
  last = first,
  end: number | null = start,
  point = false,
): WordCommentCoordinates => ({ first, last, start, end, point });

const thread = (
  ref: string,
  coordinates: WordCommentCoordinates,
  order: number,
  container: WordCommentContainer = "body",
): WordCommentPositionInput => ({ ref, at: coordinates, in: container, order });

const sel = (
  first: number,
  start: number,
  last = first,
  end = start,
): WordCommentSelectionCoordinates => ({ first, last, start, end });

function positions(
  threads: readonly WordCommentPositionInput[],
  selection?: WordCommentSelectionCoordinates,
) {
  return Object.fromEntries(wordCommentPositions(threads, { selection }));
}

const relation =
  (
    table: Record<string, string>,
  ): ((a: string, b: string) => string | undefined) =>
  (a, b) =>
    table[`${a}|${b}`];

describe("Annex A position cases", () => {
  // ¶5 "Zahlungsziel 30 Tage" t2p, [sel] ¶12 "Lieferung binnen 14 Tagen", ¶18 t4c.
  const t1 = [
    thread("t2p", at(5, 4, 5, 24), 0),
    thread("t4c", at(18, 0, 18, 10), 1),
  ];

  it("T1–T3: the comment above is before, the one below after, whatever their ages", () => {
    expect(positions(t1, sel(12, 0, 12, 25))).toEqual({
      t2p: { pos: 1, vs: "before", away: 7, in: "body" },
      t4c: { pos: 2, vs: "after", away: 6, in: "body" },
    });
  });

  it("T4–T6: a thread on the selected text is inside it", () => {
    expect(
      positions([thread("t7k", at(12, 0, 12, 25), 0)], sel(12, 0, 12, 25)),
    ).toEqual({ t7k: { pos: 1, vs: "inside", away: 0, in: "body" } });
  });

  it("T7–T8: nested anchors around a selected phrase contain it and lie inside it", () => {
    // ¶12 "Die Lieferfrist beträgt 14 Tage.": tA on the sentence, tB on "14 Tage".
    const nested = [
      thread("tA", at(12, 0, 12, 32), 0),
      thread("tB", at(12, 24, 12, 31), 1),
    ];
    expect(positions(nested, sel(12, 24, 12, 31))).toEqual({
      tA: { pos: 1, vs: "contains", away: 0, in: "body", overlaps: ["tB"] },
      tB: { pos: 2, vs: "inside", away: 0, in: "body", overlaps: ["tA"] },
    });
  });

  it("T9: a resolved thread far below is after, many paragraphs away", () => {
    expect(
      positions([thread("t1a", at(20, 3, 20, 12), 0)], sel(3, 0, 3, 5)),
    ).toEqual({ t1a: { pos: 1, vs: "after", away: 17, in: "body" } });
  });

  it("T10: every thread in a selection over their paragraphs is inside it", () => {
    const scope = [
      thread("ta1", at(2, 0, 2, 4), 0),
      thread("ta2", at(4, 3, 4, 9), 1),
      thread("ta3", at(6, 1, 7, 2), 2),
      thread("ta4", at(9, 0, 9, 8), 3),
    ];
    const found = positions(scope, sel(1, 0, 10, 20));
    expect(Object.values(found).map((p) => [p.pos, p.vs, p.away])).toEqual([
      [1, "inside", 0],
      [2, "inside", 0],
      [3, "inside", 0],
      [4, "inside", 0],
    ]);
  });

  it("T11–T12: threads at ¶3, ¶12 and ¶30 against a selection, then a caret elsewhere", () => {
    const maya = [
      thread("m3", at(3, 0, 3, 5), 0),
      thread("m12", at(12, 6, 12, 15), 1),
      thread("m30", at(30, 0, 30, 5), 2),
    ];
    expect(positions(maya, sel(12, 0, 12, 40))).toMatchObject({
      m3: { vs: "before", away: 9 },
      m12: { vs: "inside", away: 0 },
      m30: { vs: "after", away: 18 },
    });
    expect(positions(maya, sel(8, 4))).toMatchObject({
      m3: { vs: "before", away: 5 },
      m12: { vs: "after", away: 4 },
      m30: { vs: "after", away: 22 },
    });
  });

  it("T13: a thread in the table just above the selection is before, in its cell", () => {
    const cell = wordCommentContainer({
      ordinal: 38,
      via: "id",
      rangeText: "2027",
      nesting: 1,
      cell: { row: 2, cell: 1 },
      table: 2,
    });
    expect(
      positions([thread("tP", at(38, 0, 38, 4), 0, cell)], sel(40, 0, 40, 6)),
    ).toEqual({
      tP: {
        pos: 1,
        vs: "before",
        away: 2,
        in: { table: 2, row: 3, cell: 2 },
      },
    });
  });

  it("T14: a caret at a point comment is at it; a selection ending there holds it", () => {
    // ¶9 "Das gilt ab Vertragsbeginn." with a point comment after "Vertragsbeginn" (26).
    const point = [thread("tQ", at(9, 26, 9, 26, true), 0)];
    expect(positions(point, sel(9, 26))).toEqual({
      tQ: { pos: 1, vs: "at_caret", away: 0, in: "body" },
    });
    expect(positions(point, sel(9, 12, 9, 26))).toMatchObject({
      tQ: { vs: "inside" },
    });
    expect(positions(point, sel(9, 0, 9, 11))).toMatchObject({
      tQ: { vs: "after", away: 0 },
    });
  });

  it("T22: an anchor over ¶4–¶6 contains a selection in ¶5, and a caret there is at it", () => {
    const spanning = [thread("tS", at(4, 10, 6, 7), 0)];
    expect(positions(spanning, sel(5, 2, 5, 9))).toEqual({
      tS: { pos: 1, vs: "contains", away: 0, in: "body" },
    });
    expect(positions(spanning, sel(5, 3))).toMatchObject({
      tS: { vs: "at_caret" },
    });
    // Without offsets the middle paragraph still decides.
    expect(
      positions([thread("tS", at(4, null, 6, null), 0)], sel(5, 2, 5, 9)),
    ).toMatchObject({ tS: { vs: "contains", away: 0 } });
  });
});

describe("vs edges and partial overlaps", () => {
  const anchor = [thread("t1", at(4, 10, 4, 20), 0)];

  it.each([
    ["ends where the selection starts", sel(4, 20, 4, 30), "before"],
    ["starts where the selection ends", sel(4, 0, 4, 10), "after"],
    ["overlaps the selection's start", sel(4, 15, 4, 30), "overlaps_start"],
    ["overlaps the selection's end", sel(4, 5, 4, 15), "overlaps_end"],
    [
      "shares the selection's start and is longer",
      sel(4, 10, 4, 15),
      "contains",
    ],
    ["equals the selection", sel(4, 10, 4, 20), "inside"],
    ["is inside a selection over paragraphs", sel(3, 2, 5, 1), "inside"],
    ["is touched by a caret at its start", sel(4, 10), "at_caret"],
    ["is touched by a caret at its end", sel(4, 20), "at_caret"],
    ["lies before a caret", sel(4, 21), "before"],
  ])("an anchor that %s", (_case, selection, vs) => {
    expect(positions(anchor, selection).t1.vs).toBe(vs);
  });

  it("leaves vs out where one paragraph has no offsets to compare", () => {
    expect(
      positions([thread("t1", at(4, null), 0)], sel(4, 5, 4, 9)).t1,
    ).toEqual({ pos: 1, away: 0, in: "body" });
    expect(
      positions([thread("t1", at(4, null), 0)], sel(6, 0, 6, 3)).t1,
    ).toEqual({ pos: 1, vs: "before", away: 2, in: "body" });
  });

  it("gives no vs or away without a selection", () => {
    expect(positions(anchor).t1).toEqual({ pos: 1, in: "body" });
  });
});

describe("pos", () => {
  it("ranks anchor starts densely, the shorter of two equal starts first", () => {
    const threads = [
      thread("c", at(7, 0, 7, 9), 0),
      thread("a", at(2, 5, 2, 9), 1),
      thread("b2", at(2, 5, 2, 7), 2),
      thread("d", at(7, 3, 7, 4), 3),
    ];
    expect(
      Object.fromEntries(
        Object.entries(positions(threads)).map(([ref, p]) => [ref, p.pos]),
      ),
    ).toEqual({ b2: 1, a: 2, c: 3, d: 4 });
  });

  it("gives anchors on the same text the same pos", () => {
    const threads = [
      thread("x", at(3, 4, 3, 9), 0),
      thread("y", at(3, 4, 3, 9), 1),
      thread("z", at(5, 0, 5, 1), 2),
    ];
    const found = positions(threads);
    expect([found.x.pos, found.y.pos, found.z.pos]).toEqual([1, 1, 2]);
  });

  it("takes Word's relation where one paragraph's offsets are missing", () => {
    const threads = [
      thread("p", at(3, null), 0),
      thread("q", at(3, null), 1),
      thread("r", at(3, null), 2),
    ];
    const relations = relation({
      "p|q": "Before",
      "r|q": "OverlapsBefore",
      "p|r": "Equal",
    });
    const found = Object.fromEntries(
      wordCommentPositions(threads, { relations }),
    );
    expect([found.r.pos, found.p.pos, found.q.pos]).toEqual([1, 1, 2]);
  });

  it("falls back to the read's order, and puts threads without a paragraph last", () => {
    const threads = [
      thread(
        "u",
        { first: null, last: null, start: null, end: null, point: false },
        0,
      ),
      thread("v", at(3, null), 2),
      thread("w", at(3, null), 1),
    ];
    const found = positions(threads);
    expect([found.w.pos, found.v.pos, found.u.pos]).toEqual([1, 2, 3]);
  });
});

describe("overlaps", () => {
  it("names nested and overlapping anchors, not touching ones", () => {
    const threads = [
      thread("t6", at(12, 12, 12, 36), 0),
      thread("t7", at(12, 17, 12, 30), 1),
      thread("t7b", at(12, 31, 12, 48), 2),
      thread("tx", at(12, 48, 12, 50), 3),
    ];
    const found = positions(threads);
    expect(found.t6.overlaps).toEqual(["t7", "t7b"]);
    expect(found.t7.overlaps).toEqual(["t6"]);
    expect(found.t7b.overlaps).toEqual(["t6"]);
    expect(found.tx.overlaps).toBeUndefined();
  });

  it("nests a thread in the middle of a span over paragraphs, and a point inside a range", () => {
    const threads = [
      thread("span", at(4, 25, 6, 13), 0),
      thread("mid", at(5, null), 1),
      thread("point", at(4, 30, 4, 30, true), 2),
      thread("edge", at(4, 0, 4, 25), 3),
    ];
    const found = positions(threads);
    expect(found.span.overlaps).toEqual(["point", "mid"]);
    expect(found.edge.overlaps).toBeUndefined();
  });

  it("asks Word's relation when offsets cannot tell", () => {
    const threads = [thread("a", at(3, null), 0), thread("b", at(3, null), 1)];
    expect(positions(threads).a.overlaps).toBeUndefined();
    const together = wordCommentPositions(threads, {
      relations: relation({ "b|a": "InsideStart" }),
    });
    expect(together.get("a")?.overlaps).toEqual(["b"]);
  });
});

describe("helpers", () => {
  const paragraph = (
    changes: Partial<WordCommentParagraphRef> = {},
  ): WordCommentParagraphRef => ({
    ordinal: 4,
    via: "id",
    rangeText: "Text",
    nesting: 0,
    cell: null,
    table: null,
    ...changes,
  });

  it("numbers a top-level cell from 1 and leaves the rest in the body", () => {
    expect(
      wordCommentContainer(
        paragraph({ nesting: 1, cell: { row: 0, cell: 1 }, table: 3 }),
      ),
    ).toEqual({ table: 3, row: 1, cell: 2 });
    expect(
      wordCommentContainer(
        paragraph({ nesting: 2, cell: { row: 0, cell: 0 }, table: null }),
      ),
    ).toBe("body");
    expect(wordCommentContainer(null)).toBe("body");
  });

  it("maps the v2 capture's span to review coordinates in the main body only", () => {
    const capture = {
      story: "main" as const,
      paragraphs: [{ index: 11 }, { index: 13 }] as never,
      startOffset: 4,
      endOffset: 9,
    };
    expect(wordCommentSelectionCoordinates(capture)).toEqual({
      first: 12,
      last: 14,
      start: 4,
      end: 9,
    });
    expect(
      wordCommentSelectionCoordinates({ ...capture, story: "header" }),
    ).toBeNull();
    expect(
      wordCommentSelectionCoordinates({
        ...capture,
        paragraphs: [{ index: -1 }] as never,
      }),
    ).toBeNull();
    expect(wordCommentSelection(sel(12, 4))).toEqual({
      para: [12, 12],
      caret: true,
    });
  });

  it("keeps both ends of a long quote", () => {
    const quote = `${"alpha ".repeat(30)}omega`;
    const short = wordCommentShortQuote(quote, 20);
    expect(short.length).toBeLessThanOrEqual(41);
    expect(short).toMatch(/^alpha alpha alpha.*….*omega$/);
    expect(wordCommentShortQuote("short", 20)).toBe("short");
  });
});

describe("the ERMAIN-947 fixture through the reader", () => {
  const HOSTS: readonly CommentHostFlavour[] = ["pc", "web"];
  const ROOTS = Object.keys(V3C_ANCHORS);
  let host: CommentHost;

  afterEach(() => uninstallWordCommentHost());

  async function readAll(flavour: CommentHostFlavour) {
    host = installWordCommentHost({ host: flavour });
    const result = await readWordComments({
      now: host.now,
      exact: (threads) => threads.map((t) => t.id),
    });
    if (!result.ok) throw new Error(result.error);
    const keyOf = (record: WordCommentThreadRecord) =>
      ROOTS.find((key) => host.commentId(key) === record.id)!;
    return { threads: result.threads, keyOf };
  }

  /** paragraph.text offsets of a phrase, as the v2 capture would record a selection of it. */
  function phrase(
    flavour: CommentHostFlavour,
    tag: string,
    text: string,
    occurrence = 1,
  ): WordCommentSelectionCoordinates {
    const rangeText = v3cRangeText(tag, flavour === "web" ? "web" : "desktop");
    let start = -1;
    for (let i = 0; i < occurrence; i += 1)
      start = rangeText.indexOf(text, start + 1);
    const ordinal = host.ordinalOf(tag);
    return { first: ordinal, last: ordinal, start, end: start + text.length };
  }

  const caret = (
    selection: WordCommentSelectionCoordinates,
    edge: "start" | "end",
  ) => ({
    ...selection,
    start: selection[edge],
    end: selection[edge],
  });

  async function positionsFor(
    flavour: CommentHostFlavour,
    selection: (flavour: CommentHostFlavour) => WordCommentSelectionCoordinates,
  ): Promise<Record<string, WordCommentPosition>> {
    const { threads, keyOf } = await readAll(flavour);
    const found = wordCommentPositions(
      threads.map((t) => wordCommentPositionInput(t, keyOf(t))),
      { selection: selection(flavour) },
    );
    return Object.fromEntries(found);
  }

  /** Ground truth: threads outside the selection's paragraphs lie before or after by paragraph. */
  function expectOthersByParagraph(
    found: Record<string, WordCommentPosition>,
    selection: WordCommentSelectionCoordinates,
    except: readonly string[],
  ) {
    for (const key of ROOTS) {
      if (except.includes(key)) continue;
      const first = host.ordinalOf(V3C_ANCHORS[key].tag);
      const last = host.ordinalOf(V3C_ANCHORS[key].endTag);
      const expected =
        last < selection.first
          ? { vs: "before", away: selection.first - last }
          : { vs: "after", away: first - selection.last };
      expect(found[key], key).toMatchObject(expected);
    }
  }

  it.each(HOSTS)("ranks every thread in document order on %s", async (h) => {
    const found = await positionsFor(h, () => sel(1, 0));
    expect(ROOTS.map((key) => found[key].pos)).toEqual(
      ROOTS.map((_, i) => i + 1),
    );
    expect(found.T6.overlaps).toEqual(["T7", "T7b"]);
    expect(found.T7.overlaps).toEqual(["T6"]);
    expect(found.T7b.overlaps).toEqual(["T6"]);
    expect(found.T4.in).toEqual({ table: 1, row: 1, cell: 1 });
    expect(found.T14.in).toEqual({ table: 2, row: 1, cell: 1 });
  });

  it.each(HOSTS)("selecting 'alpha bravo' holds T1 on %s", async (h) => {
    const selection = (f: CommentHostFlavour) =>
      phrase(f, "T1P", "alpha bravo");
    const found = await positionsFor(h, selection);
    expect(found.T1).toMatchObject({ vs: "inside", away: 0 });
    expectOthersByParagraph(found, selection(h), ["T1"]);
  });

  it.each(HOSTS)("a caret at T1's start is at T1 on %s", async (h) => {
    const selection = (f: CommentHostFlavour) =>
      caret(phrase(f, "T1P", "alpha bravo"), "start");
    const found = await positionsFor(h, selection);
    expect(found.T1).toMatchObject({ vs: "at_caret", away: 0 });
    expectOthersByParagraph(found, selection(h), ["T1"]);
  });

  it.each(HOSTS)("a caret in T3B is at T3 on %s", async (h) => {
    const selection = (f: CommentHostFlavour) =>
      caret(phrase(f, "T3B", "Middle"), "start");
    const found = await positionsFor(h, selection);
    expect(found.T3).toMatchObject({ vs: "at_caret", away: 0 });
    expectOthersByParagraph(found, selection(h), ["T3"]);
  });

  it.each(HOSTS)("the whole of T6P holds T6, T7 and T7b on %s", async (h) => {
    const selection = (f: CommentHostFlavour) => {
      const ordinal = host.ordinalOf("T6P");
      const length = v3cRangeText(
        "T6P",
        f === "web" ? "web" : "desktop",
      ).length;
      return { first: ordinal, last: ordinal, start: 0, end: length };
    };
    const found = await positionsFor(h, selection);
    for (const key of ["T6", "T7", "T7b"])
      expect(found[key], key).toMatchObject({ vs: "inside", away: 0 });
    expectOthersByParagraph(found, selection(h), ["T6", "T7", "T7b"]);
  });

  it.each(HOSTS)(
    "T8's second 'sierra tango' holds T8 and the first does not on %s",
    async (h) => {
      const second = await positionsFor(h, (f) =>
        phrase(f, "T8P", "sierra tango", 2),
      );
      expect(second.T8).toMatchObject({ vs: "inside", away: 0 });
      const first = await positionsFor(h, (f) =>
        phrase(f, "T8P", "sierra tango", 1),
      );
      expect(first.T8).toMatchObject({ vs: "after", away: 0 });
    },
  );

  it.each(HOSTS)(
    "the point comment T5 against carets and selections on %s",
    async (h) => {
      const atPoint = await positionsFor(h, (f) =>
        caret(phrase(f, "T5P", "kilo"), "end"),
      );
      expect(atPoint.T5).toMatchObject({ vs: "at_caret", away: 0 });
      const word = await positionsFor(h, (f) => phrase(f, "T5P", "kilo"));
      expect(word.T5).toMatchObject({ vs: "inside", away: 0 });
      const later = await positionsFor(h, (f) =>
        phrase(f, "T5P", "more words"),
      );
      expect(later.T5).toMatchObject({ vs: "before", away: 0 });
    },
  );

  it.each(HOSTS)(
    "selecting in the T4 cell holds T4, in its cell, on %s",
    async (h) => {
      const selection = (f: CommentHostFlavour) =>
        phrase(f, "T4C", "india juliet");
      const found = await positionsFor(h, selection);
      expect(found.T4).toEqual({
        pos: 4,
        vs: "inside",
        away: 0,
        in: { table: 1, row: 1, cell: 1 },
      });
      expectOthersByParagraph(found, selection(h), ["T4"]);
    },
  );

  it.each(HOSTS)("builds each thread's where on %s", async (h) => {
    const { threads, keyOf } = await readAll(h);
    const found = wordCommentPositions(
      threads.map((t) => wordCommentPositionInput(t, keyOf(t))),
      { selection: phrase(h, "T8P", "sierra tango", 2) },
    );
    const where = (key: string) => {
      const record = threads.find((t) => keyOf(t) === key)!;
      return wordCommentWhere(record, found.get(key)!);
    };
    expect(where("T8")).toEqual({
      para: host.ordinalOf("T8P"),
      quote: "sierra tango",
      occurrence: 2,
      vs: "inside",
      away: 0,
      in: "body",
    });
    expect(where("T3")).toMatchObject({
      para: host.ordinalOf("T3A"),
      through: host.ordinalOf("T3C"),
      quote: "foxtrot.…T3C Last span",
      vs: "before",
    });
    expect(where("T5")).toMatchObject({
      quote: "",
      point: true,
      after: "comment after kilo",
    });
    expect(where("T14")).toMatchObject({ multi_cell: true });
    expect(JSON.stringify(where("T1"))).not.toContain("\u0005");
  });

  it.each(HOSTS)(
    "knows coordinates without exact anchors, never offsets, on %s",
    async (h) => {
      host = installWordCommentHost({ host: h });
      const result = await readWordComments({ now: host.now });
      if (!result.ok) throw new Error(result.error);
      const t3 = result.threads.find((t) => t.id === host.commentId("T3"))!;
      expect(wordCommentCoordinates(t3)).toEqual({
        first: host.ordinalOf("T3A"),
        last: host.ordinalOf("T3C"),
        start: null,
        end: null,
        point: false,
      });
      const t5 = result.threads.find((t) => t.id === host.commentId("T5"))!;
      expect(wordCommentCoordinates(t5).point).toBe(true);
      const t5Where = wordCommentWhere(t5, { pos: 5, in: "body" });
      expect(t5Where).toMatchObject({ quote: "", point: true });
    },
  );
});
