import {
  isWordCommentEntryRef,
  isWordCommentThreadRef,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { readWordComments } from "../wordCommentReader";
import {
  createWordCommentRefRegistry,
  forgetWordCommentRefs,
  issueWordCommentRefs,
  resolveWordCommentRef,
  wordCommentEntryRef,
  wordCommentFingerprint,
  wordCommentIdOfRef,
  wordCommentRefFor,
  wordCommentRefRegistry,
} from "../wordCommentRefs";

import type { CommentHostFlavour } from "../../../test/mocks/word/commentHost";
import type {
  WordCommentEntryRecord,
  WordCommentParagraphRef,
  WordCommentThreadRecord,
} from "../wordCommentReader";

const paragraph = (ordinal: number): WordCommentParagraphRef => ({
  ordinal,
  via: "id",
  rangeText: "",
  nesting: 0,
  cell: null,
  table: null,
});

const reply = (
  id: string,
  changes: Partial<WordCommentEntryRecord> = {},
): WordCommentEntryRecord => ({
  id,
  authorName: "Jonas Weber",
  authorEmail: "jonas.weber@contoso.test",
  creationDate: new Date("2026-09-03T09:20:00Z"),
  content: `Reply ${id}`,
  ...changes,
});

function record(
  id: string,
  changes: Partial<WordCommentThreadRecord> = {},
): WordCommentThreadRecord {
  return {
    id,
    authorName: "Maya Krüger",
    authorEmail: "maya.kruger@contoso.test",
    creationDate: new Date("2026-09-03T08:15:00Z"),
    content: `Comment ${id}`,
    resolved: false,
    replies: [],
    readOnly: null,
    anchor: {
      rangeText: `anchor ${id}`,
      first: paragraph(2),
      last: paragraph(2),
      single: true,
    },
    order: 0,
    ...changes,
  };
}

const refsOf = (
  threads: readonly WordCommentThreadRecord[],
  legacy: boolean | null = false,
  registry = createWordCommentRefRegistry("doc"),
) => issueWordCommentRefs(registry, threads, legacy).threads.map((t) => t.ref);

/** An id whose unsalted ref is the given one, found by search. */
function idDerivingTo(
  ref: string,
  exclude: readonly string[] = [],
  accept: (id: string) => boolean = () => true,
): string {
  for (let n = 1; n < 2_000_000; n += 1) {
    const id = String(n);
    if (!exclude.includes(id) && accept(id) && wordCommentRefFor(id) === ref)
      return id;
  }
  throw new Error(`no id derives to ${ref}`);
}

afterEach(() => {
  forgetWordCommentRefs();
  uninstallWordCommentHost();
});

describe("ref format", () => {
  it("is t and two or three base-36 characters, never digits only", () => {
    const ids = Array.from({ length: 400 }, (_, i) => String(1000 + i * 7919));
    const refs = refsOf(ids.map((id) => record(id)));
    expect(new Set(refs).size).toBe(ids.length);
    for (const ref of refs) {
      expect(isWordCommentThreadRef(ref), ref).toBe(true);
      expect(ref).not.toMatch(/^t\d+$/);
    }
    expect(isWordCommentEntryRef(wordCommentEntryRef(refs[0], 0))).toBe(true);
    expect(wordCommentEntryRef("t7k", 2)).toBe("t7k.2");
  });

  it("skips a ref of digits only for the next salt", () => {
    let id = "";
    for (let n = 1; !id; n += 1)
      if (/^t\d+$/.test(wordCommentRefFor(String(n)))) id = String(n);
    const [ref] = refsOf([record(id)]);
    expect(ref).not.toBe(wordCommentRefFor(id));
    expect(ref).toMatch(/^t[0-9a-z]{2,3}$/);
  });
});

describe("derivation and rebuilds", () => {
  it("derives a modern file's ref from String(Comment.id)", () => {
    const ids = ["1332042173", "761668070", "22247363"];
    const refs = refsOf(ids.map((id) => record(id)));
    expect(refs).toEqual(ids.map((id) => wordCommentRefFor(id)));
  });

  it("gives the same refs after a teardown, whatever order the threads come in", () => {
    const threads = ["1332042173", "761668070", "1477326678"].map((id) =>
      record(id),
    );
    const first = issueWordCommentRefs(
      wordCommentRefRegistry("doc"),
      threads,
      false,
    );
    forgetWordCommentRefs();
    const rebuilt = issueWordCommentRefs(
      wordCommentRefRegistry("doc"),
      [...threads].reverse(),
      false,
    );
    const byId = (refs: typeof first) =>
      Object.fromEntries(refs.threads.map((t) => [t.commentId, t.ref]));
    expect(byId(rebuilt)).toEqual(byId(first));
  });

  it("keeps one registry per document and session", () => {
    expect(wordCommentRefRegistry("a")).toBe(wordCommentRefRegistry("a"));
    expect(wordCommentRefRegistry("a")).not.toBe(wordCommentRefRegistry("b"));
    const before = wordCommentRefRegistry("a");
    forgetWordCommentRefs();
    expect(wordCommentRefRegistry("a")).not.toBe(before);
  });

  it.each<CommentHostFlavour>(["pc", "web"])(
    "gives the fixture the same refs on %s as on Word PC, and again after a reload",
    async (flavour) => {
      const read = async (h: CommentHostFlavour) => {
        installWordCommentHost({ host: h });
        const result = await readWordComments();
        if (!result.ok) throw new Error(result.error);
        return result;
      };
      const pc = await read("pc");
      const pcRefs = issueWordCommentRefs(
        createWordCommentRefRegistry("pc"),
        pc.threads,
        pc.legacy,
      );
      const other = await read(flavour);
      const reloaded = issueWordCommentRefs(
        createWordCommentRefRegistry("other"),
        other.threads,
        other.legacy,
      );
      const byId = (refs: typeof pcRefs) =>
        Object.fromEntries(refs.threads.map((t) => [t.commentId, t.ref]));
      expect(byId(reloaded)).toEqual(byId(pcRefs));
      expect(reloaded.threads.every((t) => t.matchedBy === "id")).toBe(true);
    },
  );
});

describe("collisions and reuse", () => {
  it("resolves a collision by a salted rehash, the same in any order", () => {
    const a = "1332042173";
    const b = idDerivingTo(wordCommentRefFor(a), [a]);
    const forward = refsOf([record(a), record(b)]);
    const backward = refsOf([record(b), record(a)]).reverse();
    expect(forward).toEqual(backward);
    expect(forward[0]).not.toBe(forward[1]);
    expect(forward).toContain(wordCommentRefFor(a));
  });

  it("gives a thread added later in the session its salted ref again after a reload", () => {
    const older = "1332042173";
    // Sorting by source alone would hand the newer thread the unsalted ref.
    const newer = idDerivingTo(
      wordCommentRefFor(older),
      [older],
      (id) => id < older,
    );
    const threads = [
      record(newer, { creationDate: new Date("2026-09-04T09:00:00Z") }),
      record(older),
    ];
    const session = createWordCommentRefRegistry("doc");
    issueWordCommentRefs(session, [threads[1]], false);
    const before = issueWordCommentRefs(session, threads, false).threads.map(
      (t) => t.ref,
    );
    const rebuilt = issueWordCommentRefs(
      createWordCommentRefRegistry("doc"),
      threads,
      false,
    ).threads.map((t) => t.ref);
    expect(rebuilt).toEqual(before);
    expect(before[1]).toBe(wordCommentRefFor(older));
  });

  it("keeps a thread's ref for the session and never reuses a deleted thread's ref", () => {
    const registry = createWordCommentRefRegistry("doc");
    const a = "761668070";
    const b = "1477326678";
    const [refA, refB] = refsOf([record(a), record(b)], false, registry);
    expect(refsOf([record(b)], false, registry)).toEqual([refB]);
    const c = idDerivingTo(refA, [a, b]);
    const [refC, refB2] = refsOf([record(c), record(b)], false, registry);
    expect(refB2).toBe(refB);
    expect(refC).not.toBe(refA);
    expect(registry.issued.get(refA)).toBe(`id:${a}`);
  });

  it("names each of two threads Word lists with one id (F-19)", () => {
    const refs = issueWordCommentRefs(
      createWordCommentRefRegistry("doc"),
      [record("55"), record("55", { readOnly: "id-repeated" })],
      false,
    );
    expect(refs.threads[0].ref).not.toBe(refs.threads[1].ref);
    expect(refs.threads.map((t) => t.commentId)).toEqual(["55", "55"]);
  });

  it("finds the comment id a ref was issued for", () => {
    const registry = createWordCommentRefRegistry("doc");
    registry.refs.set("id:42", "t7k");
    registry.refs.set("id:43#2", "t2p");
    registry.refs.set("content:abc", "t9m");
    expect(wordCommentIdOfRef(registry, "t7k")).toBe("42");
    expect(wordCommentIdOfRef(registry, "t2p")).toBe("43");
    expect(wordCommentIdOfRef(registry, "t9m")).toBeNull();
    expect(wordCommentIdOfRef(registry, "tzz")).toBeNull();
  });
});

describe("legacy files (O-17)", () => {
  const anchored = (rangeText: string) => ({
    rangeText,
    first: paragraph(4),
    last: paragraph(4),
    single: true,
  });
  const legacyThreads = (ids: readonly string[]) => [
    record(ids[0], { content: "Bitte prüfen.", anchor: anchored("Frist") }),
    record(ids[1], {
      authorName: "Jonas Weber",
      content: "Quelle fehlt.",
      creationDate: null,
      anchor: anchored("Studie"),
    }),
  ];

  it("derives refs from content, so new ids on the next open keep them", () => {
    const first = refsOf(legacyThreads(["9000003", "9000010"]), true);
    const reopened = refsOf(legacyThreads(["7123", "7130"]), true);
    expect(reopened).toEqual(first);
    const refs = issueWordCommentRefs(
      createWordCommentRefRegistry("doc"),
      legacyThreads(["1", "2"]),
      true,
    );
    expect(refs.threads.every((t) => t.matchedBy === "content")).toBe(true);
  });

  it("tells two threads with equal content apart in document order", () => {
    const twins = [record("1"), record("2")].map((t) => ({
      ...t,
      content: "Same.",
      anchor: { ...t.anchor!, rangeText: "same" },
    }));
    const refs = refsOf(twins, true);
    expect(refs[0]).not.toBe(refs[1]);
    expect(
      refsOf(
        twins.map((t, i) => ({ ...t, id: `9${i}` })),
        true,
      ),
    ).toEqual(refs);
  });

  it("numbers a repeat apart from a # in the comment's text", () => {
    const twins = [record("1"), record("2")].map((t) => ({
      ...t,
      content: "see #3",
      anchor: anchored("same"),
    }));
    const source = ["Maya Krüger", "2026-09-03T08:15", "see #3", "same"].join(
      "\u001f",
    );
    const refs = refsOf(twins, true);
    expect(refs).toEqual([
      wordCommentRefFor(source),
      wordCommentRefFor(`${source}#2`),
    ]);
    expect(
      refsOf(
        twins.map((t, i) => ({ ...t, id: `9${i}` })),
        true,
      ),
    ).toEqual(refs);
  });

  it("keeps a thread's ref by its id within the session after its content changes", () => {
    const registry = createWordCommentRefRegistry("doc");
    const [before] = refsOf(
      [record("71", { content: "Draft" })],
      true,
      registry,
    );
    const [after] = refsOf(
      [record("71", { content: "Edited" })],
      true,
      registry,
    );
    expect(after).toBe(before);
  });
});

describe("fingerprints and the capture's refs", () => {
  const t7 = record("1332042173", {
    resolved: true,
    replies: [reply("123940964"), reply("1460246645", { content: "Second" })],
    anchor: {
      rangeText: "Lieferung\u0005 binnen\r14 Tagen",
      first: paragraph(12),
      last: paragraph(13),
      single: false,
    },
  });

  it("records id, status, author, time, content, replies and anchor", () => {
    expect(wordCommentFingerprint(t7)).toEqual({
      id: "1332042173",
      author: "Maya Krüger",
      email: "maya.kruger@contoso.test",
      created: "2026-09-03T08:15:00.000Z",
      content: "Comment 1332042173",
      resolved: true,
      replyIds: ["123940964", "1460246645"],
      replies: [
        {
          id: "123940964",
          author: "Jonas Weber",
          email: "jonas.weber@contoso.test",
          created: "2026-09-03T09:20:00.000Z",
          content: "Reply 123940964",
        },
        {
          id: "1460246645",
          author: "Jonas Weber",
          email: "jonas.weber@contoso.test",
          created: "2026-09-03T09:20:00.000Z",
          content: "Second",
        },
      ],
      anchor: { para: 12, through: 13, quote: "Lieferung binnen…14 Tagen" },
    });
    expect(
      wordCommentFingerprint(record("5", { replies: null, anchor: null })),
    ).toMatchObject({ replyIds: null, replies: null, anchor: null });
  });

  it("resolves thread and entry refs against the capture only", () => {
    const refs = issueWordCommentRefs(
      createWordCommentRefRegistry("doc"),
      [t7, record("5", { replies: null })],
      false,
    );
    const [ref, unread] = refs.threads.map((t) => t.ref);
    expect(resolveWordCommentRef(refs, ref)).toMatchObject({
      ok: true,
      target: { kind: "thread" },
    });
    expect(resolveWordCommentRef(refs, `${ref}.0`)).toMatchObject({
      ok: true,
      target: { kind: "entry", n: 0, commentId: "1332042173" },
    });
    expect(resolveWordCommentRef(refs, `${ref}.2`)).toMatchObject({
      ok: true,
      target: { kind: "entry", n: 2, commentId: "1460246645" },
    });
    for (const value of [
      `${ref}.3`,
      `${unread}.1`,
      "t000",
      "thread_1",
      "1332042173",
      "story_comment-4",
      7,
    ])
      expect(resolveWordCommentRef(refs, value), String(value)).toEqual({
        ok: false,
        code: "unknown-ref",
      });
  });
});
