import { describe, expect, it } from "vitest";

import {
  selectionSnapshot,
  storyFacts,
  threadMap,
  validationContext,
} from "../../../test/mocks/word/commentDrafts";
import {
  parseWordCommentChanges,
  validateWordCommentChanges,
  wordCommentEdgePiece,
  wordCommentLabelPrefix,
  wordSelectionCommentable,
} from "../wordCommentChanges";

import type { WordCommentValidationContext } from "../wordCommentChanges";

const THREADS = threadMap(
  {
    ref: "t7k",
    id: "101",
    replies: [
      { id: "102", author: "Jonas Weber", email: "jonas@contoso.test" },
    ],
  },
  { ref: "t2p", id: "201", resolved: true, replies: [] },
  { ref: "t9m", id: "301", replies: null },
  { ref: "t4r", id: "401", readOnly: "replies-repeated", replies: [] },
);

function validate(
  input: unknown,
  overrides: Partial<WordCommentValidationContext> = {},
) {
  const ctx = validationContext({ threads: THREADS, ...overrides });
  const parsed = parseWordCommentChanges(input, ctx.rowCap);
  if (!parsed.ok) return { ok: false as const, errors: parsed.errors };
  return validateWordCommentChanges(parsed, ctx);
}

const codes = (result: ReturnType<typeof validate>) =>
  result.ok ? [] : result.errors.map((e) => e.code);

const STORY = storyFacts([
  "Intro paragraph.",
  "Payment within net 30 days, and net 30 days again.",
  "Lieferung binnen 14 Tagen.",
  "Third part ends here.",
]);

describe("parseWordCommentChanges", () => {
  it("takes one action class per submission", () => {
    expect(
      codes(
        validate({
          changes: [
            { op: "reply", thread: "t7k", text: "Ok." },
            { op: "edit", target: "t7k", text: "New." },
          ],
        }),
      ),
    ).toEqual(["mixed-action-classes"]);
  });

  it("caps rows per class from config", () => {
    const changes = Array.from({ length: 3 }, () => ({
      op: "resolve",
      thread: "t7k",
    }));
    expect(codes(validate({ changes }, { rowCap: () => 2 }))).toEqual([
      "too-many-rows",
    ]);
  });

  it("rejects fields another op owns, unknown fields and a missing changes array", () => {
    expect(
      codes(
        validate({ changes: [{ op: "resolve", thread: "t7k", text: "x" }] }),
      ),
    ).toEqual(["invalid-change"]);
    expect(
      codes(
        validate({ changes: [{ op: "resolve", thread: "t7k", author: "x" }] }),
      ),
    ).toEqual(["invalid-change"]);
    expect(codes(validate({ change: [] }))).toEqual(["invalid-change"]);
    expect(codes(validate({ changes: [] }))).toEqual(["invalid-change"]);
  });

  it("takes the strict schema's nulls as absent", () => {
    const result = validate({
      changes: [
        {
          op: "resolve",
          thread: "t7k",
          anchor: null,
          target: null,
          text: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe("texts", () => {
  it.each([
    ["", "empty-text"],
    ["   \n ", "empty-text"],
    ["a".repeat(2001), "invalid-text"],
    ["bell\u0007", "invalid-text"],
    ["mark\u0005", "invalid-text"],
    ["Erato AI: already labelled", "label-in-text"],
    ["erato: an older label", "label-in-text"],
  ])("refuses %j with %s", (text, code) => {
    expect(
      codes(validate({ changes: [{ op: "reply", thread: "t7k", text }] })),
    ).toEqual([code]);
  });

  it("keeps line breaks and tabs, trims, and prepends the label to replies", () => {
    const result = validate({
      changes: [
        { op: "reply", thread: "t7k", text: "  Line one\n\tLine two " },
      ],
    });
    expect(result.ok && result.draft.rows[0]).toMatchObject({
      text: "Line one\n\tLine two",
      finalText: "Erato AI: Line one\n\tLine two",
      labelled: true,
    });
  });

  it("writes no label where the deployment set none", () => {
    const result = validate(
      { changes: [{ op: "reply", thread: "t7k", text: "Ok." }] },
      { label: "" },
    );
    expect(result.ok && result.draft.rows[0]).toMatchObject({
      finalText: "Ok.",
      labelled: false,
    });
  });

  it("keeps an edited item's label state", () => {
    const threads = threadMap(
      { ref: "t1a", id: "1", content: "Erato AI: old text", replies: [] },
      { ref: "t1b", id: "2", content: "Plain human text", replies: [] },
    );
    const result = validate(
      {
        changes: [
          { op: "edit", target: "t1a", text: "new text" },
          { op: "edit", target: "t1b.0", text: "other text" },
        ],
      },
      { threads },
    );
    expect(result.ok && result.draft.rows.map((r) => r.finalText)).toEqual([
      "Erato AI: new text",
      "other text",
    ]);
  });

  it("matches labels regardless of case", () => {
    expect(wordCommentLabelPrefix("ERATO AI: x", "Erato AI:")).toBe(
      "ERATO AI:",
    );
    expect(wordCommentLabelPrefix("Eratosthenes said", "Erato AI:")).toBeNull();
  });
});

describe("refs", () => {
  it("names unknown refs and raw ids", () => {
    expect(
      codes(validate({ changes: [{ op: "resolve", thread: "t00" }] })),
    ).toEqual(["unknown-ref"]);
    expect(
      codes(validate({ changes: [{ op: "resolve", thread: "101" }] })),
    ).toEqual(["unknown-ref"]);
    expect(
      codes(
        validate({ changes: [{ op: "edit", target: "t7k.5", text: "x" }] }),
      ),
    ).toEqual(["unknown-ref"]);
  });

  it.each(["reply", "resolve", "reopen"])(
    "refuses a reply ref for %s",
    (op) => {
      expect(
        codes(
          validate({
            changes: [
              { op, thread: "t7k.1", ...(op === "reply" ? { text: "x" } : {}) },
            ],
          }),
        ),
      ).toEqual(["reply-ref-for-reply"]);
    },
  );

  it("refuses read-only threads", () => {
    expect(
      codes(validate({ changes: [{ op: "resolve", thread: "t4r" }] })),
    ).toEqual(["thread-read-only"]);
  });

  it("needs a thread's replies before a respond or a thread delete, not before an edit", () => {
    expect(
      codes(validate({ changes: [{ op: "resolve", thread: "t9m" }] })),
    ).toEqual(["thread-not-read"]);
    expect(
      codes(validate({ changes: [{ op: "delete", target: "t9m" }] })),
    ).toEqual(["thread-not-read"]);
    expect(
      validate({ changes: [{ op: "edit", target: "t9m", text: "x" }] }).ok,
    ).toBe(true);
  });

  it("targets the thread's comment or one reply for edits and deletes", () => {
    const result = validate({
      changes: [
        { op: "edit", target: "t7k.1", text: "x" },
        { op: "delete", target: "t2p" },
      ],
    });
    expect(
      result.ok &&
        result.draft.rows.map((r) => [r.entry?.n, r.entry?.fingerprint.id]),
    ).toEqual([
      [1, "102"],
      [0, "201"],
    ]);
  });
});

describe("rows on one thread", () => {
  it("needs reopen right before a reply to a resolved thread", () => {
    expect(
      codes(validate({ changes: [{ op: "reply", thread: "t2p", text: "x" }] })),
    ).toEqual(["reopen-first"]);
    const result = validate({
      changes: [
        { op: "reopen", thread: "t2p" },
        { op: "reply", thread: "t2p", text: "x" },
      ],
    });
    expect(result.ok && result.draft.rows[1].dependsOn).toBe(0);
  });

  it("lets reply then resolve depend on each other", () => {
    const result = validate({
      changes: [
        { op: "resolve", thread: "t2p" },
        { op: "reply", thread: "t7k", text: "Done." },
        { op: "resolve", thread: "t7k" },
      ],
    });
    expect(result.ok && result.draft.rows.map((r) => r.dependsOn)).toEqual([
      undefined,
      undefined,
      1,
    ]);
  });

  it.each([
    [["resolve", "reply"]],
    [["reply", "reply"]],
    [["resolve", "reopen"]],
    [["reopen", "reply", "resolve"]],
  ])("refuses %j on one thread", (ops) => {
    expect(
      codes(
        validate({
          changes: ops.map((op) => ({
            op,
            thread: "t7k",
            ...(op === "reply" ? { text: "x" } : {}),
          })),
        }),
      ),
    ).toEqual(["duplicate-target"]);
  });

  it("refuses a thread delete together with another change to it, and the same target twice", () => {
    expect(
      codes(
        validate({
          changes: [
            { op: "delete", target: "t7k" },
            { op: "edit", target: "t7k.1", text: "x" },
          ],
        }),
      ),
    ).toEqual(["duplicate-target"]);
    expect(
      codes(
        validate({
          changes: [
            { op: "edit", target: "t7k", text: "a" },
            { op: "edit", target: "t7k.0", text: "b" },
          ],
        }),
      ),
    ).toEqual(["duplicate-target"]);
  });
});

describe("add anchors", () => {
  const add = (
    anchor: unknown,
    overrides: Partial<WordCommentValidationContext> = {},
  ) =>
    validate(
      { changes: [{ op: "add", anchor, text: "Check this." }] },
      {
        story: STORY,
        ...overrides,
      },
    );

  it("places a unique quote in paragraph.text offsets", () => {
    const result = add({ para: 3, quote: "binnen 14 Tagen" });
    expect(result.ok && result.draft.rows[0]).toMatchObject({
      finalText: "Erato AI: Check this.",
      add: {
        kind: "quote",
        start: 10,
        end: 25,
        para: 3,
        through: null,
        rangeTexts: ["Lieferung binnen 14 Tagen."],
        excerpt: { before: "Lieferung ", text: "binnen 14 Tagen", after: "." },
      },
    });
  });

  it("needs occurrence for a repeated quote, and never moves to another one", () => {
    expect(codes(add({ para: 2, quote: "net 30 days" }))).toEqual([
      "quote-ambiguous",
    ]);
    const second = add({ para: 2, quote: "net 30 days", occurrence: 2 });
    expect(second.ok && second.draft.rows[0].add).toMatchObject({
      start: 32,
      end: 43,
    });
    expect(
      codes(add({ para: 2, quote: "net 30 days", occurrence: 3 })),
    ).toEqual(["quote-not-found"]);
  });

  it("does no fuzzy matching", () => {
    expect(codes(add({ para: 3, quote: "binnen 14 tagen" }))).toEqual([
      "quote-not-found",
    ]);
    expect(codes(add({ para: 2, quote: "binnen 14 Tagen" }))).toEqual([
      "quote-not-found",
    ]);
  });

  it("maps a quote past the web's comment marks into paragraph.text", () => {
    const story = storyFacts([
      { text: "Alpha beta gamma.", rangeText: "Alpha\u0005 beta gamma." },
    ]);
    const result = add(
      { para: 1, quote: "beta" },
      { story, host: "OfficeOnline" },
    );
    expect(result.ok && result.draft.rows[0].add).toMatchObject({
      start: 7,
      end: 11,
    });
  });

  it("refuses a quote in a paragraph whose views disagree, offering the whole paragraph", () => {
    const story = storyFacts([
      { text: "Kept text.", rangeText: "Kept deleted text." },
    ]);
    const result = add({ para: 1, quote: "Kept" }, { story });
    expect(codes(result)).toEqual(["position-unknown"]);
    expect(!result.ok && result.errors[0].message).toContain('{"para": 1}');
  });

  const capturedAll = (story: typeof STORY) =>
    new Map(
      story.entries.map((entry, i) => [
        i + 1,
        { uniqueLocalId: entry.id, text: entry.text },
      ]),
    );

  it("takes a whole paragraph only where the document read captured it", () => {
    expect(codes(add({ para: 4 }))).toEqual(["position-unknown"]);
    expect(codes(add({ para: 2, through: 4 }))).toEqual(["position-unknown"]);
  });

  it("takes a whole paragraph, and refuses an empty one", () => {
    const result = add({ para: 4 }, { captured: capturedAll(STORY) });
    expect(result.ok && result.draft.rows[0].add).toMatchObject({
      kind: "paragraph",
      start: 0,
      end: 21,
    });
    expect(
      codes(
        add(
          { para: 1 },
          {
            story: storyFacts(["", "x"]),
            captured: capturedAll(storyFacts(["", "x"])),
          },
        ),
      ),
    ).toEqual(["unsupported-anchor"]);
  });

  it("spans paragraphs from the start of the quote to its end", () => {
    const result = add({
      para: 2,
      through: 4,
      quote: "net 30 days, and…ends here",
    });
    expect(result.ok && result.draft.rows[0].add).toMatchObject({
      start: 15,
      end: 20,
      through: 4,
    });
    expect(codes(add({ para: 2, through: 4, quote: "net 30 days" }))).toEqual([
      "invalid-change",
    ]);
  });

  it("keeps a table comment inside one cell", () => {
    const story = storyFacts([
      { text: "Cell one.", nesting: 1 },
      { text: "Cell two.", nesting: 1 },
    ]);
    expect(
      codes(
        add({ para: 1, through: 2 }, { story, captured: capturedAll(story) }),
      ),
    ).toEqual(["unsupported-anchor"]);
    const one = add({ para: 1, quote: "one" }, { story });
    expect(one.ok && one.draft.rows[0].add?.inTable).toBe(true);
  });

  it("refuses a paragraph that changed since the capture read it", () => {
    const captured = new Map([
      [3, { uniqueLocalId: "P3", text: "Lieferung binnen 10 Tagen." }],
    ]);
    expect(codes(add({ para: 3, quote: "binnen" }, { captured }))).toEqual([
      "paragraph-changed",
    ]);
  });

  it("follows a captured paragraph's id when paragraphs moved", () => {
    const captured = new Map([
      [2, { uniqueLocalId: "P3", text: "Lieferung binnen 14 Tagen." }],
    ]);
    const result = add({ para: 2, quote: "binnen" }, { captured });
    expect(result.ok && result.draft.rows[0].add?.rangeTexts).toEqual([
      "Lieferung binnen 14 Tagen.",
    ]);
  });

  it("refuses a quote the web's search cannot take", () => {
    const long = `${"word ".repeat(60)}end`;
    const story = storyFacts([long]);
    expect(
      codes(
        add(
          { para: 1, quote: long.slice(0, 280) },
          { story, host: "OfficeOnline" },
        ),
      ),
    ).toEqual(["position-unknown"]);
    expect(add({ para: 1, quote: long.slice(0, 280) }, { story }).ok).toBe(
      true,
    );
  });

  it("anchors on the captured selection and names when there is none", () => {
    const selection = selectionSnapshot(STORY, 2, 2, 10, 25);
    const result = add("selection", { selection });
    expect(result.ok && result.draft.rows[0].add).toMatchObject({
      kind: "selection",
      start: 10,
      end: 25,
      para: 3,
    });
    expect(
      add(
        {
          selection: true,
          para: null,
          through: null,
          quote: null,
          occurrence: null,
        },
        { selection },
      ).ok,
    ).toBe(true);
    expect(codes(add("selection"))).toEqual(["selection-unavailable"]);
  });

  it("does not let rewrite hazards stop a comment, but does stop other stories and whole tables", () => {
    const hazard = selectionSnapshot(STORY, 2, 2, 10, 25, {
      role: "context_only",
      reasonCode: "hyperlink",
    });
    expect(wordSelectionCommentable(hazard)).not.toBeNull();
    expect(
      wordSelectionCommentable(
        selectionSnapshot(STORY, 2, 2, 10, 25, { story: "header" }),
      ),
    ).toBeNull();
    expect(
      wordSelectionCommentable(
        selectionSnapshot(STORY, 2, 2, 10, 25, { shape: "table" }),
      ),
    ).toBeNull();
    expect(
      wordSelectionCommentable(selectionSnapshot(STORY, 2, 2, 10, 10)),
    ).toBeNull();
  });
});

describe("wordCommentEdgePiece", () => {
  it("takes a searchable piece at each edge, or the paragraph edge itself", () => {
    expect(wordCommentEdgePiece("abc def", 0, 7, "start")).toEqual({
      start: 0,
      end: 0,
    });
    expect(wordCommentEdgePiece("abc def", 4, 7, "start")).toEqual({
      start: 4,
      end: 7,
    });
    expect(wordCommentEdgePiece("abc\tdef", 0, 5, "end")).toEqual({
      start: 4,
      end: 5,
    });
    expect(wordCommentEdgePiece("abc\tdef", 0, 4, "end")).toBeNull();
  });
});
