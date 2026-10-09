import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  resolveWordParagraphs,
  wordParagraphAnchor,
} from "../wordParagraphResolver";

import type {
  WordParagraphAnchor,
  WordParagraphEntry,
  WordParagraphResolution,
} from "../wordParagraphResolver";

const body = (texts: string[], ids = true): WordParagraphEntry[] =>
  texts.map((text, i) => ({ id: ids ? `id-${i + 1}` : null, text }));
const withoutIds = (entries: WordParagraphEntry[]) =>
  entries.map((p) => ({ ...p, id: null }));

describe("resolveWordParagraphs", () => {
  it.each([true, false])("resolves an unchanged span (IDs: %s)", (ids) => {
    const doc = body(["Intro", "Target", "Outro"], ids);
    expect(resolveWordParagraphs(wordParagraphAnchor(doc, 1, 1), doc)).toEqual({
      positions: [1],
    });
  });

  it.each([true, false])(
    "follows a paragraph inserted above and edits elsewhere (IDs: %s)",
    (ids) => {
      const anchor = wordParagraphAnchor(
        body(["Intro", "Target", "Outro"], ids),
        1,
        1,
      );
      const live = [
        { id: ids ? "new" : null, text: "Added" },
        { id: ids ? "id-1" : null, text: "Intro edited" },
        { id: ids ? "id-2" : null, text: "Target" },
        { id: ids ? "id-3" : null, text: "Outro" },
      ];
      expect(resolveWordParagraphs(anchor, live)).toEqual({ positions: [2] });
    },
  );

  it.each([true, false])("refuses an edited target (IDs: %s)", (ids) => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B"], ids), 1, 1);
    expect(
      resolveWordParagraphs(anchor, body(["A", "Target edited", "B"], ids)),
    ).toEqual({ refused: "changed" });
  });

  it("follows a moved paragraph whose text is unique", () => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B", "C"]), 1, 1);
    const live = [
      { id: "id-1", text: "A" },
      { id: "id-3", text: "B" },
      { id: "id-4", text: "C" },
      { id: "pasted", text: "Target" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({ positions: [3] });
  });

  it("refuses when the target's ID survives with other text, even if a copy keeps the old text", () => {
    const anchor = wordParagraphAnchor(body(["A", "Clause", "B"]), 1, 1);
    const live = [
      { id: "id-1", text: "A" },
      { id: "id-2", text: "Clause, amended" },
      { id: "copy", text: "Clause" },
      { id: "id-3", text: "B" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({ refused: "changed" });
  });

  it("refuses when Word moved the ID to a paragraph inserted after the target", () => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B"]), 1, 1);
    const live = [
      { id: "id-1", text: "A" },
      { id: "fresh", text: "Target" },
      { id: "id-2", text: "Inserted" },
      { id: "id-3", text: "B" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({ refused: "changed" });
  });

  it("refuses when the ID moved onto an identical copy inserted after the target", () => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B"]), 1, 1);
    const live = [
      { id: "id-1", text: "A" },
      { id: "fresh", text: "Target" },
      { id: "id-2", text: "Target" },
      { id: "id-3", text: "B" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({
      refused: "ambiguous",
    });
  });

  it("refuses the first paragraph of a span whose ID moved onto a copy below it", () => {
    const anchor = wordParagraphAnchor(body(["A", "One", "Two", "B"]), 1, 2);
    const live = [
      { id: "id-1", text: "A" },
      { id: "fresh", text: "One" },
      { id: "id-2", text: "One" },
      { id: "id-3", text: "Two" },
      { id: "id-4", text: "B" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({
      refused: "ambiguous",
    });
  });

  it("keeps the ID when the copy goes below the target or the twin above was there at capture", () => {
    const below = wordParagraphAnchor(body(["A", "Target", "B"]), 1, 1);
    expect(
      resolveWordParagraphs(below, [
        { id: "id-1", text: "A" },
        { id: "id-2", text: "Target" },
        { id: "copy", text: "Target" },
        { id: "id-3", text: "B" },
      ]),
    ).toEqual({ positions: [1] });
    const twins = body(["A", "Same", "Same", "B"]);
    expect(
      resolveWordParagraphs(wordParagraphAnchor(twins, 2, 2), twins),
    ).toEqual({ positions: [2] });
  });

  it("refuses an ID that moved onto a copy below a twin that was there at capture", () => {
    const anchor = wordParagraphAnchor(body(["A", "Same", "Same", "B"]), 2, 2);
    const live = [
      { id: "id-1", text: "A" },
      { id: "id-2", text: "Same" },
      { id: "fresh", text: "Same" },
      { id: "id-3", text: "Same" },
      { id: "id-4", text: "B" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({
      refused: "ambiguous",
    });
  });

  it.each(["", "Copy:"])(
    "refuses an ID that moved two paragraphs down onto a copy, past %j",
    (between) => {
      const anchor = wordParagraphAnchor(body(["BK04", "BK05", "BK06"]), 1, 1);
      const live = [
        { id: "id-1", text: "BK04" },
        { id: "y", text: "BK05" },
        { id: "z", text: between },
        { id: "id-2", text: "BK05" },
        { id: "id-3", text: "BK06" },
      ];
      expect(resolveWordParagraphs(anchor, live)).toEqual({
        refused: "ambiguous",
      });
    },
  );

  it("keeps the ID with a twin further up only while the context above is unchanged", () => {
    const doc = body(["Same", "A", "B", "C", "Same", "D"]);
    const anchor = wordParagraphAnchor(doc, 4, 4);
    expect(resolveWordParagraphs(anchor, doc)).toEqual({ positions: [4] });
    expect(
      resolveWordParagraphs(anchor, [
        ...doc.slice(0, 5),
        { id: "copy", text: "Same" },
        doc[5],
      ]),
    ).toEqual({ positions: [4] });
    expect(
      resolveWordParagraphs(anchor, [
        ...doc.slice(0, 3),
        { id: "id-4", text: "C edited" },
        ...doc.slice(4),
      ]),
    ).toEqual({ refused: "ambiguous" });
  });

  it("refuses an ID that two live paragraphs share", () => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B"]), 1, 1);
    const live = [
      { id: "id-1", text: "A" },
      { id: "id-2", text: "Target" },
      { id: "id-3", text: "B" },
      { id: "id-2", text: "Target" },
    ];
    expect(resolveWordParagraphs(anchor, live)).toEqual({
      refused: "ambiguous",
    });
  });

  it("tells repeated text apart by its neighbours when there are no IDs", () => {
    const doc = body(["P", "Same", "N", "Q", "Same", "R"], false);
    const anchor = wordParagraphAnchor(doc, 4, 4);
    expect(anchor.window).toBe(1);
    expect(resolveWordParagraphs(anchor, doc)).toEqual({ positions: [4] });
  });

  it("refuses when a duplicate existed at capture and the original was then deleted", () => {
    const anchor = wordParagraphAnchor(
      body(["P", "Same", "N", "Q", "Same", "R"], false),
      1,
      1,
    );
    const live = withoutIds(body(["P", "N", "Q", "Same", "R"]));
    expect(resolveWordParagraphs(anchor, live)).toEqual({
      refused: "ambiguous",
    });
  });

  it("refuses repeated blocks wider than the kept context", () => {
    const doc = body(
      ["B", "B", "B", "T", "B", "B", "B", "T", "B", "B", "B"],
      false,
    );
    const anchor = wordParagraphAnchor(doc, 3, 3);
    expect(anchor.window).toBeNull();
    expect(resolveWordParagraphs(anchor, doc)).toEqual({
      refused: "ambiguous",
    });
  });

  it("refuses a duplicate that appeared after capture without IDs, but not with them", () => {
    const texts = ["P", "Target", "N"];
    const copied = ["P", "Target", "N", "Q", "Target", "R"];
    expect(
      resolveWordParagraphs(
        wordParagraphAnchor(body(texts, false), 1, 1),
        body(copied, false),
      ),
    ).toEqual({ refused: "ambiguous" });
    expect(
      resolveWordParagraphs(
        wordParagraphAnchor(body(texts), 1, 1),
        copied.map((text, i) => ({
          id: i < 3 ? `id-${i + 1}` : `c-${i}`,
          text,
        })),
      ),
    ).toEqual({ positions: [1] });
  });

  it("refuses a multi-paragraph span with a paragraph inserted inside it", () => {
    const anchor = wordParagraphAnchor(
      body(["A", "One", "Two", "B"], false),
      1,
      2,
    );
    expect(
      resolveWordParagraphs(anchor, body(["A", "One", "X", "Two", "B"], false)),
    ).toEqual({ refused: "changed" });
  });

  it("anchors empty paragraphs at the document edges", () => {
    const doc = body(["", "Text", ""], false);
    expect(resolveWordParagraphs(wordParagraphAnchor(doc, 0, 0), doc)).toEqual({
      positions: [0],
    });
    expect(resolveWordParagraphs(wordParagraphAnchor(doc, 2, 2), doc)).toEqual({
      positions: [2],
    });
  });

  it("locates by text when the live document has no IDs", () => {
    const anchor = wordParagraphAnchor(body(["A", "Target", "B"]), 1, 1);
    expect(
      resolveWordParagraphs(anchor, body(["A", "Target", "B"], false)),
    ).toEqual({ positions: [1] });
  });
});

/** The rules restated position by position, as the oracle for the implementation. */
function contextMatches(
  texts: readonly string[],
  start: number,
  anchor: WordParagraphAnchor,
  window: number,
): boolean {
  const k = anchor.paragraphs.length;
  if (start < 0 || start + k > texts.length) return false;
  if (anchor.paragraphs.some((p, i) => texts[start + i] !== p.text))
    return false;
  const at = (index: number) =>
    index === -1 || index === texts.length
      ? null
      : index < -1 || index > texts.length
        ? undefined
        : texts[index];
  for (let j = 0; j < Math.min(window, anchor.before.length); j += 1)
    if (at(start - 1 - j) !== anchor.before[j]) return false;
  for (let j = 0; j < Math.min(window, anchor.after.length); j += 1)
    if (at(start + k + j) !== anchor.after[j]) return false;
  return true;
}

function referenceResolve(
  anchor: WordParagraphAnchor,
  live: readonly WordParagraphEntry[],
): WordParagraphResolution {
  if (anchor.paragraphs.every((p) => p.id)) {
    const positions = anchor.paragraphs.map((p) =>
      live.findIndex((l) => l.id === p.id),
    );
    if (positions.every((p) => p >= 0)) {
      if (
        !positions.every(
          (p, i) =>
            (i === 0 || p === positions[i - 1] + 1) &&
            live[p].text === anchor.paragraphs[i].text,
        )
      )
        return { refused: "changed" };
      const first = positions[0];
      const text = anchor.paragraphs[0].text;
      const twin = live.some((l, i) => i < first && l.text === text);
      const at = (index: number) => (index < 0 ? null : live[index].text);
      const context = anchor.before.every(
        (expected, k) => at(first - 1 - k) === expected,
      );
      return twin && !context ? { refused: "ambiguous" } : { positions };
    }
  }
  if (anchor.window === null) return { refused: "ambiguous" };
  const texts = live.map((p) => p.text);
  const starts = texts
    .map((_, start) => start)
    .filter((start) => contextMatches(texts, start, anchor, anchor.window!));
  if (starts.length === 1)
    return { positions: anchor.paragraphs.map((_, i) => starts[0] + i) };
  if (starts.length > 1) return { refused: "ambiguous" };
  const bare = texts.some((_, start) =>
    contextMatches(texts, start, anchor, 0),
  );
  return { refused: anchor.window > 0 && bare ? "ambiguous" : "changed" };
}

function referenceWindow(
  texts: readonly string[],
  anchor: WordParagraphAnchor,
): number | null {
  const widest = Math.max(anchor.before.length, anchor.after.length);
  for (let window = 0; window <= widest; window += 1) {
    const count = texts.filter((_, start) =>
      contextMatches(texts, start, anchor, window),
    ).length;
    if (count === 1) return window;
  }
  return null;
}

interface ModelParagraph {
  key: string;
  id: string | null;
  text: string;
}

type Op =
  | { kind: "insert"; at: number; text: string }
  | { kind: "edit"; at: number; text: string }
  | { kind: "delete"; at: number }
  | { kind: "move"; at: number; to: number }
  | { kind: "copy"; at: number; to: number };

const pool = fc.constantFrom("A", "B", "Clause", "", "Same");
const op: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("insert" as const), at: fc.nat(), text: pool }),
  fc.record({ kind: fc.constant("delete" as const), at: fc.nat() }),
  fc.record({ kind: fc.constant("edit" as const), at: fc.nat(), text: pool }),
  fc.record({ kind: fc.constant("move" as const), at: fc.nat(), to: fc.nat() }),
  fc.record({ kind: fc.constant("copy" as const), at: fc.nat(), to: fc.nat() }),
);
const scenario = fc
  .record({
    texts: fc.array(pool, { minLength: 1, maxLength: 9 }),
    ids: fc.boolean(),
    first: fc.nat(),
    length: fc.integer({ min: 1, max: 3 }),
    ops: fc.array(op, { maxLength: 4 }),
  })
  .map(({ texts, ids, first, length, ops }) => {
    const start = first % texts.length;
    return {
      ids,
      ops,
      doc: texts.map(
        (text, i): ModelParagraph => ({
          key: `k${i}`,
          id: ids ? `k${i}` : null,
          text,
        }),
      ),
      first: start,
      last: Math.min(texts.length - 1, start + length - 1),
    };
  });

/** Cut and paste gives the paragraph a new ID; a copy is a new paragraph. */
function mutate(
  doc: ModelParagraph[],
  ops: readonly Op[],
  ids: boolean,
): ModelParagraph[] {
  const next = [...doc];
  let fresh = 0;
  const made = () => {
    fresh += 1;
    return `n${fresh}`;
  };
  for (const o of ops) {
    if (o.kind === "insert") {
      const key = made();
      next.splice(o.at % (next.length + 1), 0, {
        key,
        id: ids ? key : null,
        text: o.text,
      });
    } else if (next.length === 0) {
      continue;
    } else if (o.kind === "delete") {
      next.splice(o.at % next.length, 1);
    } else if (o.kind === "edit") {
      const i = o.at % next.length;
      next[i] = { ...next[i], text: o.text };
    } else {
      const [taken] =
        o.kind === "move"
          ? next.splice(o.at % next.length, 1)
          : [next[o.at % next.length]];
      const key = o.kind === "move" ? taken.key : made();
      next.splice(o.to % (next.length + 1), 0, {
        key,
        id: ids ? made() : null,
        text: taken.text,
      });
    }
  }
  return next;
}

const live = (doc: readonly ModelParagraph[]) =>
  doc.map(({ id, text }) => ({ id, text }));

describe("resolveWordParagraphs properties", () => {
  it("matches the restated rules for capture and apply", () => {
    fc.assert(
      fc.property(scenario, ({ doc, ids, ops, first, last }) => {
        const anchor = wordParagraphAnchor(live(doc), first, last);
        expect(anchor.window).toBe(
          referenceWindow(
            doc.map((p) => p.text),
            anchor,
          ),
        );
        const after = live(mutate(doc, ops, ids));
        expect(resolveWordParagraphs(anchor, after)).toEqual(
          referenceResolve(anchor, after),
        );
      }),
      { numRuns: 3000 },
    );
  });

  it("never picks another place while the original span and its context are intact", () => {
    fc.assert(
      fc.property(scenario, ({ doc, ids, ops, first, last }) => {
        const anchor = wordParagraphAnchor(live(doc), first, last);
        const after = mutate(doc, ops, ids);
        const result = resolveWordParagraphs(anchor, live(after));
        if ("refused" in result) return;
        expect(result.positions.map((p) => after[p].text)).toEqual(
          anchor.paragraphs.map((p) => p.text),
        );
        const window = anchor.window ?? 0;
        const keys = doc
          .slice(Math.max(0, first - window), last + window + 1)
          .map((p) => p.key);
        const head = after.findIndex((p) => p.key === keys[0]);
        // A window reaching past an edge of the body includes that edge.
        const intact =
          head >= 0 &&
          (first - window >= 0 || head === 0) &&
          (last + window <= doc.length - 1 ||
            head + keys.length === after.length) &&
          keys.every(
            (key, i) =>
              after[head + i]?.key === key &&
              after[head + i].text === doc.find((p) => p.key === key)!.text,
          );
        if (!intact) return;
        const offset = first - Math.max(0, first - window);
        expect(result.positions).toEqual(
          anchor.paragraphs.map((_, i) => head + offset + i),
        );
      }),
      { numRuns: 3000 },
    );
  });

  it("always resolves an unchanged document when the span is distinguishable", () => {
    fc.assert(
      fc.property(scenario, ({ doc, first, last }) => {
        const anchor = wordParagraphAnchor(live(doc), first, last);
        const result = resolveWordParagraphs(anchor, live(doc));
        const expected = doc.slice(first, last + 1).map((_, i) => first + i);
        if (anchor.window === null && !anchor.paragraphs.every((p) => p.id))
          expect(result).toEqual({ refused: "ambiguous" });
        else expect(result).toEqual({ positions: expected });
      }),
      { numRuns: 1000 },
    );
  });
});
