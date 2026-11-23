import { beforeEach, describe, expect, it, vi } from "vitest";

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
  submission_call_id: "submit-C",
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
