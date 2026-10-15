import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installWordSelectionHost,
  uninstallWordSelectionHost,
} from "../../../test/mocks/word/selectionHost";
import {
  parseWordCommentChanges,
  validateWordCommentChanges,
} from "../wordCommentChanges";
import {
  resetWordCommentSession,
  wordCommentWriteMode,
} from "../wordCommentPolicy";
import {
  forgetWordCommentRefs,
  wordCommentRefRegistry,
} from "../wordCommentRefs";
import { readWordCommentStory } from "../wordCommentSubmission";
import {
  executeWordCommentDraft,
  revertWordCommentRows,
  WORD_COMMENT_RUN_TIMEOUT_MS,
} from "../wordCommentWrites";

import type {
  MockSelectionDocument,
  WordSelectionHost,
  WordSelectionHostOptions,
} from "../../../test/mocks/word/selectionHost";
import type { WordCommentRefEntry } from "../wordCommentRefs";
import type { WordCommentExecuteOptions } from "../wordCommentWrites";

const HOSTS = ["pc", "mac", "web"] as const;
const PLATFORM = { pc: "PC", mac: "Mac", web: "OfficeOnline" } as const;

const DOC: MockSelectionDocument = {
  body: [
    "H1 Comment probe heading",
    {
      runs: [
        "T1P Payment within ",
        { text: "net 30 days", commented: "T1" },
        { comment: "T1" },
        " of the invoice.",
      ],
    },
    {
      runs: [
        "T2P Resolved ",
        { text: "delta echo", commented: "T2" },
        { comment: "T2" },
        " here.",
      ],
    },
    "AP1 Plain paragraph alpha beta gamma.",
    "AP2 Second paragraph delta epsilon.",
    "AP3 Third paragraph zeta eta theta.",
    { table: [["CL1 Cell one words.", "CL2 Cell two words."]] },
    "END The end.",
  ],
  header: ["HD1 Header text."],
  commentMeta: {
    T1: {
      author: "Maya Krüger",
      email: "maya@contoso.test",
      content: "T1 root",
      replies: [
        {
          author: "Jonas Weber",
          email: "jonas@contoso.test",
          content: "T1 reply",
        },
      ],
    },
    T2: {
      author: "Lena Fischer",
      email: "lena@contoso.test",
      content: "T2 root",
      resolved: true,
    },
  },
};

let host: WordSelectionHost;
let flavour: (typeof HOSTS)[number];

function install(
  which: (typeof HOSTS)[number],
  options: WordSelectionHostOptions = {},
) {
  flavour = which;
  host = installWordSelectionHost(DOC, {
    host: which,
    failCommentRanges: true,
    ...options,
  });
  return host;
}

/** The capture's refs as a read would have issued them, named by each thread's text. */
function threads(): Map<string, WordCommentRefEntry> {
  const refs = new Map<string, WordCommentRefEntry>();
  for (const state of host.commentStates()) {
    const ref = `t${state.content.slice(0, 2).toLowerCase()}`;
    refs.set(ref, {
      ref,
      commentId: state.id,
      matchedBy: "id",
      readOnly: null,
      fingerprint: {
        id: state.id,
        author: state.author,
        email: state.email,
        created: null,
        content: state.content,
        resolved: state.resolved,
        replyIds: state.replies.map((r) => r.id),
        replies: state.replies.map((r) => ({
          id: r.id,
          author: r.author,
          email: r.email,
          created: null,
          content: r.content,
        })),
        anchor: null,
      },
    });
  }
  return refs;
}

async function draftOf(changes: unknown[], draftId = "call-1") {
  const story = await readWordCommentStory();
  const parsed = parseWordCommentChanges({ changes }, () => 50);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const validated = validateWordCommentChanges(parsed, {
    draftId,
    identity: "doc",
    host: PLATFORM[flavour],
    threads: threads(),
    selection: null,
    captured: new Map(
      story!.entries.map((e, i) => [
        i + 1,
        { uniqueLocalId: e.id, text: e.text },
      ]),
    ),
    story,
    label: "Erato AI:",
    authorMode: "user",
    rowCap: () => 50,
    legacy: false,
  });
  if (!validated.ok) throw new Error(JSON.stringify(validated.errors));
  return validated.draft;
}

const run = (
  draft: Awaited<ReturnType<typeof draftOf>>,
  options: Partial<WordCommentExecuteOptions> = {},
) =>
  executeWordCommentDraft(draft, {
    selected: new Set(draft.rows.map((row) => row.i)),
    assistantAuthor: null,
    host: PLATFORM[flavour],
    pollMs: 0,
    ...options,
  });

const commentOn = (text: string) =>
  host.commentStates().filter((c) => c.content === text);

beforeEach(() => {
  forgetWordCommentRefs();
  wordCommentRefRegistry("doc").legacy = false;
});
afterEach(() => {
  if (flavour === "web") expect(host.calls()).not.toContain("Comment.getRange");
  uninstallWordSelectionHost();
  resetWordCommentSession();
  vi.useRealTimers();
});

describe.each(HOSTS)("adds on %s", (which) => {
  it("posts a labelled comment exactly on the quote, under the user, and Revert deletes it", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "beta" }, text: "Check this." },
    ]);
    const { rows } = await run(draft);
    expect(rows).toEqual([
      expect.objectContaining({
        i: 0,
        status: "applied",
        author: "user",
        newRef: expect.stringMatching(/^t[0-9a-z]{2,3}$/),
      }),
    ]);
    const [posted] = commentOn("Erato AI: Check this.");
    expect(posted).toMatchObject({ author: "Max Token", anchor: "beta" });
    expect(rows[0].commentId).toBe(posted.id);

    const reverted = await revertWordCommentRows([
      { i: 0, step: rows[0].revert! },
    ]);
    expect(reverted.rows).toEqual([{ i: 0, status: "reverted" }]);
    expect(commentOn("Erato AI: Check this.")).toEqual([]);
  });

  it("inserts a batch in reverse document order in one sync, rows independent", async () => {
    const texts: string[] = [];
    install(which, {
      insertCommentError: (_, text) => {
        texts.push(text);
        return null;
      },
    });
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "first" },
      { op: "add", anchor: { para: 6, quote: "zeta" }, text: "third" },
      { op: "add", anchor: { para: 4, quote: "gamma" }, text: "second" },
    ]);
    const before = host.writeSyncs().length;
    const { rows } = await run(draft);
    expect(rows.map((r) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(texts).toEqual([
      "Erato AI: third",
      "Erato AI: second",
      "Erato AI: first",
    ]);
    const writes = host.writeSyncs().slice(before);
    expect(writes).toHaveLength(1);
    expect(
      writes[0].writes.filter((w) => w.endsWith("insertComment")),
    ).toHaveLength(3);
    expect(commentOn("Erato AI: second")[0].anchor).toBe("gamma");
  });

  it("refuses a row whose paragraph changed and posts the others", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "kept" },
      { op: "add", anchor: { para: 5, quote: "delta" }, text: "stale" },
    ]);
    host.insertText({ p: "AP2", text: "epsilon" }, "omega", "Replace");
    const { rows } = await run(draft);
    expect(rows.map((r) => [r.status, r.code])).toEqual([
      ["applied", undefined],
      ["refused", "TARGET_TEXT_MISMATCH"],
    ]);
    expect(commentOn("Erato AI: stale")).toEqual([]);
  });

  it("sorts rows after a throw by a fresh read and never inserts again (F-17)", async () => {
    install(which, {
      insertCommentError: (index) => (index === 1 ? "GeneralException" : null),
    });
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "lands later" },
      { op: "add", anchor: { para: 5, quote: "delta" }, text: "throws" },
      { op: "add", anchor: { para: 6, quote: "zeta" }, text: "lands first" },
    ]);
    const { rows } = await run(draft);
    // Desktop proves the later rows absent (F-17); the web may still show them, so they stay open.
    expect(rows.map((r) => r.status)).toEqual(
      which === "web"
        ? ["unverified", "unverified", "applied"]
        : ["failed", "failed", "applied"],
    );
    expect(commentOn("Erato AI: lands first")).toHaveLength(1);
    expect(
      host.calls().filter((c) => c.endsWith("insertComment")),
    ).toHaveLength(3);
  });

  it("leaves a write it cannot read back unverified and posts nothing twice", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "vanishes" },
    ]);
    const stop = host.afterSync(() => {
      const [lost] = commentOn("Erato AI: vanishes");
      if (lost) host.deleteComment(lost.id);
    });
    const { rows } = await run(draft);
    stop();
    expect(rows[0]).toMatchObject({ status: "unverified", code: "NOT_LISTED" });
    expect(
      host.calls().filter((c) => c.endsWith("insertComment")),
    ).toHaveLength(1);
  });

  it("spans paragraphs from the quote's start to its end", async () => {
    install(which);
    const draft = await draftOf([
      {
        op: "add",
        anchor: { para: 4, through: 6, quote: "beta gamma.…AP3 Third" },
        text: "Across.",
      },
    ]);
    const { rows } = await run(draft);
    expect(rows[0].status).toBe("applied");
    expect(commentOn("Erato AI: Across.")[0].anchor).toMatch(
      /^beta gamma\.[\r\n]AP2 Second paragraph delta epsilon\.[\r\n]AP3 Third$/,
    );
  });

  it("comments on a whole paragraph and inside one table cell", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 5 }, text: "Whole." },
      { op: "add", anchor: { para: 8, quote: "two" }, text: "Cell." },
    ]);
    const { rows } = await run(draft);
    expect(rows.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(commentOn("Erato AI: Whole.")[0].anchor).toBe(
      "AP2 Second paragraph delta epsilon.",
    );
    expect(commentOn("Erato AI: Cell.")[0].anchor).toBe("two");
  });

  it("refuses AI-author rows when Track Changes came on, writing nothing", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "ai" },
    ]);
    host.setTrackingMode("TrackAll");
    const { rows } = await run(draft, {
      assistantAuthor: "Erato (AI) for Max",
    });
    expect(rows[0]).toMatchObject({
      status: "refused",
      code: "AUTHOR_MODE_UNAVAILABLE",
    });
    expect(
      host.calls().filter((c) => c.endsWith("insertComment")),
    ).toHaveLength(0);
  });

  it("ends deselected rows refused without touching Word", async () => {
    install(which);
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "no" },
    ]);
    const calls = host.calls().length;
    const { rows } = await run(draft, { selected: new Set() });
    expect(rows).toEqual([
      { i: 0, op: "add", status: "refused", code: "DESELECTED" },
    ]);
    expect(host.calls()).toHaveLength(calls);
  });
});

describe.each(HOSTS)("replies, resolves and reopens on %s", (which) => {
  it("replies with the label, names the reply and Revert removes it", async () => {
    install(which);
    const draft = await draftOf([
      { op: "reply", thread: "tt1", text: "Agreed." },
    ]);
    const { rows } = await run(draft);
    expect(rows[0]).toMatchObject({ status: "applied", newRef: "tt1.2" });
    const t1 = commentOn("T1 root")[0];
    expect(t1.replies.at(-1)).toMatchObject({
      content: "Erato AI: Agreed.",
      author: "Max Token",
    });
    const reverted = await revertWordCommentRows([
      { i: 0, step: rows[0].revert! },
    ]);
    expect(reverted.rows[0].status).toBe("reverted");
    expect(commentOn("T1 root")[0].replies).toHaveLength(1);
  });

  it("reopens a resolved thread before replying to it, which the web needs (F-18)", async () => {
    install(which);
    const draft = await draftOf([
      { op: "reopen", thread: "tt2" },
      { op: "reply", thread: "tt2", text: "Reopened." },
    ]);
    const { rows } = await run(draft);
    expect(rows.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(commentOn("T2 root")[0]).toMatchObject({ resolved: false });
  });

  it("resolves idempotently and reverts a resolve to open", async () => {
    install(which);
    const done = await run(await draftOf([{ op: "resolve", thread: "tt2" }]));
    expect(done.rows[0].status).toBe("unchanged");
    const draft = await draftOf([{ op: "resolve", thread: "tt1" }], "call-2");
    const { rows } = await run(draft);
    expect(rows[0].status).toBe("applied");
    expect(commentOn("T1 root")[0].resolved).toBe(true);
    await revertWordCommentRows([{ i: 0, step: rows[0].revert! }]);
    expect(commentOn("T1 root")[0].resolved).toBe(false);
  });

  it.each([
    ["NEW_ACTIVITY", () => host.addReply(commentOn("T1 root")[0].id)],
    [
      "THREAD_CHANGED",
      () =>
        host.editComment(commentOn("T1 root")[0].id, (c) => {
          c.content = "edited by Maya";
        }),
    ],
    [
      "STATE_CHANGED",
      () =>
        host.editComment(commentOn("T1 root")[0].id, (c) => {
          c.resolved = true;
        }),
    ],
    ["THREAD_NOT_FOUND", () => host.deleteComment(commentOn("T1 root")[0].id)],
  ])("refuses a reply with %s after drift", async (code, drift) => {
    install(which);
    const draft = await draftOf([{ op: "reply", thread: "tt1", text: "x" }]);
    drift();
    const { rows } = await run(draft);
    expect(rows[0]).toMatchObject({ status: "refused", code });
    expect(host.calls()).not.toContain("Comment.reply");
  });

  it("stops the second of a pair when the first is refused", async () => {
    install(which);
    const draft = await draftOf([
      { op: "reply", thread: "tt1", text: "x" },
      { op: "resolve", thread: "tt1" },
    ]);
    host.addReply(commentOn("T1 root")[0].id);
    const { rows } = await run(draft);
    expect(rows.map((r) => r.code)).toEqual([
      "NEW_ACTIVITY",
      "DEPENDENCY_NOT_MET",
    ]);
    expect(commentOn("T1 root")[0].resolved).toBe(false);
  });
});

describe("a host refusal mid-write", () => {
  it("moves respond to copy for the session on the web's NotAllowed", async () => {
    install("web");
    const draft = await draftOf([{ op: "reply", thread: "tt1", text: "x" }]);
    const t1 = commentOn("T1 root")[0].id;
    // Someone resolves the thread between the proof and the write: list, replies, then the write.
    const start = host.syncCount();
    const stop = host.beforeSync((index) => {
      if (index === start + 3)
        host.editComment(t1, (c) => {
          c.resolved = true;
        });
    });
    const { rows } = await run(draft);
    stop();
    expect(rows[0].status).toMatch(/failed|unverified/);
    expect(wordCommentWriteMode("respond", "OfficeOnline")).toBe("copy");
    expect(commentOn("T1 root")[0].replies).toHaveLength(1);
  });
});

describe.each(HOSTS)("edits and deletes on %s", (which) => {
  it("edits another author's item, keeping its author, and Revert restores the text", async () => {
    install(which);
    const draft = await draftOf([
      { op: "edit", target: "tt1.1", text: "Rewritten." },
    ]);
    const { rows } = await run(draft);
    expect(rows[0].status).toBe("applied");
    expect(commentOn("T1 root")[0].replies[0]).toMatchObject({
      author: "Jonas Weber",
      content: "Rewritten.",
    });
    await revertWordCommentRows([{ i: 0, step: rows[0].revert! }]);
    expect(commentOn("T1 root")[0].replies[0].content).toBe("T1 reply");
  });

  it("leaves an edit Revert alone once someone changed the text again", async () => {
    install(which);
    const { rows } = await run(
      await draftOf([{ op: "edit", target: "tt1", text: "Mine." }]),
    );
    host.editComment(commentOn("Mine.")[0].id, (c) => {
      c.content = "Theirs.";
    });
    const reverted = await revertWordCommentRows([
      { i: 0, step: rows[0].revert! },
    ]);
    expect(reverted.rows[0].status).toBe("stale");
    expect(commentOn("Theirs.")).toHaveLength(1);
  });

  it("deletes a whole thread only while every reply is the one shown", async () => {
    install(which);
    const draft = await draftOf([{ op: "delete", target: "tt1" }]);
    host.addReply(commentOn("T1 root")[0].id);
    expect((await run(draft)).rows[0]).toMatchObject({
      status: "refused",
      code: "NEW_ACTIVITY",
    });
    const again = await draftOf([{ op: "delete", target: "tt1" }], "call-2");
    const { rows } = await run(again);
    expect(rows[0]).toMatchObject({ status: "applied" });
    expect(rows[0].revert).toBeUndefined();
    expect(commentOn("T1 root")).toEqual([]);
  });

  it("deletes one reply and refuses one that is gone", async () => {
    install(which);
    const draft = await draftOf([{ op: "delete", target: "tt1.1" }]);
    const { rows } = await run(draft);
    expect(rows[0].status).toBe("applied");
    expect(commentOn("T1 root")[0].replies).toEqual([]);
    expect((await run(draft)).rows[0]).toMatchObject({
      status: "refused",
      code: "REPLY_NOT_FOUND",
    });
  });
});

const HIDDEN_DOC: MockSelectionDocument = {
  body: [
    "H1 Hidden text probe",
    {
      runs: [
        "HT1 Before ",
        { text: "SECRET ", hidden: true },
        { text: "whiskey xray", commented: "TH" },
        { comment: "TH" },
        " end.",
      ],
    },
    {
      runs: [
        "PL1 Plain ",
        { text: "yankee zulu", commented: "TP" },
        { comment: "TP" },
        " end.",
      ],
    },
  ],
  commentMeta: {
    TH: {
      author: "Lena Fischer",
      email: "lena@contoso.test",
      content: "TH root",
      replies: [{ author: "Jonas Weber", content: "TH reply" }],
    },
    TP: {
      author: "Lena Fischer",
      email: "lena@contoso.test",
      content: "TP root",
    },
  },
};

describe.each(HOSTS)("hidden text beside a comment on %s", (which) => {
  const web = which === "web";
  const installHidden = () => {
    flavour = which;
    host = installWordSelectionHost(HIDDEN_DOC, {
      host: which,
      failCommentRanges: true,
    });
  };
  const stillHidden = () =>
    expect(host.ooxml({ p: "HT1" })).toMatch(/<w:vanish\/>/);

  it("adds in that paragraph only where Word keeps it hidden", async () => {
    installHidden();
    const { rows } = await run(
      await draftOf([
        { op: "add", anchor: { para: 2 }, text: "Whole paragraph." },
        { op: "add", anchor: { para: 3, quote: "yankee" }, text: "Plain." },
      ]),
    );
    expect(rows.map((row) => [row.status, row.code])).toEqual([
      web ? ["refused", "HIDDEN_TEXT"] : ["applied", undefined],
      ["applied", undefined],
    ]);
    expect(commentOn("Erato AI: Whole paragraph.")).toHaveLength(web ? 0 : 1);
    stillHidden();
  });

  it("resolves, edits and deletes its thread only where Word keeps it hidden; replies everywhere", async () => {
    installHidden();
    const resolve = await run(
      await draftOf([
        { op: "resolve", thread: "tth" },
        { op: "resolve", thread: "ttp" },
      ]),
    );
    expect(resolve.rows.map((row) => [row.status, row.code])).toEqual([
      web ? ["refused", "HIDDEN_TEXT"] : ["applied", undefined],
      ["applied", undefined],
    ]);
    stillHidden();
    if (!web) {
      await revertWordCommentRows(
        [{ i: 0, step: resolve.rows[0].revert! }],
        PLATFORM[which],
        0,
      );
    }
    const reply = await run(
      await draftOf([{ op: "reply", thread: "tth", text: "Seen." }], "call-2"),
    );
    expect(reply.rows[0].status).toBe("applied");
    const edit = await run(
      await draftOf(
        [
          { op: "edit", target: "tth", text: "New root." },
          { op: "edit", target: "tth.1", text: "New reply." },
        ],
        "call-3",
      ),
    );
    expect(edit.rows.map((row) => [row.status, row.code])).toEqual([
      web ? ["refused", "HIDDEN_TEXT"] : ["applied", undefined],
      ["applied", undefined],
    ]);
    stillHidden();
    // Refs here are named by the root's text, which the edit changed where it applied.
    const root = web ? "tth" : "tne";
    const remove = await run(
      await draftOf([{ op: "delete", target: root }], "call-4"),
    );
    expect([remove.rows[0].status, remove.rows[0].code]).toEqual(
      web ? ["refused", "HIDDEN_TEXT"] : ["applied", undefined],
    );
    stillHidden();
  });

  it("leaves a Revert on the thread alone once hidden text is beside it", async () => {
    installHidden();
    const { rows } = await run(
      await draftOf([{ op: "resolve", thread: "ttp" }]),
    );
    expect(rows[0].status).toBe("applied");
    host.format({ p: "PL1", text: "Plain" }, { text: "Plain", hidden: true });
    const reverted = await revertWordCommentRows(
      [{ i: 0, step: rows[0].revert! }],
      PLATFORM[which],
      0,
    );
    expect(reverted.rows[0].status).toBe(web ? "stale" : "reverted");
    expect(host.ooxml({ p: "PL1" })).toMatch(/<w:vanish\/>/);
  });
});

describe("a run that times out", () => {
  it("reports queued writes unverified and waits for Word to settle", async () => {
    install("pc");
    const draft = await draftOf([
      { op: "add", anchor: { para: 4, quote: "alpha" }, text: "slow" },
    ]);
    vi.useFakeTimers();
    const hang = host.hangSync({ execute: "immediately" });
    const result = run(draft);
    await hang.reached;
    await vi.advanceTimersByTimeAsync(WORD_COMMENT_RUN_TIMEOUT_MS + 2_000);
    const { rows, timedOut } = await result;
    expect(timedOut).toBe(true);
    expect(rows[0].status).toMatch(/failed|unverified/);
    hang.release();
  });
});
