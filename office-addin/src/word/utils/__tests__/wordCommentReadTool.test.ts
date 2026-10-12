import {
  WORD_READ_COMMENTS_DIGEST_MAX_BYTES,
  WORD_READ_COMMENTS_PAGE_BYTES,
  parseWordCommentEnvelope,
} from "@erato/frontend/word-review";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  V3C_COMMENT_DOCUMENT,
  generatedCommentDocument,
  installWordCommentHost,
  uninstallWordCommentHost,
} from "../../../test/mocks/word/commentHost";
import {
  V3C_ANCHORS,
  V3C_PARAGRAPHS,
  v3cVisibleText,
} from "../../../test/mocks/word/commentPackages";
import { createWordReadRequestStore } from "../../../test/mocks/word/readRequestStore";
import {
  WORD_COMMENTS_ASK_AGAIN,
  WORD_READ_COMMENTS_PAGE_THREADS,
  WordCommentReadSession,
} from "../wordCommentReadTool";
import { wordCommentInventoryFromCapture } from "../wordCommentReader";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../wordCommentRefs";
import { bindWordDocumentReadRequest } from "../wordDocumentReadRequest";

import type {
  CommentHost,
  CommentHostDocument,
  CommentHostOptions,
} from "../../../test/mocks/word/commentHost";
import type {
  WordCommentReadActivation,
  WordCommentReadResultJson,
} from "../wordCommentReadTool";
import type { ClientToolCallContext } from "@erato/frontend/library";

const mock = vi.hoisted(() => ({
  store: undefined as ReturnType<typeof createWordReadRequestStore> | undefined,
}));
vi.mock("@erato/frontend/library", () => ({
  useMessagingStore: {
    getState: () => mock.store!.getState(),
    subscribe: (
      listener: Parameters<
        ReturnType<typeof createWordReadRequestStore>["subscribe"]
      >[0],
    ) => mock.store!.subscribe(listener),
  },
}));

const NOW = new Date("2026-10-12T08:30:00Z");
const IDENTITY = "doc";
const MAYA = "maya.kruger@contoso.test";
const REQUEST: ClientToolCallContext = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "call-1",
};
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length;

let host: CommentHost;
let session: WordCommentReadSession;
/** The installed document when a test generates one; the probe fixture otherwise. */
let currentDocument: CommentHostDocument | undefined;

function install(options: CommentHostOptions = {}) {
  host = installWordCommentHost(options);
  return host;
}

function activate(activation: Partial<WordCommentReadActivation> = {}) {
  return session.activate(
    { identity: IDENTITY, gestures: { document: false }, ...activation },
    { chatId: REQUEST.chatId, messageId: REQUEST.messageId },
  );
}

async function read(args: unknown = {}, context = REQUEST) {
  const response = await session.execute(args, context);
  if (!response.ok) throw new Error(response.error);
  if (response.disposition === "local_only") throw new Error("local only");
  return response.result as WordCommentReadResultJson;
}

async function refused(args: unknown = {}, context = REQUEST) {
  const response = await session.execute(args, context);
  if (response.ok) throw new Error("expected a refusal");
  return {
    error: response.error,
    code: response.validationErrors?.[0]?.code,
  };
}

const refOf = (key: string) => {
  const ref = wordCommentRefRegistry(IDENTITY).refs.get(
    `id:${host.commentId(key)}`,
  );
  if (!ref) throw new Error(`no ref for ${key}`);
  return ref;
};
const keyOf = (ref: string) => {
  const registry = wordCommentRefRegistry(IDENTITY);
  const key = [...registry.refs].find(
    ([k, r]) => r === ref && k.startsWith("id:"),
  )?.[0];
  const id = key?.slice(3);
  const keys = Object.keys((currentDocument ?? V3C_COMMENT_DOCUMENT).comments);
  return keys.find((k) => host.commentId(k) === id) ?? ref;
};
const keysOf = (result: WordCommentReadResultJson) =>
  result.threads.map((t) => keyOf(t.id));

/** The selection on the second "sierra tango", T8's anchor (¶13). */
const ON_T8 = {
  first: 13,
  last: 13,
  start: V3C_ANCHORS.T8.start,
  end: V3C_ANCHORS.T8.end,
};

function captureInventory() {
  const paragraphs = V3C_COMMENT_DOCUMENT.body.flatMap((block) =>
    "table" in block ? block.table.flat() : [block],
  );
  return wordCommentInventoryFromCapture(
    new Map(
      paragraphs.map((p, i) => [
        i + 1,
        {
          uniqueLocalId: `{0000-${p.tag}}`,
          text:
            p.tag in V3C_PARAGRAPHS
              ? v3cVisibleText(p.tag)
              : String(p.segments[0]),
        },
      ]),
    ),
  );
}

function generated(
  options: Parameters<typeof generatedCommentDocument>[0],
): CommentHostDocument {
  currentDocument = generatedCommentDocument(options);
  return currentDocument;
}

beforeEach(() => {
  mock.store = createWordReadRequestStore();
  forgetWordCommentRefs();
  currentDocument = undefined;
  session = new WordCommentReadSession({
    now: () => NOW,
    userTimeZone: () => "Europe/Berlin",
    readOptions: { now: () => host.now() },
  });
});

afterEach(() => {
  uninstallWordCommentHost();
});

describe("near reads", () => {
  it("stop at the 3 nearest threads above and below the selection without a gesture", async () => {
    install();
    activate({ selection: ON_T8 });
    const result = await read({ near: { selection: true, above: 10 } });
    expect(keysOf(result)).toEqual([
      "T6",
      "T7",
      "T7b",
      "T8",
      "T9",
      "T10",
      "T11",
    ]);
    expect(result.threads.find((t) => keyOf(t.id) === "T8")?.where.vs).toBe(
      "inside",
    );
    expect(result.threads[0].where.vs).toBe("before");
    expect(result).toMatchObject({
      view: "near",
      scope: "read",
      capped: true,
      complete: false,
      cursor: null,
    });
    expect(result.coverage_line).toContain(
      "6 more matching threads lie beyond the 3 nearest above and below the selection",
    );
  });

  it("read as far as asked with the document included", async () => {
    install();
    activate({ selection: ON_T8, gestures: { document: true } });
    const result = await read({
      near: { selection: true, above: 10, below: 1 },
    });
    expect(keysOf(result)).toEqual([
      "T1",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7",
      "T7b",
      "T8",
      "T9",
    ]);
    expect(result).toMatchObject({ capped: false, complete: true });
  });

  it("are unlocked by a picked thread or Include open comments as well", async () => {
    install();
    for (const gestures of [
      { document: false, picked: "t00" },
      { document: false, openComments: true },
    ]) {
      activate({ selection: ON_T8, gestures });
      const result = await read({ near: { selection: true, above: 5 } });
      expect(result.threads).toHaveLength(9);
      expect(result.capped).toBe(false);
    }
  });

  it("center on a ref or a paragraph", async () => {
    install();
    activate({ selection: ON_T8, gestures: { document: true } });
    await read({ near: { selection: true } });
    const byRef = await read({
      near: { ref: refOf("T9"), above: 1, below: 1 },
    });
    expect(keysOf(byRef)).toEqual(["T8", "T9", "T10"]);
    const byEntry = await read({
      near: { ref: `${refOf("T9")}.0`, above: 0, below: 0 },
    });
    expect(keysOf(byEntry)).toEqual(["T9"]);
    const byPara = await read({ near: { para: 12, above: 1, below: 1 } });
    expect(keysOf(byPara)).toEqual(["T5", "T6", "T7", "T7b", "T8"]);
  });

  it("keep to the selection's neighbours whatever the filter, without a gesture", async () => {
    install();
    activate({ selection: ON_T8 });
    await read({ near: { selection: true } });
    const far = await refused({ near: { ref: refOf("T1") } });
    expect(far.code).toBe("document-not-included");
    const byText = await read({
      near: { selection: true },
      text: "alpha",
      status: "all",
    });
    expect(byText.threads).toEqual([]);
    expect(byText.capped).toBe(true);
  });

  it("place only the threads they return, lazily", async () => {
    install();
    activate({ selection: ON_T8 });
    await read({ near: { selection: true } });
    const packages = host
      .calls()
      .filter((call) => call.endsWith("getOoxml")).length;
    expect(packages).toBeGreaterThan(0);
    expect(packages).toBeLessThanOrEqual(5);
  });

  it("read Word afresh on every call", async () => {
    const before = generated({ paragraphs: 5 });
    install({ document: before });
    activate({
      selection: { first: 3, last: 3, start: 0, end: 3 },
      gestures: { document: true },
    });
    const first = await read({ near: { para: 3, above: 0, below: 0 } });
    expect(first.threads[0].entries[0].text).toBe("Comment 3.");
    install({
      document: generated({
        paragraphs: 5,
        content: (i) => (i === 3 ? "Changed in Word." : `Comment ${i}.`),
      }),
    });
    const second = await read({ near: { para: 3, above: 0, below: 0 } });
    expect(second.threads[0].id).toBe(first.threads[0].id);
    expect(second.threads[0].entries[0].text).toBe("Changed in Word.");
  });

  it("need a captured selection to center on it", async () => {
    install();
    activate({ gestures: { document: true } });
    expect(await refused({ near: { selection: true } })).toMatchObject({
      code: "no-selection",
    });
  });
});

describe("filters", () => {
  it("read open threads by default, resolved or all on request", async () => {
    install({ document: generated({ paragraphs: 10 }) });
    activate({ gestures: { document: true } });
    expect(keysOf(await read())).toEqual([
      "G1",
      "G2",
      "G3",
      "G4",
      "G6",
      "G7",
      "G8",
      "G9",
    ]);
    expect(keysOf(await read({ status: "resolved" }))).toEqual(["G5", "G10"]);
    expect(await read({ status: "all" })).toMatchObject({
      threads: { length: 10 },
    });
  });

  it("match an author in any entry, or the signed-in user as me", async () => {
    install();
    activate({
      gestures: { document: true },
      people: { principalEmail: MAYA },
    });
    expect(keysOf(await read({ author: "  JONAS " }))).toEqual([
      "T1",
      "T5",
      "T7",
      "T9",
      "T14",
    ]);
    expect(keysOf(await read({ author: "me" }))).toEqual([
      "T1",
      "T4",
      "T6",
      "T8",
      "T11",
      "PB1",
    ]);
  });

  it("match text in comments and in the anchored text", async () => {
    install();
    activate({ gestures: { document: true } });
    expect(keysOf(await read({ text: "OSCAR" }))).toEqual(["T6", "T7b"]);
    expect(keysOf(await read({ text: "yankee zulu" }))).toEqual(["T11"]);
    expect(keysOf(await read({ text: "keep it" }))).toEqual(["T1"]);
  });

  it("accept null for every argument a strict schema sends", async () => {
    install();
    activate({ gestures: { document: true } });
    const result = await read({
      status: null,
      author: null,
      near: null,
      text: null,
      section: null,
      around: null,
      cursor: null,
    });
    expect(result.view).toBe("document");
    expect(result.threads).toHaveLength(13);
  });

  it("refuse arguments they do not know", async () => {
    install();
    activate({ gestures: { document: true } });
    expect(await refused({ limit: 3 })).toMatchObject({
      code: "read-arguments",
    });
    expect(await refused({ near: { selection: true, para: 3 } })).toMatchObject(
      { code: "read-arguments" },
    );
    expect(
      await refused({ near: { selection: true }, section: { para: 1 } }),
    ).toMatchObject({ code: "read-arguments" });
    expect(await refused({ status: "done" })).toMatchObject({
      code: "read-arguments",
    });
  });
});

describe("resolved threads", () => {
  const ON_T2 = {
    first: 3,
    last: 3,
    start: V3C_ANCHORS.T2.start,
    end: V3C_ANCHORS.T2.end,
  };
  const ON_T1 = {
    first: 2,
    last: 2,
    start: V3C_ANCHORS.T1.start,
    end: V3C_ANCHORS.T1.end,
  };

  it("come along when anchored at the selection", async () => {
    install();
    activate({ selection: ON_T2 });
    const result = await read({ near: { selection: true } });
    expect(keysOf(result)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(result.threads[1].status).toBe("resolved");
  });

  it("stay out of a near read otherwise, unless the filter asks", async () => {
    install();
    activate({ selection: ON_T1 });
    expect(keysOf(await read({ near: { selection: true } }))).toEqual([
      "T1",
      "T3",
      "T4",
      "T5",
    ]);
    expect(
      keysOf(await read({ near: { selection: true }, status: "all" })),
    ).toEqual(["T1", "T2", "T3", "T4"]);
  });

  it("come when the model names one", async () => {
    install();
    activate({ selection: ON_T1 });
    await read({ near: { selection: true } });
    const named = await read({
      near: { ref: refOf("T2"), above: 0, below: 0 },
    });
    expect(keysOf(named)).toEqual(["T2"]);
    expect(named.threads[0].entries.map((e) => e.n)).toEqual([0, 1]);
  });
});

describe("the section view", () => {
  it("returns the section's threads in full with their anchored passages", async () => {
    install();
    activate({ gestures: { document: true } });
    const result = await read({ section: { para: 5, through: 9 } });
    expect(keysOf(result)).toEqual(["T3", "T4"]);
    expect(result.threads.map((t) => t.passage)).toEqual([
      "foxtrot.\nT3B Middle span paragraph golf.\nT3C Last span",
      "india juliet",
    ]);
    expect(result.view).toBe("section");
    expect(result.coverage_line).toContain(
      "anchored in paragraphs 5–9, with their anchored passages",
    );
  });

  it("takes one paragraph when through is left out", async () => {
    install();
    activate({ gestures: { document: true } });
    const result = await read({ section: { para: 12, through: null } });
    expect(keysOf(result)).toEqual(["T6", "T7", "T7b"]);
  });

  it("needs a gesture", async () => {
    install();
    activate({ selection: ON_T8 });
    expect(await refused({ section: { para: 5 } })).toMatchObject({
      code: "document-not-included",
    });
  });
});

describe("text_before", () => {
  const above = { near: { selection: true, above: 1, below: 0 } };

  it("joins the anchor's own text to earlier paragraphs with the document", async () => {
    install();
    activate({
      selection: ON_T8,
      gestures: { document: true },
      inventory: captureInventory(),
    });
    const result = await read({ ...above, around: "text_before" });
    expect(keysOf(result)).toEqual(["T7b", "T8"]);
    const [t7b, t8] = result.threads;
    expect(t7b.text_before).toMatch(
      /Inline anchors\nT5P Point comment after kilo and more words\.\nT6P Overlap lima mike november$/,
    );
    expect(t8.text_before).toMatch(
      /T6P Overlap lima mike november oscar papa quebec romeo\.\nT8P The sierra tango phrase and again$/,
    );
    expect(t7b.text_before!.length).toBeLessThanOrEqual(600);
  });

  it("stops at a paragraph whose text the light read did not keep", async () => {
    install();
    activate({ selection: ON_T8, gestures: { document: true } });
    const [t7b] = (await read({ ...above, around: "text_before" })).threads;
    expect(t7b.text_before).toBe("T6P Overlap lima mike november");
  });

  it("keeps to the anchor's own paragraph without the document", async () => {
    install();
    activate({ selection: ON_T8, inventory: captureInventory() });
    const [t7b] = (await read({ ...above, around: "text_before" })).threads;
    expect(t7b.text_before).toBe("T6P Overlap lima mike november");
  });

  it("is left out unless asked for", async () => {
    install();
    activate({ selection: ON_T8 });
    const [t7b] = (await read(above)).threads;
    expect(t7b).not.toHaveProperty("text_before");
  });
});

describe("paging", () => {
  const long = (i: number) => `Comment ${i}: ${"lorem ipsum ".repeat(75)}`;

  it("pages 20 KB at a time and continues after the last thread sent", async () => {
    install({
      document: generated({ paragraphs: 40, content: long }),
    });
    activate({ gestures: { document: true } });
    const seen: string[] = [];
    let result = await read();
    let pages = 1;
    while (true) {
      expect(bytes(result)).toBeLessThanOrEqual(WORD_READ_COMMENTS_PAGE_BYTES);
      expect(result.threads.length).toBeGreaterThan(0);
      seen.push(...keysOf(result));
      if (!result.cursor) break;
      expect(result.complete).toBe(false);
      expect(result.coverage_line).toContain(
        "More: call word_read_comments with the cursor.",
      );
      result = await read({ cursor: result.cursor });
      pages += 1;
    }
    expect(pages).toBeGreaterThan(1);
    expect(result.complete).toBe(true);
    const open = Array.from({ length: 40 }, (_, i) => i + 1)
      .filter((i) => i % 5 !== 0)
      .map((i) => `G${i}`);
    expect(seen).toEqual(open);
  });

  it("carries at most a page's threads, each placed and with its replies", async () => {
    install({
      document: generated({ paragraphs: 60, repliesPerThread: 1 }),
    });
    activate({ gestures: { document: true } });
    const result = await read();
    expect(result.threads).toHaveLength(WORD_READ_COMMENTS_PAGE_THREADS);
    expect(result.threads.every((t) => t.entries.length === 2)).toBe(true);
    expect(result.threads.some((t) => t.replies_unread)).toBe(false);
  });

  it("refuses a cursor from another read or another request", async () => {
    install({ document: generated({ paragraphs: 60 }) });
    activate({ gestures: { document: true } });
    const { cursor } = await read();
    expect(cursor).toEqual(expect.any(String));
    expect(await refused({ cursor, status: "all" })).toMatchObject({
      code: "read-cursor",
    });
    expect(
      (await read({ cursor, status: "open" })).threads.length,
    ).toBeGreaterThan(0);
    expect(await refused({ cursor: "c-unknown" })).toMatchObject({
      code: "read-cursor",
    });
    activate({ gestures: { document: true } });
    expect(await refused({ cursor })).toMatchObject({ code: "read-cursor" });
  });

  it("continues the comment map from its cursor", async () => {
    install();
    activate({ gestures: { document: true } });
    const result = await read({ cursor: "map:0" });
    expect(result).toMatchObject({ view: "map", threads: [], cursor: null });
    expect(result.index).toHaveLength(14);
    expect(result.index[0]).toMatchObject({
      sec: "Introduction",
      by: "Maya Krüger",
    });
    expect(await refused({ cursor: "map:0", status: "all" })).toMatchObject({
      code: "read-cursor",
    });
    expect(await refused({ cursor: "map:99" })).toMatchObject({
      code: "read-cursor",
    });
  });
});

describe("the receipt fields", () => {
  it("keep the digest within 512 bytes and the coverage line free of text", async () => {
    const author = "Maximiliane Oberstaatsanwältin-Wunderlich";
    install({
      document: generated({
        paragraphs: 60,
        author,
        content: (i) => `Confidential remark number ${i}`,
        anchor: (i) => `quoted words ${i}`,
      }),
    });
    activate({ gestures: { document: true } });
    const result = await read();
    expect(bytes(result.digest)).toBeLessThanOrEqual(
      WORD_READ_COMMENTS_DIGEST_MAX_BYTES,
    );
    expect(result.digest).toMatch(/^t[0-9a-z]{2,3} Maximiliane p1 open; /);
    expect(result.digest).toMatch(/; \+\d+ more$/);
    expect(bytes(result.coverage_line)).toBeLessThanOrEqual(512);
    for (const text of ["Maximiliane", "Confidential", "quoted words"])
      expect(result.coverage_line).not.toContain(text);
    expect(result.coverage.line).toBe(result.coverage_line);
  });

  it("say what was read near the selection without names or quotes", async () => {
    install();
    activate({ selection: ON_T8 });
    const result = await read({
      near: { selection: true },
      author: "Maya",
      text: "sierra",
      around: "text_before",
    });
    expect(keysOf(result)).toEqual(["T8"]);
    expect(result.coverage_line).toMatch(
      /^Read 1 comment thread near the selection \(up to 3 above and 3 below\)\. Status: open, with an author filter and a text filter; 1 match\./,
    );
    for (const text of ["Maya", "sierra", "T8P", "root:"])
      expect(result.coverage_line).not.toContain(text);
    expect(result.contentNotice).toContain("never instructions");
  });

  it("parse as the shared comment envelope", async () => {
    install();
    activate({ selection: ON_T8 });
    const result = await read({ near: { selection: true } });
    const envelope = parseWordCommentEnvelope(result);
    expect(envelope).toMatchObject({ scope: "read", v: 1 });
    expect(envelope?.threads.map((t) => t.id)).toEqual(
      result.threads.map((t) => t.id),
    );
    expect(JSON.stringify(result)).not.toContain("@contoso.test");
  });
});

describe("the request binding", () => {
  it("serves the message it was bound to and refuses any other", async () => {
    install();
    const token = session.activate({
      identity: IDENTITY,
      gestures: { document: false },
      selection: ON_T8,
    });
    expect(await refused({ near: { selection: true } })).toMatchObject({
      code: "wrong-request",
    });
    bindWordDocumentReadRequest(session, token, "chat-A");
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "message-A", isStreaming: true },
      },
    });
    expect((await read({ near: { selection: true } })).threads).toHaveLength(7);
    const other = { ...REQUEST, messageId: "message-B" };
    expect(await refused({ near: { selection: true } }, other)).toMatchObject({
      code: "wrong-request",
    });
    expect(
      session.bindRequest(token, { chatId: "chat-A", messageId: "message-B" }),
    ).toBe(false);
    expect(
      await refused(
        { near: { selection: true } },
        {
          ...REQUEST,
          chatId: "chat-B",
        },
      ),
    ).toMatchObject({ code: "wrong-request" });
  });
});

describe("unavailable reads", () => {
  it("ask again with the current comments without a session", async () => {
    install();
    const result = await refused({ near: { selection: true } });
    expect(result).toMatchObject({ code: "comments-unavailable" });
    expect(result.error).toContain(WORD_COMMENTS_ASK_AGAIN);
  });

  it("ask again with the current comments after a pane teardown", async () => {
    install();
    activate({ selection: ON_T8 });
    await read({ near: { selection: true } });
    forgetWordCommentRefs();
    const result = await refused({ near: { selection: true } });
    expect(result).toMatchObject({ code: "comments-unavailable" });
    expect(result.error).toContain(WORD_COMMENTS_ASK_AGAIN);
  });

  it("ask again after the session is cleared", async () => {
    install();
    activate({ selection: ON_T8 });
    session.clear();
    expect(await refused({ near: { selection: true } })).toMatchObject({
      code: "comments-unavailable",
    });
  });

  it("refuse document-wide reads once inclusion is switched off", async () => {
    install();
    let included = true;
    activate({
      selection: ON_T8,
      gestures: { document: true },
      documentIncluded: () => included,
    });
    expect((await read()).threads).toHaveLength(13);
    included = false;
    const refusal = await refused();
    expect(refusal).toMatchObject({ code: "document-not-included" });
    expect(refusal.error).toContain("Document inclusion was switched off");
    expect((await read({ near: { selection: true } })).threads).toHaveLength(7);
    expect(await refused({ cursor: "map:0" })).toMatchObject({
      code: "document-not-included",
    });
  });

  it("refuse a ref no thread has", async () => {
    install();
    activate({ selection: ON_T8, gestures: { document: true } });
    expect(await refused({ near: { ref: "tzz" } })).toMatchObject({
      code: "unknown-ref",
    });
  });

  it("refuse a ref whose thread is gone", async () => {
    install({ document: generated({ paragraphs: 4 }) });
    activate({ gestures: { document: true } });
    await read();
    const gone = refOf("G3");
    const { G3: _gone, ...comments } = currentDocument!.comments;
    install({ document: { ...currentDocument!, comments } });
    const refusal = await refused({ near: { ref: gone } });
    expect(refusal).toMatchObject({ code: "unknown-ref" });
    expect(refusal.error).toContain("no longer in the document");
  });

  it("report a failed read without document text", async () => {
    install({ failList: true, errorMessage: "Secret clause 7" });
    activate({ selection: ON_T8 });
    const refusal = await refused({ near: { selection: true } });
    expect(refusal.code).toBe("comment-read-failed");
    expect(refusal.error).not.toContain("Secret");
  });
});
