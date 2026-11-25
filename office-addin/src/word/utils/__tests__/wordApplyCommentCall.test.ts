import { beforeEach, describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { createWordApplyCommentsExecutor } from "../wordApplyCommentCall";
import { WORD_CLIENT_ACTIONS } from "../wordClientActions";
import { wordCommentAlwaysBlock } from "../wordCommentCard";
import { wordCommentDraft } from "../wordCommentSubmission";
import { WordDocumentReadSession } from "../wordDocumentReadTool";

import type { WordWriteBridge } from "../wordWriteBridge";

vi.mock("../wordCommentSubmission", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  wordCommentDraft: vi.fn(),
}));
vi.mock("../wordCommentCard", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  wordCommentCardMode: () => "post",
  wordCommentAlwaysBlock: vi.fn(() => null),
  wordCommentAuthorPlan: () => ({
    authorName: "Erato",
    userModeRows: new Map(),
  }),
  recordWordCommentOutcome: vi.fn(),
}));
vi.mock("../wordReviewLocation", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readWordTrackingMode: async () => "Off",
}));

const draft = {
  draftId: "submit-C",
  action: "word.respond_to_comments",
  identity: "doc-A",
  host: "PC",
  label: "Erato",
  authorMode: "assistant",
  rows: [
    { i: 0, op: "resolve", ref: "c1" },
    { i: 1, op: "resolve", ref: "c2" },
  ],
};

const bridge: WordWriteBridge = {
  documentIdentity: () => "doc-A",
  updateReview: vi.fn(),
  beginOperation: () => true,
  endOperation: vi.fn(),
  holdOperationUntil: vi.fn(),
  setRevertSlot: vi.fn(),
  invalidateLocations: vi.fn(),
  messageContext: () => ({}),
};

const context = {
  toolCallId: "submit-C.apply",
  messageId: "message-A",
  chatId: "chat-A",
};
const input = (confirmation: Record<string, unknown> | null = null) => ({
  proposal_call_id: "submit-C",
  draft_id: "submit-C",
  confirmation,
});

const executor = () =>
  createWordApplyCommentsExecutor({
    session: new WordDocumentReadSession(),
    readEnabled: () => true,
    bridge: () => bridge,
  });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(wordCommentDraft).mockReturnValue(draft as never);
  vi.mocked(wordCommentAlwaysBlock).mockReturnValue(null);
});

describe("the server's apply of accepted comment changes", () => {
  it("writes the rows the user kept and reports what was left out", async () => {
    const entry = WORD_CLIENT_ACTIONS.get("word.respond_to_comments")!;
    const execute = vi.spyOn(entry, "execute").mockResolvedValue({
      ok: true,
      outcomes: [],
      snapshotOoxml: null,
      commentResult: {
        rows: [
          { i: 0, op: "resolve", ref: "c1", status: "applied" },
          { i: 1, op: "resolve", ref: "c2", status: "failed" },
        ] as never,
        settled: Promise.resolve(),
        timedOut: false,
      },
    });
    expect(await executor()(input({ selected: [0, 1] }), context)).toEqual({
      ok: true,
      result: {
        status: "partial",
        verified: true,
        undo_steps: 1,
        left_out: ["#2"],
      },
    });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        fenceContent: "submit-C",
        comments: expect.objectContaining({ selected: new Set([0, 1]) }),
      }),
    );
  });

  it("keeps the rows the user left out on the shared review, as the card does", async () => {
    const entry = WORD_CLIENT_ACTIONS.get("word.respond_to_comments")!;
    vi.spyOn(entry, "execute").mockResolvedValue({
      ok: true,
      outcomes: [],
      snapshotOoxml: null,
      commentResult: {
        rows: [{ i: 0, op: "resolve", ref: "c1", status: "applied" }] as never,
        settled: Promise.resolve(),
        timedOut: false,
      },
    });
    expect(await executor()(input({ selected: [0] }), context)).toEqual({
      ok: true,
      result: { status: "applied", verified: true, undo_steps: 1 },
    });
    expect(bridge.updateReview).toHaveBeenLastCalledWith(
      "message-A:word.respond_to_comments:submit-C",
      expect.objectContaining({
        status: "done",
        comments: expect.objectContaining({
          rows: [
            expect.objectContaining({ i: 0, status: "applied" }),
            expect.objectContaining({
              i: 1,
              status: "refused",
              code: "DESELECTED",
            }),
          ],
        }),
      }),
    );
  });

  it("keeps Word busy for every card while a timed-out write may still run", async () => {
    const entry = WORD_CLIENT_ACTIONS.get("word.respond_to_comments")!;
    const settled = new Promise<void>(() => {});
    vi.spyOn(entry, "execute").mockResolvedValue({
      ok: false,
      outcomes: [],
      snapshotOoxml: null,
      commentResult: {
        rows: [{ i: 0, op: "resolve", ref: "c1", status: "failed" }] as never,
        settled,
        timedOut: true,
      },
    });
    await executor()(input({ selected: [0] }), context);
    expect(bridge.holdOperationUntil).toHaveBeenCalledWith(
      settled,
      "message-A:word.respond_to_comments:submit-C",
    );
    expect(bridge.endOperation).not.toHaveBeenCalled();
  });

  it("leaves an answer sent with the document a new copy to read, and no plan on the old one", async () => {
    const entry = WORD_CLIENT_ACTIONS.get("word.respond_to_comments")!;
    vi.spyOn(entry, "execute").mockResolvedValue({
      ok: true,
      outcomes: [],
      snapshotOoxml: null,
      commentResult: {
        rows: [{ i: 0, op: "resolve", ref: "c1", status: "applied" }] as never,
        settled: Promise.resolve(),
        timedOut: false,
      },
    });
    const session = new WordDocumentReadSession();
    const sent = readySnapshot();
    session.activate(sent, context, undefined, { request: "Resolve them" });
    const answer = await createWordApplyCommentsExecutor({
      session,
      readEnabled: () => true,
      bridge: () => bridge,
    })(input({ selected: [0] }), context);
    expect(answer).toMatchObject({
      ok: true,
      result: { status: "applied", snapshot: expect.any(String) },
    });
    expect(sent.used).toBe(true);

    // A request sent without the document has no copy to read again.
    const commentsOnly = await executor()(input({ selected: [0] }), {
      ...context,
      toolCallId: "submit-D.apply",
    });
    expect(commentsOnly.ok && commentsOnly.result).not.toHaveProperty(
      "snapshot",
    );
  });

  it("asks on screen where the card would not run on its own", async () => {
    vi.mocked(wordCommentAlwaysBlock).mockReturnValue("tainted");
    expect(await executor()(input(), context)).toEqual({
      ok: true,
      result: { status: "needs_decision", reason: "comment_rows" },
    });
  });

  it("refuses another document", async () => {
    vi.mocked(wordCommentDraft).mockReturnValue({
      ...draft,
      identity: "doc-B",
    } as never);
    expect(await executor()(input(), context)).toEqual({
      ok: true,
      result: { status: "unavailable", reason: "other_document" },
    });
  });
});
