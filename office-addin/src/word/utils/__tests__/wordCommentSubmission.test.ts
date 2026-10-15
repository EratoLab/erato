import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  selectionSnapshot,
  storyFacts,
  threadMap,
} from "../../../test/mocks/word/commentDrafts";
import {
  createWordCommentSubmissionExecutor,
  forgetWordCommentDrafts,
  WORD_COMMENT_NOTHING_WRITTEN,
  wordCommentDraft,
} from "../wordCommentSubmission";

import type { WordCommentSubmissionScope } from "../wordCommentReadTool";
import type { ClientToolCallContext } from "@erato/frontend/library";

const THREADS = threadMap({
  ref: "t7k",
  id: "101",
  replies: [{ id: "102" }],
});
const STORY = storyFacts(["Intro.", "Lieferung binnen 14 Tagen."]);

let scope: WordCommentSubmissionScope | null;
const readStory = vi.fn(async () => STORY);

function executor() {
  return createWordCommentSubmissionExecutor({
    session: { submissionScope: () => scope },
    readStory,
  });
}

const context = (toolCallId: string): ClientToolCallContext => ({
  toolCallId,
  messageId: "assistant-1",
  chatId: "chat-1",
});

beforeEach(() => {
  forgetWordCommentDrafts();
  readStory.mockClear();
  scope = {
    token: "session-1",
    identity: "doc-1",
    capture: {
      identity: "doc-1",
      ordinalMap: new Map(),
      paragraphsSent: 0,
      renderedOrdinals: new Set(),
      partialOrdinal: null,
    },
    threads: THREADS,
    people: { principalEmail: "me@contoso.test" },
  };
});
afterEach(() => {
  delete window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS;
});

describe("word_submit_comment_changes", () => {
  it("accepts a valid proposal as a draft and says nothing is written yet", async () => {
    const result = await executor()(
      { changes: [{ op: "resolve", thread: "t7k" }] },
      context("call-1"),
    );
    expect(result).toEqual({
      ok: true,
      result: {
        draft_id: "call-1",
        action: "word.respond_to_comments",
        rows: 1,
        status: "awaiting_user",
        note: WORD_COMMENT_NOTHING_WRITTEN,
      },
    });
    expect(wordCommentDraft("call-1")).toMatchObject({
      action: "word.respond_to_comments",
      identity: "doc-1",
      rows: [{ op: "resolve", ref: "t7k" }],
    });
    expect(readStory).not.toHaveBeenCalled();
  });

  it("reads paragraphs only for adds that name one", async () => {
    const run = executor();
    const result = await run(
      {
        changes: [
          { op: "add", anchor: { para: 2, quote: "binnen" }, text: "Prüfen." },
        ],
      },
      context("call-1"),
    );
    expect(result.ok).toBe(true);
    expect(readStory).toHaveBeenCalledTimes(1);
    expect(wordCommentDraft("call-1")?.rows[0].finalText).toBe(
      "Erato AI: Prüfen.",
    );
  });

  it("anchors on the capture's selection without reading paragraphs", async () => {
    scope = {
      ...scope!,
      capture: {
        ...scope!.capture!,
        selection: selectionSnapshot(STORY, 1, 1, 10, 16),
      } as WordCommentSubmissionScope["capture"],
    };
    const result = await executor()(
      { changes: [{ op: "add", anchor: "selection", text: "x" }] },
      context("call-1"),
    );
    expect(result.ok).toBe(true);
    expect(readStory).not.toHaveBeenCalled();
  });

  it("uses the deployment's label", async () => {
    window.MS_OFFICE_ADDIN_DEFAULT_SETTINGS = { comment_label: "KI:" };
    await executor()(
      { changes: [{ op: "reply", thread: "t7k", text: "Ok." }] },
      context("call-1"),
    );
    expect(wordCommentDraft("call-1")?.rows[0].finalText).toBe("KI: Ok.");
  });

  it("lets the model repair once, then makes it ask the user", async () => {
    const run = executor();
    const first = await run(
      { changes: [{ op: "resolve", thread: "t00" }] },
      context("call-1"),
    );
    expect(first).toMatchObject({
      ok: false,
      validationErrors: [{ code: "unknown-ref" }],
      submissionFeedback: { terminal: false, recovery: "repair_arguments" },
    });
    const second = await run(
      { changes: [{ op: "resolve", thread: "t01" }] },
      context("call-2"),
    );
    expect(second).toMatchObject({
      ok: false,
      validationErrors: [{ code: "ask-user" }, { code: "unknown-ref" }],
      submissionFeedback: { terminal: true, recovery: "cannot_continue" },
    });
    const third = await run(
      { changes: [{ op: "resolve", thread: "t7k" }] },
      context("call-3"),
    );
    expect(third).toMatchObject({
      ok: false,
      validationErrors: [{ code: "ask-user" }],
      submissionFeedback: { terminal: true },
    });
    expect(wordCommentDraft("call-3")).toBeUndefined();
  });

  it("answers a redelivered call the same way, and refuses one with other arguments", async () => {
    const run = executor();
    const input = { changes: [{ op: "resolve", thread: "t7k" }] };
    const first = await run(input, context("call-1"));
    expect(await run(input, context("call-1"))).toBe(first);
    expect(
      await run(
        { changes: [{ op: "reopen", thread: "t7k" }] },
        context("call-1"),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "call-conflict" }],
    });
  });

  it("makes one proposal per request", async () => {
    const run = executor();
    await run(
      { changes: [{ op: "resolve", thread: "t7k" }] },
      context("call-1"),
    );
    expect(
      await run(
        { changes: [{ op: "reopen", thread: "t7k" }] },
        context("call-2"),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "already-proposed" }],
      submissionFeedback: { terminal: true },
    });
  });

  it("starts counting again for a new request", async () => {
    const run = executor();
    await run(
      { changes: [{ op: "resolve", thread: "t7k" }] },
      context("call-1"),
    );
    scope = { ...scope!, token: "session-2" };
    expect(
      (
        await run(
          { changes: [{ op: "reopen", thread: "t7k" }] },
          context("call-2"),
        )
      ).ok,
    ).toBe(true);
  });

  it("ends the turn when the request has no comment session", async () => {
    scope = null;
    expect(
      await executor()(
        { changes: [{ op: "resolve", thread: "t7k" }] },
        context("call-1"),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "comments-unavailable" }],
      submissionFeedback: { terminal: true },
    });
  });

  it("refuses to validate quotes when Word hands over no paragraphs", async () => {
    readStory.mockResolvedValueOnce(null as never);
    expect(
      await executor()(
        {
          changes: [
            { op: "add", anchor: { para: 2, quote: "binnen" }, text: "x" },
          ],
        },
        context("call-1"),
      ),
    ).toMatchObject({
      ok: false,
      validationErrors: [{ code: "document-read-failed" }],
    });
  });
});
