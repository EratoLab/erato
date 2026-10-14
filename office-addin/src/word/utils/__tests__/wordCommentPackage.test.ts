import { describe, expect, it } from "vitest";

import {
  V3C_ANCHORS,
  V3C_COMMENTS,
  v3cCommentId,
  v3cParagraphPackage,
  v3cRangePackage,
  v3cRangeText,
  v3cRowPackage,
  v3cVisibleText,
} from "../../../test/mocks/word/commentPackages";
import {
  joinWordCommentSpansByContent,
  readWordCommentParagraphPackage,
  readWordCommentRangePackage,
  wordCommentAnchorText,
  wordCommentSourceBetween,
  wordCommentTextSpan,
  wordParagraphViewFromText,
} from "../wordCommentPackage";

import type {
  V3cHost,
  V3cPackageOptions,
} from "../../../test/mocks/word/commentPackages";
import type {
  WordCommentPackageRead,
  WordCommentSpan,
  WordParagraphView,
} from "../wordCommentPackage";

const HOSTS: readonly V3cHost[] = ["desktop", "web"];

const texts = (tag: string, host: V3cHost) => ({
  rangeText: v3cRangeText(tag, host),
  identityText: v3cVisibleText(tag),
});

function readParagraph(
  tag: string,
  host: V3cHost,
  options: V3cPackageOptions = {},
): WordCommentPackageRead {
  const read = readWordCommentParagraphPackage(
    v3cParagraphPackage(tag, options),
    texts(tag, host),
  );
  if (!read) throw new Error(`${tag} did not read`);
  return read;
}

const spanOf = (read: WordCommentPackageRead, key: string): WordCommentSpan => {
  const span = read.spans.find((s) => s.commentId === v3cCommentId(key));
  if (!span) throw new Error(`no span for ${key}`);
  return span;
};

/** A span's visible offsets, as ground-truth.json gives them. */
const visible = (span: WordCommentSpan) => ({
  start: span.start?.visible,
  end: span.end?.visible,
});

const truth = (key: string) => ({
  start: V3C_ANCHORS[key].start,
  end: V3C_ANCHORS[key].end,
});

function anchorOf(read: WordCommentPackageRead, key: string) {
  const { start, end, multiCell } = spanOf(read, key);
  const first = start && read.views[start.paragraph];
  const last = end && read.views[end.paragraph];
  if (!first || !last || start.visible === null || end.visible === null)
    throw new Error(`${key} has no visible offsets`);
  return wordCommentAnchorText(
    wordCommentSourceBetween(
      first,
      start.visible,
      start.paragraph === end.paragraph ? undefined : last,
      end.visible,
      multiCell,
    ),
  );
}

describe("readWordCommentParagraphPackage", () => {
  it.each(HOSTS)(
    "joins T1's root and both reply marks to their Comment ids on %s",
    (host) => {
      const read = readParagraph("T1P", host);
      expect(read.spans.map((s) => [s.wId, s.commentId, s.joinedBy])).toEqual([
        ["0", v3cCommentId("T1"), "durableId"],
        ["1", v3cCommentId("R1a"), "durableId"],
        ["2", v3cCommentId("R1b"), "durableId"],
      ]);
      for (const span of read.spans) expect(visible(span)).toEqual(truth("T1"));
      const root = spanOf(read, "T1");
      expect([
        root.start?.range,
        root.end?.range,
        root.reference?.range,
      ]).toEqual([22, 33, 33]);
      expect(read.views[0]?.visibleText).toBe(v3cVisibleText("T1P"));
    },
  );

  it("names the comments' threads and UTC dates", () => {
    const read = readParagraph("T1P", "web");
    expect(read.comments).toEqual([
      {
        wId: "0",
        commentId: "1332042173",
        parentWId: null,
        dateUtc: "2026-09-03T08:15:30Z",
        content: "T1 root: please check the alpha bravo wording.",
        author: "Maya Krüger",
      },
      expect.objectContaining({
        wId: "1",
        commentId: "123940964",
        parentWId: "0",
        dateUtc: "2026-09-03T09:20:11Z",
        author: "Jonas Weber",
      }),
      expect.objectContaining({
        wId: "2",
        commentId: "1460246645",
        parentWId: "0",
      }),
    ]);
  });

  it("places a resolved thread (T2)", () => {
    const read = readParagraph("T2P", "desktop");
    expect(read.comments.map((c) => c.commentId)).toEqual([
      v3cCommentId("T2"),
      v3cCommentId("R2a"),
    ]);
    expect(visible(spanOf(read, "T2"))).toEqual(truth("T2"));
  });

  it("keeps a formatted comment's text, link included (T11)", () => {
    const read = readParagraph("T11P", "desktop");
    expect(read.comments[0].content).toBe(V3C_COMMENTS.T11.content);
    expect(visible(spanOf(read, "T11"))).toEqual(truth("T11"));
  });

  it("joins through the comment's last paragraph when its text has two", () => {
    const read = readParagraph("T10P", "desktop", { twoParagraphs: ["T10"] });
    expect(read.comments[0]).toMatchObject({
      commentId: v3cCommentId("T10"),
      dateUtc: V3C_COMMENTS.T10.dateUtc,
      content: `First paragraph of the comment.\n${V3C_COMMENTS.T10.content}`,
    });
  });

  describe.each(HOSTS)("on %s", (host) => {
    it.each([false, true])(
      "places T5's point comment (Word's empty range around it: %s), which has no dateUtc",
      (collapsedPoints) => {
        const read = readParagraph("T5P", host, { collapsedPoints });
        const span = spanOf(read, "T5");
        expect(visible(span)).toEqual(truth("T5"));
        expect(span.reference?.visible).toBe(28);
        expect(read.comments[0].dateUtc).toBeNull();
        expect(anchorOf(read, "T5")).toEqual({
          quote: "",
          point: true,
          after: "comment after kilo",
        });
      },
    );

    it("places nested and overlapping anchors (T6, T7, T7b)", () => {
      const read = readParagraph("T6P", host);
      expect(read.spans.map((s) => s.commentId)).toEqual(
        ["T6", "T7", "T7b"].map(v3cCommentId),
      );
      for (const key of ["T6", "T7", "T7b"])
        expect(visible(spanOf(read, key))).toEqual(truth(key));
      expect(anchorOf(read, "T6")).toEqual({
        quote: "lima mike november oscar",
      });
    });

    it("gives the second equal quote occurrence 2 (T8)", () => {
      const read = readParagraph("T8P", host);
      expect(visible(spanOf(read, "T8"))).toEqual(truth("T8"));
      expect(anchorOf(read, "T8")).toEqual({
        quote: "sierra tango",
        occurrence: 2,
      });
    });

    it("counts visible text past another author's tracked deletion (T9)", () => {
      const read = readParagraph("T9P", host);
      const span = spanOf(read, "T9");
      expect(span.wId).toBe("1");
      expect(visible(span)).toEqual(truth("T9"));
      expect(span.start?.range).toBe(33);
      expect(anchorOf(read, "T9")).toEqual({ quote: "uniform victor" });
    });

    it("counts visible text past hidden text (T10)", () => {
      const read = readParagraph("T10P", host);
      const span = spanOf(read, "T10");
      expect(visible(span)).toEqual(truth("T10"));
      expect(span.start?.range).toBe(host === "web" ? 19 : 12);
    });

    it("finds no marks of a comment that spans paragraphs in an end paragraph's own package (T3)", () => {
      for (const tag of ["T3A", "T3C"]) {
        const read = readParagraph(tag, host);
        expect(read.spans).toEqual([]);
        expect(read.comments).toEqual([]);
      }
    });

    it("leaves a span open where its other end lies outside the package", () => {
      const first = spanOf(
        readParagraph("T3A", host, { openMarks: true }),
        "T3",
      );
      expect(first.start).toEqual({ paragraph: 0, range: 25, visible: 25 });
      expect([first.end, first.reference]).toEqual([null, null]);
      const last = spanOf(
        readParagraph("T3C", host, { openMarks: true }),
        "T3",
      );
      expect(last.start).toBeNull();
      expect(last.end).toEqual({ paragraph: 0, range: 13, visible: 13 });
    });
  });

  it("offsets web paragraph.text past U+0005 at the end of and inside nested ranges", () => {
    const read = readParagraph("T6P", "web");
    const range = (key: string) => [
      spanOf(read, key).start?.range,
      spanOf(read, key).end?.range,
    ];
    expect(range("T7")).toEqual([17, 30]);
    expect(range("T6")).toEqual([12, 37]);
    expect(range("T7b")).toEqual([32, 50]);
    expect(v3cRangeText("T6P", "web").slice(12, 37)).toBe(
      "lima mike november\u0005 oscar",
    );
  });

  it("reads a page break as one character or none, as the identity text decides", () => {
    for (const rangeText of [
      v3cRangeText("PB1", "desktop"),
      v3cRangeText("PB1", "desktop").replace("break ", "break \f"),
    ]) {
      const read = readWordCommentParagraphPackage(v3cParagraphPackage("PB1"), {
        rangeText,
        identityText: v3cVisibleText("PB1"),
      });
      expect(read && visible(spanOf(read, "PB1"))).toEqual(truth("PB1"));
    }
  });

  describe("table cells", () => {
    it("picks the cell's paragraph out of desktop's whole-row package (T4)", () => {
      const row = v3cRowPackage(["T4C", "CI1"]);
      const t4 = readWordCommentParagraphPackage(row, {
        ...texts("T4C", "desktop"),
        cellIndex: 0,
        inCell: true,
      });
      expect(t4 && visible(spanOf(t4, "T4"))).toEqual(truth("T4"));
      const ci1 = readWordCommentParagraphPackage(row, {
        ...texts("CI1", "desktop"),
        cellIndex: 1,
        inCell: true,
      });
      expect(ci1?.spans).toEqual([]);
      expect(ci1?.views[0]?.visibleText).toBe(v3cVisibleText("CI1"));
    });

    it("reads the web's cell package, which is the paragraph alone (T4)", () => {
      const read = readWordCommentParagraphPackage(v3cParagraphPackage("T4C"), {
        ...texts("T4C", "web"),
        cellIndex: 0,
        inCell: true,
      });
      expect(read && visible(spanOf(read, "T4"))).toEqual(truth("T4"));
    });

    it("picks the cell's paragraph itself where paragraph.text shows a tracked deletion", () => {
      const read = readWordCommentParagraphPackage(
        v3cRowPackage(["T9P", "CI1"]),
        { ...texts("T9P", "desktop"), cellIndex: 0, inCell: true },
      );
      expect(read && visible(spanOf(read, "T9"))).toEqual(truth("T9"));
    });

    it("refuses a row package without a cell index", () => {
      expect(
        readWordCommentParagraphPackage(
          v3cRowPackage(["T4C", "CI1"]),
          texts("T4C", "desktop"),
        ),
      ).toBeNull();
    });
  });

  describe("when the views cannot be mapped", () => {
    it("keeps the join but no offsets", () => {
      const read = readWordCommentParagraphPackage(v3cParagraphPackage("T1P"), {
        rangeText: "T1P Thread one anchor alpha bravo charlie, edited.",
      });
      expect(read?.views).toEqual([null]);
      const span = read && spanOf(read, "T1");
      expect(span?.start).toEqual({ paragraph: 0, range: null, visible: null });
    });

    it("refuses a visible view that does not spell the identity text", () => {
      const read = readWordCommentParagraphPackage(v3cParagraphPackage("T1P"), {
        rangeText: v3cRangeText("T1P", "desktop"),
        identityText: "T1P Thread one anchor alpha bravo charlie!",
      });
      expect(read?.views).toEqual([null]);
    });

    it("returns null for a package it cannot parse", () => {
      expect(
        readWordCommentParagraphPackage("<pkg:package>", { rangeText: "" }),
      ).toBeNull();
    });
  });

  it("names a legacy file's comments by the ids its package carries, with no dateUtc and no parents (gate F2)", () => {
    const sessionIds = (key: string) =>
      ({ T1: "00000101", R1a: "00000102", R1b: "00000103" })[key] ?? "0";
    const read = readParagraph("T1P", "web", { legacy: true, sessionIds });
    expect(read.spans.map((s) => [s.commentId, s.joinedBy])).toEqual([
      ["257", "durableId"],
      ["258", "durableId"],
      ["259", "durableId"],
    ]);
    expect(read.comments.every((c) => c.dateUtc === null)).toBe(true);
    expect(read.comments.map((c) => c.parentWId)).toEqual([null, null, null]);
  });

  describe("packages without commentsIds", () => {
    const listed = [
      {
        id: "901",
        content: V3C_COMMENTS.T1.content,
        rangeText: "alpha bravo\u0005",
      },
      { id: "902", content: V3C_COMMENTS.R1a.content },
      { id: "903", content: V3C_COMMENTS.R1b.content.replace(" ", "\r") },
    ];

    it("joins none of its marks", () => {
      const read = readParagraph("T1P", "web", { idless: true });
      expect(read.spans.map((s) => [s.commentId, s.joinedBy])).toEqual([
        [null, null],
        [null, null],
        [null, null],
      ]);
      expect(read.comments.every((c) => c.dateUtc === null)).toBe(true);
      expect(read.comments.map((c) => c.parentWId)).toEqual([null, null, null]);
    });

    it("joins each mark by content and anchored text, marked as content", () => {
      const read = readParagraph("T1P", "web", { idless: true });
      expect(
        joinWordCommentSpansByContent(read, listed).map((s) => [
          s.wId,
          s.commentId,
          s.joinedBy,
        ]),
      ).toEqual([
        ["0", "901", "content"],
        ["1", "902", "content"],
        ["2", "903", "content"],
      ]);
    });

    it("pairs equal comments in document order, and leaves uneven groups unjoined", () => {
      const read = readParagraph("T6P", "desktop", { idless: true });
      const same = (span: WordCommentSpan) => ({
        ...read,
        comments: read.comments.map((c) => ({ ...c, content: "Same." })),
        spans: [span],
      });
      const t6 = read.spans[0];
      expect(
        joinWordCommentSpansByContent(same(t6), [
          { id: "a", content: "Same.", rangeText: "lima mike november oscar" },
        ])[0].commentId,
      ).toBe("a");
      const all = {
        ...read,
        comments: read.comments.map((c) => ({ ...c, content: "Same." })),
      };
      expect(
        joinWordCommentSpansByContent(all, [
          { id: "a", content: "Same." },
          { id: "b", content: "Same." },
        ]).map((s) => s.commentId),
      ).toEqual([null, null, null]);
      expect(
        joinWordCommentSpansByContent(all, [
          { id: "a", content: "Same." },
          { id: "b", content: "Same." },
          { id: "c", content: "Same." },
        ]).map((s) => s.commentId),
      ).toEqual(["a", "b", "c"]);
    });

    it("refuses a pair whose anchored text differs", () => {
      const read = readParagraph("T1P", "desktop", { idless: true });
      const joined = joinWordCommentSpansByContent(read, [
        { ...listed[0], rangeText: "charlie" },
        listed[1],
        listed[2],
      ]);
      expect(joined.map((s) => s.commentId)).toEqual([null, "902", "903"]);
    });

    it("without a document order, pairs only unique matches, told apart by author too", () => {
      const read = readParagraph("T6P", "desktop", { idless: true });
      const all = {
        ...read,
        comments: read.comments.map((c) => ({ ...c, content: "Same." })),
      };
      // T6, T7 and T7b have three authors.
      const authors = all.comments.map((c) => c.author);
      const listedAs = (by: (i: number) => string) =>
        ["a", "b", "c"].map((id, i) => ({
          id,
          content: "Same.",
          author: by(i),
        }));

      expect(
        joinWordCommentSpansByContent(
          all,
          listedAs(() => authors[0]),
          { ordered: false },
        ).map((s) => s.commentId),
      ).toEqual([null, null, null]);
      expect(
        joinWordCommentSpansByContent(
          all,
          listedAs((i) => authors[i]),
          { ordered: false },
        ).map((s) => [s.commentId, s.joinedBy]),
      ).toEqual([
        ["a", "content"],
        ["b", "content"],
        ["c", "content"],
      ]);
    });

    it("joins nothing a durableId already joined", () => {
      const read = readParagraph("T1P", "desktop");
      expect(joinWordCommentSpansByContent(read, listed)).toEqual(read.spans);
    });
  });
});

describe("readWordCommentRangePackage", () => {
  it("places a comment across three paragraphs from the range's package (T3)", () => {
    const read = readWordCommentRangePackage(
      v3cRangePackage(["T3A", "T3B", "T3C"]),
      ["T3A", "T3B", "T3C"].map((tag) => texts(tag, "desktop")),
    );
    const span = read && spanOf(read, "T3");
    expect(span).toMatchObject({
      start: { paragraph: 0, range: 25, visible: 25 },
      end: { paragraph: 2, range: 13, visible: 13 },
      multiCell: false,
    });
    expect(read && anchorOf(read, "T3")).toEqual({
      quote: "foxtrot.…T3C Last span",
    });
  });

  it("places a comment across two cells and flags it multi-cell (T14)", () => {
    const read = readWordCommentRangePackage(
      v3cRowPackage(["XC1", "XC2"]),
      ["XC1", "XC2"].map((tag) => ({ ...texts(tag, "desktop"), inCell: true })),
    );
    const span = read && spanOf(read, "T14");
    expect(span && visible(span)).toEqual(truth("T14"));
    expect(span?.multiCell).toBe(true);
    expect(read && anchorOf(read, "T14")).toEqual({
      quote: "start sigma…XC2 Cross cell end",
      multi_cell: true,
    });
  });

  it("refuses a package whose paragraphs are not the range's", () => {
    const ooxml = v3cRangePackage(["T3A", "T3B", "T3C"]);
    expect(
      readWordCommentRangePackage(
        ooxml,
        ["T3A", "T3C"].map((tag) => texts(tag, "desktop")),
      ),
    ).toBeNull();
    expect(
      readWordCommentRangePackage(
        ooxml,
        ["T3A", "T3B", "T3C", "CI1"].map((tag) => texts(tag, "desktop")),
      ),
    ).toBeNull();
    expect(
      readWordCommentRangePackage(
        ooxml,
        ["T2P", "T3A", "T3B"].map((tag) => texts(tag, "desktop")),
      ),
    ).toBeNull();
  });
});

describe("wordCommentTextSpan", () => {
  const T3 = "foxtrot.\rT3B Middle span paragraph golf.\rT3C Last span";

  it.each(HOSTS)("finds T3's ends from its range text on %s", (host) => {
    const text = host === "web" ? `${T3}\u0005` : T3;
    expect(
      wordCommentTextSpan(
        text,
        v3cRangeText("T3A", host),
        v3cRangeText("T3C", host),
      ),
    ).toEqual({ start: 25, end: 13 });
  });

  it.each([
    ["web", "start sigma\rXC2 Cross cell end\u0005"],
    ["desktop", "start sigma\tXC2 Cross cell end"],
    ["desktop", "start sigma\r\u0007XC2 Cross cell end"],
  ] as const)("finds T14's ends across cells on %s", (host, text) => {
    expect(
      wordCommentTextSpan(
        text,
        v3cRangeText("XC1", host),
        v3cRangeText("XC2", host),
      ),
    ).toEqual({ start: 15, end: 18 });
  });

  it("runs through the last paragraph when the text ends in its paragraph mark", () => {
    const first = "MA1 First words.";
    const last = "MA3 Last words.\u0005";
    expect(
      wordCommentTextSpan(`${first}\rMA2 Middle.\r${last}\r`, first, last),
    ).toEqual({ start: 0, end: last.length - 1 });
    expect(
      wordCommentTextSpan(`${first}\rMA2 Middle.\r`, first, "MA3 Next."),
    ).toEqual({ start: 0, end: 0 });
  });

  it("finds a single paragraph's anchor only when its text is unique there", () => {
    expect(
      wordCommentTextSpan(
        "lima mike november\u0005 oscar\u0005",
        v3cRangeText("T6P", "web"),
      ),
    ).toEqual({ start: 12, end: 37 });
    expect(
      wordCommentTextSpan("sierra tango", v3cRangeText("T8P", "desktop")),
    ).toBeNull();
    expect(wordCommentTextSpan("", v3cRangeText("T5P", "desktop"))).toBeNull();
  });

  it("refuses when the first or last line fits more than one way", () => {
    expect(wordCommentTextSpan("a\ta\tb", "a\ta", "b")).toBeNull();
    expect(wordCommentTextSpan("x\rnope", "x", "y")).toBeNull();
  });
});

describe("the text route", () => {
  const view = (tag: string, host: V3cHost) =>
    wordParagraphViewFromText(texts(tag, host));

  function textSource(
    rangeText: string,
    first: WordParagraphView | null,
    last?: WordParagraphView | null,
    multiCell = false,
  ) {
    if (!first || last === null) throw new Error("no view");
    const span = wordCommentTextSpan(
      rangeText,
      first.rangeText,
      last?.rangeText,
    );
    if (!span) throw new Error("no text span");
    return wordCommentSourceBetween(
      first,
      first.visibleAt[span.start],
      last,
      (last ?? first).visibleAt[span.end],
      multiCell,
    );
  }

  it("places T3 on the web from text alone", () => {
    const source = textSource(
      "foxtrot.\rT3B Middle span paragraph golf.\rT3C Last span\u0005",
      view("T3A", "web"),
      view("T3C", "web"),
    );
    expect(source).toMatchObject({ kind: "paragraphs", start: 25, end: 13 });
    expect(wordCommentAnchorText(source)).toEqual({
      quote: "foxtrot.…T3C Last span",
    });
  });

  it("places T14 across cells on the web", () => {
    const source = textSource(
      "start sigma\rXC2 Cross cell end\u0005",
      view("XC1", "web"),
      view("XC2", "web"),
      true,
    );
    expect(wordCommentAnchorText(source)).toEqual({
      quote: "start sigma…XC2 Cross cell end",
      multi_cell: true,
    });
  });

  it("places a single-paragraph anchor in visible offsets", () => {
    expect(
      textSource("oscar\u0005 papa quebec\u0005", view("T6P", "web")),
    ).toMatchObject({ kind: "paragraph", start: 31, end: 48 });
  });

  it("counts offsets in UTF-16 units past an emoji", () => {
    const rangeText = "Ok \u{1F44D} alpha bravo\u0005 end.";
    const source = textSource(
      "alpha bravo\u0005",
      wordParagraphViewFromText({
        rangeText,
        identityText: "Ok \u{1F44D} alpha bravo end.",
      }),
    );
    expect(source).toMatchObject({ kind: "paragraph", start: 6, end: 17 });
    expect(wordCommentAnchorText(source)).toEqual({ quote: "alpha bravo" });
  });

  it("cannot map a paragraph's views from text alone past a tracked deletion (T9)", () => {
    expect(view("T9P", "desktop")).toBeNull();
  });
});

describe("wordCommentAnchorText", () => {
  it("normalises like the review text and counts occurrences only when the quote repeats", () => {
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "Net 30\u000Bdays and net 30\u000B\u000Bdays.",
        start: 16,
        end: 28,
      }),
    ).toEqual({ quote: "net 30 days" });
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "Net 30 days and Net 30 days.",
        start: 16,
        end: 27,
      }),
    ).toEqual({ quote: "Net 30 days", occurrence: 2 });
  });

  it("trims the anchor's own edge whitespace", () => {
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "ab ab ab.",
        start: 2,
        end: 6,
      }),
    ).toEqual({ quote: "ab", occurrence: 2 });
  });

  it("calls a quote position unknown where Word's search would find another hit", () => {
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "aaa.",
        start: 1,
        end: 3,
      }),
    ).toEqual({ quote: "aa", position: "unknown" });
  });

  it("calls a whitespace-only anchor position unknown", () => {
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "a  b",
        start: 1,
        end: 3,
      }),
    ).toEqual({ quote: "", position: "unknown" });
  });

  it("gives a point comment at a paragraph's start no after", () => {
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: "Text.",
        start: 0,
        end: 0,
      }),
    ).toEqual({ quote: "", point: true });
  });

  it("keeps whole words at a cut end of a multi-paragraph quote", () => {
    expect(
      wordCommentAnchorText(
        {
          kind: "paragraphs",
          first: "Intro. Die Lieferfrist beträgt vier Wochen ab Bestellung.",
          start: 7,
          last: "Danach gilt eine Frist von 14 Tagen. Rest.",
          end: 36,
        },
        { edgeChars: 20 },
      ),
    ).toEqual({ quote: "Die Lieferfrist…Frist von 14 Tagen." });
  });

  it("never leaves half an emoji at a cut end", () => {
    expect(
      wordCommentAnchorText(
        {
          kind: "paragraphs",
          first: "ab\u{1F44D}cd",
          start: 0,
          last: "wx\u{1F44D}yz",
          end: 6,
        },
        { edgeChars: 3 },
      ),
    ).toEqual({ quote: "ab…yz" });
    expect(
      wordCommentAnchorText({
        kind: "paragraph",
        visible: `ab\u{1F44D}${"y".repeat(19)} end.`,
        start: 23,
        end: 23,
      }),
    ).toEqual({ quote: "", point: true, after: "y".repeat(19) });
  });

  it("quotes an unplaced multi-paragraph range by its first and last line", () => {
    expect(
      wordCommentAnchorText({
        kind: "unplaced",
        rangeText:
          "foxtrot.\rT3B Middle span paragraph golf.\rT3C Last span\u0005",
      }),
    ).toEqual({ quote: "foxtrot.…T3C Last span", position: "unknown" });
  });
});
