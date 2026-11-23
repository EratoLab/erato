import { describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { registerWordClientTools } from "../wordClientTools";
import {
  WordCommentReadSession,
  wordCommentReadSession,
} from "../wordCommentReadTool";
import {
  WORD_SNAPSHOT_REPLACED,
  WordDocumentReadSession,
  wordDocumentReadSession,
} from "../wordDocumentReadTool";

import type { WordCommentSendCapture } from "../wordCommentReadTool";
import type { WordRequestCapture } from "../wordRequestCapture";
import type { ClientToolCallContext } from "@erato/frontend/library";

const context: ClientToolCallContext = {
  toolCallId: "read-1",
  messageId: "message-A",
  chatId: "chat-A",
};

function answerWithAppliedChange() {
  const capture = vi.fn(
    async (): Promise<WordRequestCapture> => ({
      snapshot: readySnapshot(),
      capture: {},
      reusedVerifiedBody: false,
    }),
  );
  const session = new WordDocumentReadSession(capture);
  const first = readySnapshot();
  session.activate(first, context, undefined, { request: "Shorten it" });
  first.used = true;
  const token = session.reserveSuccessor({
    chatId: "chat-A",
    messageId: "message-A",
    identity: "doc-A",
  });
  return { session, capture, first, token };
}

describe("the copy an applied change leaves for its answer", () => {
  it("is read from Word only when the answer reads again", async () => {
    const { session, capture, token } = answerWithAppliedChange();
    expect(capture).not.toHaveBeenCalled();
    const read = await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(capture).toHaveBeenCalledTimes(1);
    expect(read).toMatchObject({ ok: true, result: { snapshot: token } });
    expect(session.liveCapture(token)?.authoring?.token).toBe(token);
    expect(session.request).toBe("Shorten it");
  });

  it("answers a read of the used copy with the new token, not as final", async () => {
    const { session, first, token } = answerWithAppliedChange();
    const read = await session.execute(
      { snapshot: first.token },
      { ...context, toolCallId: "read-2" },
    );
    expect(read).toMatchObject({
      ok: false,
      validationErrors: [{ code: WORD_SNAPSHOT_REPLACED }],
    });
    expect(read.ok ? "" : read.error).toContain(token);
    expect(read.ok ? undefined : read.submissionFeedback).toBeUndefined();
  });

  it("keeps a lost capture final for another request's token", async () => {
    const { session } = answerWithAppliedChange();
    const read = await session.execute(
      { snapshot: "unknown-token" },
      { ...context, toolCallId: "read-2", messageId: "message-B" },
    );
    expect(read).toMatchObject({ ok: false });
    expect(read.ok ? "" : read.validationErrors?.[0]?.code).not.toBe(
      WORD_SNAPSHOT_REPLACED,
    );
  });

  it("lets a delegated task granted the earlier copy read the current one", async () => {
    const { session, first, token } = answerWithAppliedChange();
    const read = await session.execute(
      { snapshot: first.token, section: { ref: "b1" } },
      {
        toolCallId: "child-read",
        messageId: "child-message",
        chatId: "child-chat",
        hostGrant: {
          requestingChatId: "child-chat",
          requestingMessageId: "child-message",
          ownerChatId: "chat-A",
          ownerMessageId: "message-A",
          contextRef: first.token,
        },
      },
    );
    expect(read).toMatchObject({ ok: true, result: { snapshot: token } });
    expect(session.liveCapture(token)).toBeDefined();
  });

  it("checks the new copy's complete-read budget as Send did", async () => {
    const session = new WordDocumentReadSession(async () => ({
      snapshot: readySnapshot(),
      capture: {},
      reusedVerifiedBody: false,
    }));
    const budget = vi.fn(async () => "too-large");
    session.activate(readySnapshot(), context, undefined, {
      request: "Shorten it",
      budgetFor: () => budget,
    });
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
    });
    await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(await session.completeReadIssue()).toBe("too-large");
    expect(budget).toHaveBeenCalledTimes(1);
  });

  it("allows only scoped reads of a copy rebuilt after a pane reload", async () => {
    const session = new WordDocumentReadSession(async () => ({
      snapshot: readySnapshot(),
      capture: {},
      reusedVerifiedBody: false,
    }));
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
      requestText: "Shorten it",
    });
    await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(session.liveCapture(token)).toBeDefined();
    expect(await session.completeReadIssue()).toBe("budget-unavailable");
  });

  it("says the request has to be sent again when the copy cannot be read", async () => {
    const session = new WordDocumentReadSession(async () => null);
    session.activate(readySnapshot(), context);
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
    });
    expect(
      await session.execute(
        { snapshot: token },
        { ...context, toolCallId: "read-2" },
      ),
    ).toMatchObject({
      ok: false,
      submissionFeedback: { terminal: true, recovery: "cannot_continue" },
    });
  });

  it("never takes another request's images or budget for this answer's copy", async () => {
    const session = new WordDocumentReadSession(async () => ({
      snapshot: readySnapshot(),
      capture: {},
      reusedVerifiedBody: false,
    }));
    const newer = readySnapshot();
    newer.assets = [{ fileId: "img-B" } as never];
    session.activate(
      newer,
      { chatId: "chat-A", messageId: "message-B" },
      undefined,
      { request: "Other request", budgetFor: () => async () => undefined },
    );
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
      requestText: "Shorten it",
    });
    expect(newer.used).toBeFalsy();
    await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(session.liveCapture(token)?.authoring?.assets).toBeUndefined();
    expect(await session.completeReadIssue()).toBe("budget-unavailable");
  });

  it("keeps the images of the answer's earlier copy without fetching them again", async () => {
    const { session, first } = answerWithAppliedChange();
    first.assets = [{ fileId: "img-A" } as never];
    const captureImages = vi.fn(async () => null);
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
      captureImages,
    });
    await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(captureImages).not.toHaveBeenCalled();
    expect(session.liveCapture(token)?.authoring?.assets).toEqual(first.assets);
  });
});

describe("comment reads after a change of the same answer", () => {
  const ordinalMap = (texts: string[]) =>
    new Map(
      texts.map((text, i) => [
        i + 1,
        { uniqueLocalId: `p${i + 1}`, text } as never,
      ]),
    );
  const commentSession = (map: ReturnType<typeof ordinalMap>) => {
    const comments = new WordCommentReadSession();
    comments.activate(
      {
        identity: "doc-A",
        gestures: { document: true },
        inventory: { source: "capture", paragraphs: [] },
        capture: { ordinalMap: map } as unknown as WordCommentSendCapture,
      },
      { chatId: "chat-A", messageId: "message-A" },
    );
    return comments;
  };

  it("number paragraphs as the new copy does, and none until it is read", async () => {
    const session = new WordDocumentReadSession(async () => ({
      snapshot: readySnapshot(),
      capture: { ordinalMap: ordinalMap(["New first.", "Old first."]) },
      reusedVerifiedBody: false,
    }));
    const comments = commentSession(ordinalMap(["Old first."]));
    session.followCopies((owner, map) => comments.followDocument(owner, map));
    session.activate(readySnapshot(), context, undefined, { request: "x" });
    const token = session.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
    });
    expect(comments.submissionScope(context)?.capture?.ordinalMap.size).toBe(0);
    await session.execute(
      { snapshot: token },
      { ...context, toolCallId: "read-2" },
    );
    expect(
      comments.submissionScope(context)?.capture?.ordinalMap.get(1),
    ).toMatchObject({ text: "New first." });
  });

  it("leave another request's comment session alone", () => {
    const comments = commentSession(ordinalMap(["Kept."]));
    comments.followDocument({ chatId: "chat-A", messageId: "message-B" }, null);
    expect(comments.submissionScope(context)?.capture?.ordinalMap.size).toBe(1);
  });

  it("follow the pane's document session while its tools are registered", () => {
    const unregister = registerWordClientTools({
      readEnabled: () => true,
      bindingIdentity: () => undefined,
    });
    wordCommentReadSession.activate(
      {
        identity: "doc-A",
        gestures: { document: true },
        capture: {
          ordinalMap: ordinalMap(["Old first."]),
        } as unknown as WordCommentSendCapture,
      },
      { chatId: "chat-A", messageId: "message-A" },
    );
    wordDocumentReadSession.activate(readySnapshot(), context);
    wordDocumentReadSession.reserveSuccessor({
      chatId: "chat-A",
      messageId: "message-A",
      identity: "doc-A",
    });
    expect(
      wordCommentReadSession.submissionScope(context)?.capture?.ordinalMap.size,
    ).toBe(0);
    unregister();
    wordDocumentReadSession.clear();
    wordCommentReadSession.clear();
  });
});
