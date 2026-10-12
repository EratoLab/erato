import {
  parseWordCommentEnvelope,
  parseWordCommentThread,
} from "@erato/frontend/word-review";
import { afterEach, describe, expect, it } from "vitest";

import {
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import { readWordComments } from "../wordCommentReader";
import { createWordCommentRefRegistry } from "../wordCommentRefs";
import {
  nextWordCommentPick,
  resolveWordCommentSend,
  withWordCommentRefs,
  wordAnchoredCommentsArg,
  wordCommentAdvertised,
  wordCommentIdOfRef,
  wordCommentMapArg,
  wordCommentRefsOf,
  wordCommentsDue,
  wordCommentSendExact,
  wordCommentSendRead,
  wordCommentSendSelection,
  wordCommentThreadArgs,
} from "../wordCommentSend";

import type {
  CommentHost,
  CommentHostSelection,
} from "../../../test/mocks/word/commentHost";
import type { WordCommentSelectionCoordinates } from "../wordCommentPositions";
import type {
  WordCommentAdvertised,
  WordCommentPick,
  WordCommentPrecedence,
  WordCommentSendInput,
  WordCommentSendRead,
  WordCommentSendSelection,
} from "../wordCommentSend";

const EVERYTHING: WordCommentAdvertised = {
  anchored: true,
  thread: true,
  map: new Set(["word_document_review", "word_document_authoring"]),
};
const NOTHING: WordCommentAdvertised = {
  anchored: false,
  thread: false,
  map: new Set(),
};

const input = (
  overrides: Partial<WordCommentSendInput> = {},
): WordCommentSendInput => ({
  advertised: EVERYTHING,
  selection: { kind: "none" },
  precedence: "selection",
  pick: null,
  pickFound: false,
  override: null,
  withoutComments: false,
  documentIncluded: false,
  includeOpenComments: false,
  readFailed: false,
  ...overrides,
});
const passage = (
  threads: string[],
  rewritable = true,
): WordCommentSendSelection => ({ kind: "passage", threads, rewritable });
const caret = (threads: string[]): WordCommentSendSelection => ({
  kind: "caret",
  threads,
});
const resolve = (overrides: Partial<WordCommentSendInput> = {}) =>
  resolveWordCommentSend(input(overrides));

const SETTINGS: WordCommentPrecedence[] = ["selection", "comment"];

describe("which comment facets config advertises", () => {
  const ids = (...facets: string[]) => new Set(facets);
  const args = (entries: Record<string, string[]>) =>
    new Map(Object.entries(entries).map(([id, keys]) => [id, new Set(keys)]));

  it("needs every argument a carrier fills, on an advertised facet", () => {
    const advertised = wordCommentAdvertised(
      ids(
        "word_selection",
        "word_comment_thread",
        "word_document_review",
        "word_document_authoring",
      ),
      args({
        word_selection: ["selected_text", "anchored_comments"],
        word_comment_thread: ["thread_json", "comments_json"],
        word_document_review: ["document_text", "comment_map"],
        word_document_authoring: ["document_snapshot"],
      }),
    );
    expect(advertised).toEqual({
      anchored: true,
      thread: true,
      map: new Set(["word_document_review"]),
    });

    expect(
      wordCommentAdvertised(
        ids("word_comment_thread"),
        args({
          word_selection: ["anchored_comments"],
          word_comment_thread: ["thread_json"],
          word_document_review: ["comment_map"],
        }),
      ),
    ).toEqual(NOTHING);
  });

  it("reads comments at Send only where a carrier could take them", () => {
    const due = (
      advertised: WordCommentAdvertised,
      selectionDue: boolean,
      documentIncluded: boolean,
      withoutComments = false,
    ) =>
      wordCommentsDue({
        advertised,
        selectionDue,
        documentIncluded,
        withoutComments,
      });
    expect(due(NOTHING, true, true)).toBe(false);
    expect(due({ ...NOTHING, thread: true }, false, false)).toBe(true);
    expect(due({ ...NOTHING, anchored: true }, true, false)).toBe(true);
    expect(due({ ...NOTHING, anchored: true }, false, true)).toBe(false);
    expect(due({ ...NOTHING, map: EVERYTHING.map }, false, true)).toBe(true);
    expect(due({ ...NOTHING, map: EVERYTHING.map }, true, false)).toBe(false);
    expect(due(EVERYTHING, true, true, true)).toBe(false);
  });
});

describe("§8 precedence, under either setting", () => {
  it.each(SETTINGS)(
    "%s: a caret in one anchor sends that thread, at your cursor",
    (precedence) => {
      for (const documentIncluded of [false, true])
        expect(
          resolve({ precedence, documentIncluded, selection: caret(["t7k"]) }),
        ).toEqual({
          carrier: { kind: "thread", ref: "t7k" },
          block: null,
          why: "cursor",
          offerChoose: false,
          switchTo: "passage",
        });
    },
  );

  it.each(SETTINGS)(
    "%s: a caret in two anchors sends nothing until the user chooses",
    (precedence) => {
      for (const documentIncluded of [false, true])
        expect(
          resolve({
            precedence,
            documentIncluded,
            selection: caret(["t2p", "t7k"]),
          }),
        ).toMatchObject({
          carrier: { kind: "none" },
          block: "choose-comment",
        });
    },
  );

  it("selection first: a passage over one thread goes with its comment line, switchable to the comment", () => {
    expect(resolve({ selection: passage(["t7k"]) })).toEqual({
      carrier: { kind: "selection", threads: ["t7k"] },
      block: null,
      why: "default",
      offerChoose: false,
      switchTo: "comment",
    });
  });

  it("comments first: a passage over one thread sends the thread, switchable back to the passage", () => {
    expect(
      resolve({ precedence: "comment", selection: passage(["t7k"]) }),
    ).toEqual({
      carrier: { kind: "thread", ref: "t7k" },
      block: null,
      why: "default",
      offerChoose: false,
      switchTo: "passage",
    });
  });

  it.each(SETTINGS)(
    "%s: a passage over two threads never guesses, sends the passage and offers a choice",
    (precedence) => {
      for (const override of [null, "comment", "passage"] as const)
        expect(
          resolve({
            precedence,
            override,
            selection: passage(["t2p", "t7k"]),
          }),
        ).toEqual({
          carrier: { kind: "selection", threads: ["t2p", "t7k"] },
          block: null,
          why: null,
          offerChoose: true,
          switchTo: null,
        });
    },
  );

  it.each(SETTINGS)(
    "%s: a picked thread is chosen by you over the passage, the caret and the document",
    (precedence) => {
      for (const selection of [
        { kind: "none" } as const,
        caret(["t2p", "t7k"]),
        passage(["t2p"]),
      ])
        expect(
          resolve({
            precedence,
            selection,
            documentIncluded: true,
            pick: "t9m",
            pickFound: true,
          }),
        ).toEqual({
          carrier: { kind: "thread", ref: "t9m" },
          block: null,
          why: "chosen",
          offerChoose: false,
          switchTo: null,
        });
    },
  );

  it.each(SETTINGS)(
    "%s: a picked thread that is gone blocks the send",
    (precedence) => {
      expect(
        resolve({
          precedence,
          pick: "t9m",
          pickFound: false,
          selection: passage(["t2p"]),
        }),
      ).toMatchObject({ carrier: { kind: "none" }, block: "picked-gone" });
    },
  );

  it("sends a passage without threads with its coverage line", () => {
    for (const precedence of SETTINGS)
      expect(resolve({ precedence, selection: passage([]) })).toEqual({
        carrier: { kind: "selection", threads: [] },
        block: null,
        why: null,
        offerChoose: false,
        switchTo: null,
      });
  });

  it("leaves a passage Erato may not replace to the passage, whatever the setting", () => {
    expect(
      resolve({ precedence: "comment", selection: passage(["t7k"], false) }),
    ).toMatchObject({
      carrier: { kind: "selection", threads: ["t7k"] },
      why: null,
      switchTo: "comment",
    });
    expect(
      resolve({
        precedence: "selection",
        override: "comment",
        selection: passage(["t7k"], false),
      }),
    ).toMatchObject({ carrier: { kind: "thread", ref: "t7k" }, why: "chosen" });
  });
});

describe("the chip's switch, for one message", () => {
  it("turns selection first to the comment, chosen by you", () => {
    expect(
      resolve({ override: "comment", selection: passage(["t7k"]) }),
    ).toMatchObject({
      carrier: { kind: "thread", ref: "t7k" },
      why: "chosen",
      switchTo: "passage",
    });
  });

  it("turns comments first back to the passage, chosen by you", () => {
    expect(
      resolve({
        precedence: "comment",
        override: "passage",
        selection: passage(["t7k"]),
      }),
    ).toMatchObject({
      carrier: { kind: "selection", threads: ["t7k"] },
      why: "chosen",
      switchTo: "comment",
    });
  });

  it("lets a caret's thread go: the document or nothing goes instead", () => {
    expect(
      resolve({
        override: "passage",
        documentIncluded: true,
        selection: caret(["t7k"]),
      }).carrier,
    ).toEqual({ kind: "map" });
    expect(
      resolve({ override: "passage", selection: caret(["t2p", "t7k"]) }),
    ).toMatchObject({ carrier: { kind: "none" }, block: null });
  });

  it("offers no switch to a comment the thread facet cannot carry", () => {
    expect(
      resolve({
        advertised: { ...EVERYTHING, thread: false },
        precedence: "comment",
        selection: passage(["t7k"]),
      }),
    ).toMatchObject({
      carrier: { kind: "selection", threads: ["t7k"] },
      switchTo: null,
    });
  });
});

describe("without a passage or a caret thread", () => {
  it("sends the map whenever the document goes", () => {
    expect(resolve({ documentIncluded: true }).carrier).toEqual({
      kind: "map",
    });
    expect(
      resolve({ documentIncluded: true, includeOpenComments: true }).carrier,
    ).toEqual({ kind: "map" });
    expect(
      resolve({
        documentIncluded: true,
        advertised: { ...EVERYTHING, map: new Set() },
      }).carrier,
    ).toEqual({ kind: "none" });
  });

  it("sends the open threads with Include open comments and no document", () => {
    expect(resolve({ includeOpenComments: true }).carrier).toEqual({
      kind: "open-comments",
    });
    expect(
      resolve({
        includeOpenComments: true,
        advertised: { ...EVERYTHING, thread: false },
      }).carrier,
    ).toEqual({ kind: "none" });
    expect(resolve().carrier).toEqual({ kind: "none" });
  });
});

describe("sending without comments", () => {
  it("carries nothing when nothing is advertised", () => {
    for (const selection of [
      passage(["t7k"]),
      caret(["t7k"]),
      { kind: "none" } as const,
    ])
      expect(
        resolve({
          advertised: NOTHING,
          selection,
          pick: "t9m",
          documentIncluded: true,
          includeOpenComments: true,
          readFailed: true,
        }),
      ).toEqual({
        carrier: { kind: "none" },
        block: null,
        why: null,
        offerChoose: false,
        switchTo: null,
      });
  });

  it("carries nothing after Send without comments, a pick included", () => {
    expect(
      resolve({
        withoutComments: true,
        selection: passage(["t7k"]),
        pick: "t9m",
        pickFound: false,
        readFailed: true,
      }),
    ).toMatchObject({ carrier: { kind: "none" }, block: null });
  });

  it("blocks on a failed read wherever comments would have gone", () => {
    for (const overrides of [
      { selection: passage([]) },
      { pick: "t9m" },
      { includeOpenComments: true },
      { documentIncluded: true },
    ])
      expect(resolve({ ...overrides, readFailed: true })).toMatchObject({
        carrier: { kind: "none" },
        block: "read-failed",
      });
  });

  it("does not block a send whose read only looked for a caret thread", () => {
    expect(resolve({ readFailed: true, selection: caret([]) })).toMatchObject({
      carrier: { kind: "none" },
      block: null,
    });
    expect(
      resolve({
        readFailed: true,
        documentIncluded: true,
        advertised: { ...EVERYTHING, map: new Set() },
      }),
    ).toMatchObject({ block: null });
  });
});

describe("the pick's lifetime", () => {
  const pick: WordCommentPick = { ref: "t7k", selectionKey: "sel-1" };

  it("stays across sends and the selection it was made on", () => {
    let state: WordCommentPick | null = nextWordCommentPick(null, {
      kind: "pick",
      ref: "t7k",
      selectionKey: "sel-1",
    });
    expect(state).toEqual(pick);
    state = nextWordCommentPick(state, { kind: "send" });
    state = nextWordCommentPick(state, { kind: "send" });
    state = nextWordCommentPick(state, { kind: "selection", key: "sel-1" });
    state = nextWordCommentPick(state, { kind: "selection", key: null });
    expect(state).toEqual(pick);
  });

  it("ends with another pick, its ×, a new non-empty selection, or another chat", () => {
    expect(
      nextWordCommentPick(pick, {
        kind: "pick",
        ref: "t2p",
        selectionKey: null,
      }),
    ).toEqual({ ref: "t2p", selectionKey: null });
    expect(nextWordCommentPick(pick, { kind: "dismiss" })).toBeNull();
    expect(
      nextWordCommentPick(pick, { kind: "selection", key: "sel-2" }),
    ).toBeNull();
    expect(
      nextWordCommentPick(
        { ref: "t7k", selectionKey: null },
        { kind: "selection", key: "sel-1" },
      ),
    ).toBeNull();
    expect(nextWordCommentPick(pick, { kind: "context" })).toBeNull();
    expect(nextWordCommentPick(null, { kind: "send" })).toBeNull();
  });
});

describe("refs and exact anchors at Send", () => {
  const record = (id: string, first: number | null, last = first) =>
    ({
      id,
      anchor:
        first === null
          ? null
          : { first: { ordinal: first }, last: { ordinal: last } },
    }) as never;
  const records = [
    record("10", 2),
    record("11", 4, 6),
    record("12", 9),
    record("13", null),
  ];

  it("places the pick first, then the threads that reach the passage", () => {
    const passageAt = { first: 5, last: 9, start: 0, end: 3 };
    expect(
      wordCommentSendExact(records, {
        passage: passageAt,
        live: null,
        pickedId: "10",
      }),
    ).toEqual(["10", "11", "12"]);
    expect(
      wordCommentSendExact(records, {
        passage: null,
        live: { collapsed: true, first: 2, last: 2 },
        pickedId: null,
      }),
    ).toEqual(["10"]);
    expect(
      wordCommentSendExact(records, {
        passage: null,
        live: { collapsed: true, first: null, last: null },
        pickedId: "12",
      }),
    ).toEqual(["12"]);
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

describe("the arguments a Send carries, from the ERMAIN-947 fixture", () => {
  let host: CommentHost;
  const NOW = new Date("2026-10-12T09:30:00Z");

  afterEach(() => uninstallWordCommentHost());

  async function sendRead(
    selection: CommentHostSelection,
    passage: (h: CommentHost) => WordCommentSelectionCoordinates | null = () =>
      null,
  ): Promise<WordCommentSendRead> {
    host = installWordCommentHost({ selection });
    const at = passage(host);
    const result = await readWordComments({
      selection: true,
      replies: "requested",
      exact: (threads, live) =>
        wordCommentSendExact(threads, { passage: at, live, pickedId: null }),
      now: host.now,
    });
    if (!result.ok) throw new Error(result.error);
    return wordCommentSendRead({
      result,
      registry: createWordCommentRefRegistry("doc"),
      passage: at,
      people: { principalEmail: null },
      now: NOW,
      userTz: "Europe/Berlin",
    });
  }
  const refOf = (read: WordCommentSendRead, key: string) => {
    const entry = read.refs.threads.find(
      (t) => t.commentId === host.commentId(key),
    );
    if (!entry) throw new Error(`no ref for ${key}`);
    return entry.ref;
  };
  const overT1 = (h: CommentHost) => ({
    first: h.ordinalOf("T1P"),
    last: h.ordinalOf("T1P"),
    start: 22,
    end: 33,
  });

  it("anchored_comments carries exactly the passage's threads and the coverage line", async () => {
    const read = await sendRead({ tag: "T1P", offset: 22 }, overT1);
    const t1 = refOf(read, "T1");
    expect(read.atSelection).toEqual([t1]);
    expect(wordCommentSendSelection(read, { rewritable: true })).toEqual({
      kind: "passage",
      threads: [t1],
      rewritable: true,
    });

    const envelope = parseWordCommentEnvelope(
      wordAnchoredCommentsArg(read, read.atSelection),
    );
    expect(envelope?.scope).toBe("selection");
    expect(envelope?.selection).toEqual({
      para: [host.ordinalOf("T1P"), host.ordinalOf("T1P")],
      caret: false,
    });
    expect(envelope?.threads.map((t) => t.id)).toEqual([t1]);
    expect(envelope?.threads[0].entries).toHaveLength(3);
    expect(envelope?.index).toEqual([]);
    expect(envelope?.coverage).toMatchObject({
      threads_total: 14,
      open: 13,
      resolved: 1,
      sent_full: 1,
      not_shown: 13,
    });
    expect(envelope?.coverage.line).toContain(
      "Nearest commented paragraph above the selection: none; below:",
    );
    expect(envelope?.coverage.line).not.toMatch(/alpha|Maya|Jonas|@/);
  });

  it("places a caret by Word's relation to each anchor around it", async () => {
    const read = await sendRead({ tag: "T1P", offset: 25 });
    const t1 = refOf(read, "T1");
    expect(read.selection).toEqual({
      first: host.ordinalOf("T1P"),
      last: host.ordinalOf("T1P"),
      start: null,
      end: null,
      caret: true,
    });
    expect(read.atSelection).toEqual([t1]);
    expect(wordCommentSendSelection(read, null)).toEqual({
      kind: "caret",
      threads: [t1],
    });
    const at = read.model.threads.find((t) => t.thread.id === t1);
    expect(at?.thread.where.vs).toBe("at_caret");
  });

  it("finds two anchors at a caret where they overlap, and none beside them", async () => {
    const both = await sendRead({ tag: "T6P", offset: 20 });
    expect(both.atSelection).toEqual([refOf(both, "T6"), refOf(both, "T7")]);
    expect(
      resolveWordCommentSend(
        input({ selection: wordCommentSendSelection(both, null) }),
      ).block,
    ).toBe("choose-comment");

    const clear = await sendRead({ tag: "T1P", offset: 3 });
    expect(clear.atSelection).toEqual([]);
    expect(wordCommentSendSelection(clear, null)).toEqual({
      kind: "caret",
      threads: [],
    });
  });

  it("sees no caret in a passage it does not send", async () => {
    const read = await sendRead({
      tag: "T1P",
      offset: 22,
      to: { tag: "T1P", offset: 33 },
    });
    expect(read.selection).toBeNull();
    expect(read.atSelection).toEqual([]);
    expect(wordCommentSendSelection(read, null)).toEqual({ kind: "none" });
  });

  it("word_comment_thread carries the thread and the envelope around it", async () => {
    const read = await sendRead({ tag: "T1P", offset: 25 });
    const t1 = refOf(read, "T1");
    const { threadJson, commentsJson } = wordCommentThreadArgs(read, t1);

    const thread = parseWordCommentThread(threadJson);
    expect(thread?.id).toBe(t1);
    expect(thread?.where.vs).toBe("at_caret");
    const envelope = parseWordCommentEnvelope(commentsJson);
    expect(envelope?.scope).toBe("thread");
    expect(envelope?.selection).toEqual({
      para: [host.ordinalOf("T1P"), host.ordinalOf("T1P")],
      caret: true,
    });
    expect(envelope?.threads).toEqual([thread]);
    expect(envelope?.coverage.sent_full).toBe(1);
    expect(envelope).not.toHaveProperty("why");

    const atCaret = wordCommentThreadArgs(read, t1, "cursor");
    expect(atCaret.threadJson).toBe(threadJson);
    expect(parseWordCommentEnvelope(atCaret.commentsJson)?.why).toBe("cursor");
  });

  it("Include open comments sends every open thread with an empty thread_json", async () => {
    const read = await sendRead({ tag: "END", offset: 0 });
    const { threadJson, commentsJson } = wordCommentThreadArgs(read, null);
    expect(threadJson).toBe("");
    const envelope = parseWordCommentEnvelope(commentsJson);
    expect(envelope?.scope).toBe("document");
    const sent = [
      ...(envelope?.threads ?? []).map((t) => t.id),
      ...(envelope?.index ?? []).map((r) => r.id),
    ];
    expect(sent).toHaveLength(13);
    expect(sent).not.toContain(refOf(read, "T2"));
    expect(envelope?.coverage).toMatchObject({ threads_total: 14, open: 13 });
  });

  it("comment_map lists every thread by its section, without sending a thread in full", async () => {
    const read = await sendRead({ tag: "END", offset: 0 });
    const envelope = parseWordCommentEnvelope(
      wordCommentMapArg(read, [
        { ordinal: host.ordinalOf("H1"), level: 1, text: "Introduction" },
        { ordinal: host.ordinalOf("H2"), level: 1, text: "Spans and cells" },
      ]),
    );
    expect(envelope?.scope).toBe("document");
    expect(envelope?.threads).toEqual([]);
    expect(envelope?.index).toHaveLength(14);
    expect(envelope?.index[0]).toMatchObject({
      id: refOf(read, "T1"),
      sec: "Introduction",
      para: host.ordinalOf("T1P"),
      by: "Maya Krüger",
      st: "open",
    });
    expect(envelope?.index.at(-1)?.sec).toBe("Spans and cells");
    expect(envelope?.coverage).toMatchObject({
      threads_total: 14,
      sent_index_only: 14,
      not_shown: 0,
      complete: true,
    });
  });

  it("stages the Send's refs with the capture", async () => {
    const read = await sendRead({ tag: "T1P", offset: 25 });
    const capture = {
      identity: "doc",
      ordinalMap: new Map(),
      paragraphsSent: 0,
      renderedOrdinals: new Set<number>(),
      partialOrdinal: null,
    };
    const staged = withWordCommentRefs(capture, read);
    expect(wordCommentRefsOf(staged)).toBe(read.refs);
    expect(wordCommentRefsOf(withWordCommentRefs(capture, null))).toBeNull();
    expect(withWordCommentRefs(capture, null)).toBe(capture);
  });
});
