import { describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import {
  WORD_SNAPSHOT_REPLACED,
  WordDocumentReadSession,
} from "../wordDocumentReadTool";

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
    expect(read.ok ? "" : read.validationErrors?.[0]?.code).not.toBe(
      "capture-unavailable",
    );
    expect(session.liveCapture(token)).toBeDefined();
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
});
