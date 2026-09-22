import { describe, expect, it } from "vitest";

import {
  buildWordEditReport,
  editExcerpt,
  parseWordEdits,
  planWordEdits,
  verifyWordEdits,
} from "../wordEditPlan";

import type { WordDocumentCapture } from "../wordDocumentCapture";

const capture = (
  paragraphs: { text: string }[],
  paragraphsSent = paragraphs.length,
  partialOrdinal: number | null = null,
): WordDocumentCapture => ({
  identity: "https://contoso.sharepoint.com/report.docx",
  ordinalMap: new Map(
    paragraphs.map((paragraph, index) => [
      index + 1,
      { uniqueLocalId: `id-${index + 1}`, text: paragraph.text },
    ]),
  ),
  paragraphsSent,
  renderedOrdinals: new Set(
    paragraphs
      .map((paragraph, index) => ({ ordinal: index + 1, text: paragraph.text }))
      .filter(
        (entry) =>
          entry.ordinal <= paragraphsSent &&
          entry.text.trim().length > 0 &&
          entry.ordinal !== partialOrdinal,
      )
      .map((entry) => entry.ordinal),
  ),
  partialOrdinal,
});

describe("parseWordEdits", () => {
  it("parses a single edit and a range", () => {
    expect(
      parseWordEdits(
        '{"edits":[{"paragraph":12,"text":"New."},{"paragraph":18,"through":20,"text":"Merged."}]}',
      ),
    ).toEqual([
      { paragraph: 12, text: "New." },
      { paragraph: 18, through: 20, text: "Merged." },
    ]);
  });

  it("treats a still-streaming fence as not yet parseable", () => {
    expect(parseWordEdits('{"edits":[{"paragraph":12,"te')).toBeNull();
  });

  it.each([
    ["not an object", "[]"],
    ["no edits key", '{"changes":[]}'],
    ["an empty list", '{"edits":[]}'],
    ["a missing ordinal", '{"edits":[{"text":"New."}]}'],
    ["a missing text", '{"edits":[{"paragraph":3}]}'],
    ["a non-integer ordinal", '{"edits":[{"paragraph":3.5,"text":"New."}]}'],
    ["a zero ordinal", '{"edits":[{"paragraph":0,"text":"New."}]}'],
    [
      "a descending range",
      '{"edits":[{"paragraph":9,"through":4,"text":"New."}]}',
    ],
  ])("rejects the whole payload for %s", (_name, payload) => {
    expect(parseWordEdits(payload)).toBeNull();
  });

  it("rejects the whole payload when ONE entry is malformed", () => {
    expect(
      parseWordEdits(
        '{"edits":[{"paragraph":1,"text":"Fine."},{"paragraph":2}]}',
      ),
    ).toBeNull();
  });
});

describe("planWordEdits", () => {
  it("maps each edit onto the captured paragraphs", () => {
    const plan = planWordEdits(
      [{ paragraph: 2, text: "Replacement." }],
      capture([{ text: "One." }, { text: "Two." }, { text: "Three." }]),
    );

    expect(plan.rejected).toEqual([]);
    expect(plan.resolved).toHaveLength(1);
    expect(plan.resolved[0].targets).toEqual([
      { ordinal: 2, uniqueLocalId: "id-2", sentText: "Two." },
    ]);
  });

  it("expands a range into every paragraph it covers, ascending", () => {
    const plan = planWordEdits(
      [{ paragraph: 2, through: 4, text: "One paragraph." }],
      capture([
        { text: "One." },
        { text: "Two." },
        { text: "Three." },
        { text: "Four." },
      ]),
    );

    expect(plan.resolved[0].targets.map((target) => target.ordinal)).toEqual([
      2, 3, 4,
    ]);
  });

  it("rejects an ordinal the send never carried, with no fallback search", () => {
    const plan = planWordEdits(
      [
        { paragraph: 4, text: "Never seen." },
        { paragraph: 99, text: "Does not exist." },
      ],
      capture(
        [{ text: "One." }, { text: "Two." }, { text: "Three." }, { text: "" }],
        3,
      ),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.rejected.map((outcome) => outcome.status)).toEqual([
      "unknown-ordinal",
      "unknown-ordinal",
    ]);
  });

  it("rejects an edit that starts on a paragraph that rendered no line", () => {
    const plan = planWordEdits(
      [{ paragraph: 2, text: "Meant for paragraph 3." }],
      capture([{ text: "One." }, { text: "\t" }, { text: "Three." }]),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.rejected[0].status).toBe("unknown-ordinal");
  });

  it("rejects an edit that ENDS on a paragraph that rendered no line", () => {
    const plan = planWordEdits(
      [{ paragraph: 1, through: 2, text: "Merged." }],
      capture([{ text: "One." }, { text: "" }, { text: "Three." }]),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.rejected[0].status).toBe("unknown-ordinal");
  });

  it("keeps a blank paragraph INSIDE a span replaceable", () => {
    const plan = planWordEdits(
      [{ paragraph: 1, through: 3, text: "One paragraph." }],
      capture([{ text: "One." }, { text: "" }, { text: "Three." }]),
    );

    expect(plan.rejected).toEqual([]);
    expect(plan.resolved[0].targets.map((target) => target.ordinal)).toEqual([
      1, 2, 3,
    ]);
  });

  it("refuses to rewrite the paragraph the send could only cut", () => {
    const plan = planWordEdits(
      [{ paragraph: 1, text: "A tightened version of the part I read." }],
      capture([{ text: "A 100 KB wall of text." }], 1, 1),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.rejected[0].status).toBe("partial-ordinal");
  });

  it("rejects a span that swallows the partly-sent paragraph", () => {
    const plan = planWordEdits(
      [{ paragraph: 1, through: 2, text: "Merged." }],
      capture([{ text: "Wall." }, { text: "Next." }], 2, 1),
    );

    expect(plan.rejected[0].status).toBe("partial-ordinal");
  });

  it("rejects a range that runs past the window rather than clipping it", () => {
    const plan = planWordEdits(
      [{ paragraph: 2, through: 5, text: "Merged." }],
      capture([{ text: "a" }, { text: "b" }, { text: "c" }], 3),
    );

    expect(plan.resolved).toEqual([]);
    expect(plan.rejected[0].status).toBe("unknown-ordinal");
  });

  it("rejects a later edit that overlaps an earlier one; earlier wins", () => {
    const plan = planWordEdits(
      [
        { paragraph: 2, through: 3, text: "First." },
        { paragraph: 3, text: "Second." },
      ],
      capture([{ text: "a" }, { text: "b" }, { text: "c" }]),
    );

    expect(plan.resolved.map((edit) => edit.paragraph)).toEqual([2]);
    expect(plan.rejected).toEqual([
      { index: 1, paragraph: 3, status: "overlapping", excerpt: "Second." },
    ]);
  });

  it("orders the plan ascending however the model wrote the list", () => {
    const plan = planWordEdits(
      [
        { paragraph: 3, text: "Third." },
        { paragraph: 1, text: "First." },
      ],
      capture([{ text: "a" }, { text: "b" }, { text: "c" }]),
    );

    expect(plan.resolved.map((edit) => edit.paragraph)).toEqual([1, 3]);
  });
});

describe("verifyWordEdits", () => {
  const threeParagraphs = capture([
    { text: "One." },
    { text: "Two." },
    { text: "Three." },
  ]);

  it("keeps edits whose paragraphs are byte-identical and drops the rest", () => {
    const plan = planWordEdits(
      [
        { paragraph: 1, text: "A." },
        { paragraph: 2, text: "B." },
      ],
      threeParagraphs,
    );

    const verified = verifyWordEdits(
      plan,
      new Map([
        ["id-1", "One."],
        ["id-2", "Two, edited by the user."],
      ]),
    );

    expect(verified.applicable.map((edit) => edit.paragraph)).toEqual([1]);
    expect(verified.skipped).toEqual([
      { index: 1, paragraph: 2, status: "changed", excerpt: "B." },
    ]);
  });

  it.each([
    ["trailing whitespace", "One. "],
    ["leading whitespace", " One."],
    ["a different case", "one."],
    ["a non-breaking space for a space", "One.\u00a0"],
    ["a curly apostrophe for a straight one", "One\u2019s."],
  ])(
    "treats %s as changed — no normalization, no fuzzy match",
    (_name, current) => {
      const plan = planWordEdits(
        [{ paragraph: 1, text: "A." }],
        threeParagraphs,
      );
      const verified = verifyWordEdits(plan, new Map([["id-1", current]]));
      expect(verified.applicable).toEqual([]);
      expect(verified.skipped[0].status).toBe("changed");
    },
  );

  it("treats a paragraph the user deleted as changed, never as applicable", () => {
    const plan = planWordEdits([{ paragraph: 2, text: "B." }], threeParagraphs);
    const verified = verifyWordEdits(plan, new Map([["id-2", null]]));
    expect(verified.applicable).toEqual([]);
    expect(verified.skipped[0].status).toBe("changed");
  });

  it("skips a range when ANY paragraph in it moved", () => {
    const plan = planWordEdits(
      [{ paragraph: 1, through: 3, text: "Merged." }],
      threeParagraphs,
    );
    const verified = verifyWordEdits(
      plan,
      new Map([
        ["id-1", "One."],
        ["id-2", "Two."],
        ["id-3", "Three, edited."],
      ]),
    );
    expect(verified.applicable).toEqual([]);
  });

  it.each([
    ["reordered", ["id-2", "id-1", "id-3"]],
    ["interrupted by a new paragraph", ["id-1", "new-id", "id-2", "id-3"]],
  ])(
    "skips a %s range even when every original text is unchanged",
    (_name, ids) => {
      const plan = planWordEdits(
        [{ paragraph: 1, through: 3, text: "Merged." }],
        threeParagraphs,
      );
      const verified = verifyWordEdits(
        plan,
        new Map([
          ["id-1", "One."],
          ["id-2", "Two."],
          ["id-3", "Three."],
        ]),
        ids,
      );
      expect(verified.applicable).toEqual([]);
      expect(verified.skipped[0].status).toBe("changed");
    },
  );

  it("returns survivors in DESCENDING start order — the application order", () => {
    const plan = planWordEdits(
      [
        { paragraph: 1, text: "A." },
        { paragraph: 2, text: "B." },
        { paragraph: 3, text: "C." },
      ],
      threeParagraphs,
    );
    const verified = verifyWordEdits(
      plan,
      new Map([
        ["id-1", "One."],
        ["id-2", "Two."],
        ["id-3", "Three."],
      ]),
    );

    expect(verified.applicable.map((edit) => edit.paragraph)).toEqual([
      3, 2, 1,
    ]);
  });
});

describe("editExcerpt", () => {
  it("collapses whitespace and keeps a short replacement whole", () => {
    expect(editExcerpt("  Two   words\nhere ")).toBe("Two words here");
  });

  it("cuts a long replacement on a code point, never a surrogate half", () => {
    const excerpt = editExcerpt("😀".repeat(80));
    expect([...excerpt]).toHaveLength(61);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt).not.toContain("�");
  });
});

describe("buildWordEditReport", () => {
  it("reports in the order the model wrote the edits, not the applied order", () => {
    const report = buildWordEditReport([
      { index: 1, paragraph: 5, through: 6, status: "applied", excerpt: "B." },
      { index: 0, paragraph: 1, status: "changed", excerpt: "A." },
    ]);

    expect(report.map((outcome) => outcome.paragraph)).toEqual([1, 5]);
  });

  it("keeps each verdict when two edits name the SAME paragraph", () => {
    const plan = planWordEdits(
      [
        { paragraph: 2, text: "First wins." },
        { paragraph: 2, text: "Second is dropped." },
      ],
      capture([{ text: "a" }, { text: "b" }]),
    );
    const verified = verifyWordEdits(plan, new Map([["id-2", "b"]]));

    const report = buildWordEditReport([
      ...plan.rejected,
      ...verified.skipped,
      ...verified.applicable.map((edit) => ({
        index: edit.index,
        paragraph: edit.paragraph,
        status: "applied" as const,
        excerpt: edit.excerpt,
      })),
    ]);

    expect(report).toHaveLength(2);
    expect(report.map((outcome) => outcome.status)).toEqual([
      "applied",
      "overlapping",
    ]);
  });
});
