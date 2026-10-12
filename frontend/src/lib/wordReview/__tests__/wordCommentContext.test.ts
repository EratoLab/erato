import { describe, expect, it } from "vitest";

import {
  isWordCommentEntryRef,
  isWordCommentThreadRef,
  parseWordCommentContext,
  parseWordCommentEnvelope,
  parseWordCommentThread,
  WORD_ANCHORED_COMMENTS_ARG,
  WORD_COMMENT_ARG_MAX_BYTES,
  WORD_COMMENT_MAP_ARG,
  WORD_COMMENT_THREAD_FACET_ID,
  WORD_COMMENTS_JSON_ARG,
  WORD_THREAD_JSON_ARG,
} from "../wordCommentContext";
import { WORD_ACTION_FACET_IDS } from "../wordHistoryNames";

import type {
  WordCommentCoverage,
  WordCommentEnvelope,
  WordCommentMapRow,
  WordCommentThread,
} from "../wordCommentContext";

const above: WordCommentThread = {
  id: "t2p",
  pos: 2,
  status: "open",
  where: {
    para: 5,
    quote: "Zahlungsziel 30 Tage",
    vs: "before",
    away: 7,
    in: "body",
  },
  first_at: "2026-10-10T16:02",
  last_at: "2026-10-10T16:02",
  entries: [
    {
      n: 0,
      by: "Maya Krüger",
      at: "2026-10-10T16:02",
      tz: "unknown",
      age: 8,
      day: "2026-10-10",
      day_uncertain: true,
      text: "Bitte auf 45 Tage ändern.",
    },
  ],
};

const inside: WordCommentThread = {
  id: "t7k",
  pos: 4,
  status: "open",
  where: {
    para: 12,
    quote: "Lieferung binnen 14 Tagen",
    occurrence: 2,
    vs: "inside",
    away: 0,
    in: "body",
    overlaps: ["t9m"],
    marker: 2,
  },
  first_at: "2026-10-02T09:14Z",
  last_at: "2026-10-03T11:02Z",
  entries: [
    {
      n: 0,
      by: "Jonas Weber",
      at: "2026-10-02T09:14Z",
      age: 1,
      day: "2026-10-02",
      text: "Ist 14 Tage realistisch?",
    },
    {
      n: 2,
      by: "Lena Hoffmann",
      me: true,
      label: true,
      likely_erato: true,
      at: "2026-10-03T11:02Z",
      age: 3,
      tie: true,
      day: "2026-10-03",
      text: "Erato AI: Vorschlag: „Lieferung binnen 21 Tagen“.",
      cut: true,
    },
  ],
  omitted_replies: 1,
};

const inCell: WordCommentThread = {
  id: "t9m",
  pos: 5,
  status: "resolved",
  where: {
    para: 14,
    through: 15,
    quote: "2027…2028",
    vs: "overlaps_end",
    away: 0,
    in: { table: 2, row: 3, cell: 1 },
    multi_cell: true,
  },
  first_at: null,
  last_at: null,
  entries: [
    {
      n: 0,
      by: "Maya Krüger",
      at: null,
      age: null,
      day: null,
      same_author_as_root: true,
      text: "Preis prüfen",
    },
  ],
  read_only: true,
  matched_by_content: true,
};

const point: WordCommentThread = {
  id: "t0q",
  pos: 6,
  status: "open",
  where: {
    para: 9,
    quote: "",
    point: true,
    after: "Vertragsbeginn",
    vs: "at_caret",
    in: "body",
    position: "unknown",
    block: "b14",
  },
  first_at: "2026-10-11T07:00:12Z",
  last_at: "2026-10-11T07:00:12Z",
  entries: [
    {
      n: 0,
      by: "Erato",
      likely_erato: true,
      at: "2026-10-11T07:00:12Z",
      age: 9,
      day: "2026-10-11",
      text: "Datum fehlt.",
    },
  ],
};

const rows: WordCommentMapRow[] = [
  {
    id: "t1a",
    sec: "2 Zahlung > 2.1 Fristen",
    para: 2,
    q: "Haftung",
    by: "Jonas Weber",
    st: "resolved",
    r: 1,
    at: "2026-09-29T16:40Z",
    g: "Haftung auf 1 Mio. begrenzen",
  },
  {
    id: "t3x",
    para: 30,
    by: "Maya Krüger",
    st: "open",
    r: null,
    at: null,
  },
];

const coverage = (
  changes: Partial<WordCommentCoverage> = {},
): WordCommentCoverage => ({
  threads_total: 9,
  open: 7,
  resolved: 2,
  sent_full: 2,
  sent_index_only: 0,
  not_shown: 7,
  cut: { texts: 1, replies: 1 },
  complete: false,
  line: "9 comment threads (7 open, 2 resolved): 2 sent, 7 not shown; nearest above ¶5, below ¶18.",
  ...changes,
});

const envelope = (
  changes: Partial<WordCommentEnvelope> = {},
): WordCommentEnvelope => ({
  v: 1,
  scope: "selection",
  now: "2026-10-12T08:30Z",
  user_tz: "Europe/Berlin",
  selection: { para: [12, 13], caret: false },
  coverage: coverage(),
  threads: [inside, inCell],
  index: [],
  ...changes,
});

const selectionEnvelope = envelope();
const threadEnvelope = envelope({
  scope: "thread",
  selection: undefined,
  threads: [above, inside],
  coverage: coverage({ sent_full: 1, not_shown: 8 }),
});
const mapEnvelope = envelope({
  scope: "document",
  selection: undefined,
  threads: [point],
  index: rows,
  coverage: coverage({ sent_full: 1, sent_index_only: 2, not_shown: 6 }),
  legacy: true,
  cursor: "map:2",
});
const readEnvelope = envelope({
  scope: "read",
  threads: [above, point],
  coverage: coverage({ complete: true, not_shown: 0 }),
});

const json = (value: unknown) => JSON.stringify(value);

/** Adds an unknown field to every object, as a later add-in might. */
function withUnknownFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withUnknownFields);
  if (typeof value !== "object" || value === null) return value;
  return {
    ...Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        withUnknownFields(item),
      ]),
    ),
    later_field: { nested: [1, "two"] },
  };
}

describe("word comment context names", () => {
  it("sends the comment thread facet as a Word request", () => {
    expect(WORD_ACTION_FACET_IDS.has(WORD_COMMENT_THREAD_FACET_ID)).toBe(true);
    expect(WORD_COMMENT_THREAD_FACET_ID).toBe("word_comment_thread");
  });

  it("recognises session refs and entry refs only", () => {
    expect(["t7k", "t2p", "t0q", "tzzz"].every(isWordCommentThreadRef)).toBe(
      true,
    );
    expect(
      ["t1", "t1234", "T7K", "t7k.0", "c1", 7, null].some(
        isWordCommentThreadRef,
      ),
    ).toBe(false);
    expect(["t7k.0", "t7k.1", "t7k.12"].every(isWordCommentEntryRef)).toBe(
      true,
    );
    expect(
      ["t7k", "t7k.01", "t7k.-1", "t7k.x"].some(isWordCommentEntryRef),
    ).toBe(false);
  });
});

describe("parseWordCommentContext", () => {
  it("round-trips the selection's anchored comments", () => {
    const summary = parseWordCommentContext({
      selected_text: "Lieferung binnen 14 Tagen",
      [WORD_ANCHORED_COMMENTS_ARG]: json(selectionEnvelope),
    });

    expect(summary).toEqual({
      carrier: "anchored_comments",
      envelope: selectionEnvelope,
      threads: [inside, inCell],
      mapCount: 0,
      notShown: 7,
      selectionThreadCount: 2,
      picked: null,
    });
  });

  it("round-trips a picked thread with the envelope around it", () => {
    const summary = parseWordCommentContext({
      [WORD_THREAD_JSON_ARG]: json(inside),
      [WORD_COMMENTS_JSON_ARG]: json(threadEnvelope),
    });

    expect(summary?.carrier).toBe("word_comment_thread");
    expect(summary?.picked).toEqual(inside);
    expect(summary?.envelope).toEqual(threadEnvelope);
    expect(summary?.threads).toEqual([inside, above]);
    expect(summary?.selectionThreadCount).toBe(1);
    expect(summary?.notShown).toBe(8);
  });

  it("takes a picked thread without its envelope", () => {
    const summary = parseWordCommentContext({
      [WORD_THREAD_JSON_ARG]: json(point),
      [WORD_COMMENTS_JSON_ARG]: "",
    });

    expect(summary).toEqual({
      carrier: "word_comment_thread",
      envelope: null,
      threads: [point],
      mapCount: 0,
      notShown: 0,
      selectionThreadCount: 1,
      picked: point,
    });
  });

  it("round-trips the whole-document comment map", () => {
    const summary = parseWordCommentContext({
      document_text: "[1] Vertrag",
      [WORD_COMMENT_MAP_ARG]: json(mapEnvelope),
    });

    expect(summary?.carrier).toBe("comment_map");
    expect(summary?.envelope).toEqual(mapEnvelope);
    expect(summary?.envelope?.legacy).toBe(true);
    expect(summary?.mapCount).toBe(2);
    expect(summary?.notShown).toBe(6);
    expect(summary?.threads).toEqual([point]);
  });

  it("prefers a thread facet, then anchored comments, then the map", () => {
    const all = {
      [WORD_THREAD_JSON_ARG]: json(inside),
      [WORD_ANCHORED_COMMENTS_ARG]: json(selectionEnvelope),
      [WORD_COMMENT_MAP_ARG]: json(mapEnvelope),
    };
    expect(parseWordCommentContext(all)?.carrier).toBe("word_comment_thread");
    expect(
      parseWordCommentContext({ ...all, [WORD_THREAD_JSON_ARG]: " " })?.carrier,
    ).toBe("anchored_comments");
    expect(
      parseWordCommentContext({
        [WORD_ANCHORED_COMMENTS_ARG]: "",
        [WORD_COMMENT_MAP_ARG]: json(mapEnvelope),
      })?.carrier,
    ).toBe("comment_map");
  });

  it("gives null without comment context", () => {
    expect(parseWordCommentContext(undefined)).toBeNull();
    expect(parseWordCommentContext(null)).toBeNull();
    expect(parseWordCommentContext({ selected_text: "x" })).toBeNull();
    expect(parseWordCommentContext({ [WORD_COMMENT_MAP_ARG]: "" })).toBeNull();
  });

  it.each([
    ["bad JSON", { [WORD_ANCHORED_COMMENTS_ARG]: '{"v":1,' }],
    ["an array", { [WORD_ANCHORED_COMMENTS_ARG]: "[]" }],
    ["a number", { [WORD_COMMENT_MAP_ARG]: "42" }],
    ["JSON null", { [WORD_COMMENT_MAP_ARG]: "null" }],
    [
      "a later version",
      { [WORD_COMMENT_MAP_ARG]: json({ ...mapEnvelope, v: 2 }) },
    ],
    [
      "an unknown scope",
      { [WORD_COMMENT_MAP_ARG]: json({ ...mapEnvelope, scope: "all" }) },
    ],
    [
      "no coverage",
      { [WORD_COMMENT_MAP_ARG]: json({ ...mapEnvelope, coverage: undefined }) },
    ],
    [
      "a coverage count that is not a count",
      {
        [WORD_COMMENT_MAP_ARG]: json({
          ...mapEnvelope,
          coverage: coverage({ not_shown: -1 }),
        }),
      },
    ],
    ["a value that is not a string", { [WORD_ANCHORED_COMMENTS_ARG]: 7 }],
    [
      "a malformed thread beside a valid envelope",
      {
        [WORD_THREAD_JSON_ARG]: json({ ...inside, id: "comment-7" }),
        [WORD_COMMENTS_JSON_ARG]: json(threadEnvelope),
      },
    ],
    [
      "a malformed envelope beside a valid thread",
      {
        [WORD_THREAD_JSON_ARG]: json(inside),
        [WORD_COMMENTS_JSON_ARG]: "{",
      },
    ],
  ])("gives null for %s", (_name, args) => {
    expect(parseWordCommentContext(args)).toBeNull();
  });

  it("gives null for an argument over the cap, counted in UTF-8 bytes", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const padded = (line: string) =>
      json(envelope({ coverage: coverage({ line }) }));
    const base = bytes(padded(""));
    const atCap = padded("x".repeat(WORD_COMMENT_ARG_MAX_BYTES - base));
    expect(bytes(atCap)).toBe(WORD_COMMENT_ARG_MAX_BYTES);

    expect(
      parseWordCommentContext({ [WORD_ANCHORED_COMMENTS_ARG]: atCap }),
    ).not.toBeNull();
    expect(
      parseWordCommentContext({
        [WORD_ANCHORED_COMMENTS_ARG]: padded(
          "x".repeat(WORD_COMMENT_ARG_MAX_BYTES - base + 1),
        ),
      }),
    ).toBeNull();
    const umlauts = padded("ü".repeat(WORD_COMMENT_ARG_MAX_BYTES / 2));
    expect(umlauts.length).toBeLessThan(WORD_COMMENT_ARG_MAX_BYTES);
    expect(
      parseWordCommentContext({ [WORD_ANCHORED_COMMENTS_ARG]: umlauts }),
    ).toBeNull();
  });

  it("ignores unknown fields at every level", () => {
    const summary = parseWordCommentContext({
      [WORD_THREAD_JSON_ARG]: json(withUnknownFields(inside)),
      [WORD_COMMENTS_JSON_ARG]: json(withUnknownFields(threadEnvelope)),
    });

    expect(summary?.picked).toEqual(inside);
    expect(summary?.envelope).toEqual(threadEnvelope);
  });

  it("drops a wrongly typed optional field and keeps its record", () => {
    const parsed = parseWordCommentThread({
      ...inside,
      where: {
        ...inside.where,
        vs: "above",
        occurrence: 0,
        through: 3,
        in: "body",
        overlaps: ["t9m", 4, "comment-2"],
      },
      entries: [
        { ...inside.entries[0], me: "yes", tz: "Europe/Berlin", tie: 1 },
      ],
      omitted_replies: 0,
      read_only: "true",
    });

    expect(parsed).toEqual({
      ...inside,
      where: {
        para: 12,
        quote: "Lieferung binnen 14 Tagen",
        away: 0,
        in: "body",
        overlaps: ["t9m"],
        marker: 2,
      },
      entries: [inside.entries[0]],
      omitted_replies: undefined,
    });
    expect(parsed).not.toHaveProperty("omitted_replies");
    expect(parsed).not.toHaveProperty("read_only");
  });

  it("leaves out an invalid thread, entry or row, not the envelope", () => {
    const parsed = parseWordCommentEnvelope(
      json({
        ...mapEnvelope,
        threads: [
          point,
          { ...above, id: "2" },
          { ...above, status: "done" },
          { ...above, where: { ...above.where, in: { table: 0 } } },
          { ...above, entries: [{ n: 0, by: "Maya" }] },
          {
            ...inside,
            entries: [inside.entries[0], { ...inside.entries[1], age: 0 }],
          },
        ],
        index: [rows[0], { ...rows[1], st: "open?" }, "t3x", { ...rows[1] }],
      }),
    );

    expect(parsed?.threads).toEqual([
      point,
      { ...inside, entries: [inside.entries[0]] },
    ]);
    expect(parsed?.index).toEqual([rows[0], rows[1]]);
  });

  it("reads an unknown reply count as null and drops a negative one", () => {
    const { r: _r, ...uncounted } = rows[0];
    const parsed = parseWordCommentEnvelope({
      ...mapEnvelope,
      index: [uncounted, { ...rows[1], r: -1 }],
      cursor: "",
    });

    expect(parsed?.index).toEqual([{ ...rows[0], r: null }]);
    expect(parsed).not.toHaveProperty("cursor");
  });

  it("reads an entry's missing time fields as unknown", () => {
    const { at: _at, age: _age, day: _day, ...untimed } = above.entries[0];
    const { first_at: _first, last_at: _last, ...thread } = above;

    expect(parseWordCommentThread({ ...thread, entries: [untimed] })).toEqual({
      ...above,
      first_at: null,
      last_at: null,
      entries: [{ ...untimed, at: null, age: null, day: null }],
    });
  });

  it("keeps a selection only when its paragraphs are in order", () => {
    expect(
      parseWordCommentEnvelope({
        ...selectionEnvelope,
        selection: { para: [13, 12], caret: false },
      }),
    ).not.toHaveProperty("selection");
    expect(
      parseWordCommentEnvelope({
        ...selectionEnvelope,
        selection: { para: [12, 12], caret: true },
      })?.selection,
    ).toEqual({ para: [12, 12], caret: true });
  });

  it("reads a word_read_comments result as an object", () => {
    expect(parseWordCommentEnvelope(readEnvelope)).toEqual(readEnvelope);
    expect(parseWordCommentEnvelope(json(readEnvelope))).toEqual(readEnvelope);
  });

  it("never throws", () => {
    const deep = JSON.parse(
      `${"[".repeat(2000)}${"]".repeat(2000)}`,
    ) as unknown;
    const inputs: unknown[] = [
      undefined,
      null,
      0,
      "",
      "{",
      [],
      deep,
      { threads: deep, index: deep, coverage: deep },
      { ...readEnvelope, threads: [null, 1, "t7k", [inside]] },
      Object.create(null),
    ];
    for (const input of inputs) {
      expect(() => parseWordCommentEnvelope(input)).not.toThrow();
      expect(() => parseWordCommentThread(input)).not.toThrow();
      expect(() =>
        parseWordCommentContext({
          [WORD_THREAD_JSON_ARG]: input,
          [WORD_ANCHORED_COMMENTS_ARG]: input,
        }),
      ).not.toThrow();
    }
  });
});
