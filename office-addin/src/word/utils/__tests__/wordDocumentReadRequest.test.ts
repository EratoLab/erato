import { beforeEach, describe, expect, it, vi } from "vitest";

import { readySnapshot } from "../../../test/mocks/word/authoringFixtures";
import { createWordReadRequestStore } from "../../../test/mocks/word/readRequestStore";
import { bindWordDocumentReadRequest } from "../wordDocumentReadRequest";
import { WordDocumentReadSession } from "../wordDocumentReadTool";

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

beforeEach(() => {
  mock.store = createWordReadRequestStore();
});
const context = {
  chatId: "chat-A",
  messageId: "message-A",
  toolCallId: "read",
};

describe("Word send ownership", () => {
  it("binds the first turn of a chat already created for an attachment", async () => {
    const session = new WordDocumentReadSession();
    const s = readySnapshot();
    session.activate(s);
    mock.store!.setState({ activeStreamKey: "upload-chat" });
    bindWordDocumentReadRequest(session, s.token, null);
    mock.store!.setState({
      streams: {
        "upload-chat": { currentMessageId: "message-A", isStreaming: true },
      },
    });
    expect(
      (
        await session.execute(
          { snapshot: s.token },
          { ...context, chatId: "upload-chat" },
        )
      ).ok,
    ).toBe(true);
    expect(mock.store!.listenerCount()).toBe(0);
  });

  it("releases a failed send before a later task reaction starts", async () => {
    const session = new WordDocumentReadSession();
    const s = readySnapshot();
    session.activate(s);
    bindWordDocumentReadRequest(session, s.token, "chat-A");
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "temp-assistant-1", isStreaming: true },
      },
    });
    mock.store!.setState({ streams: {} });
    expect(mock.store!.listenerCount()).toBe(0);
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "reaction", isStreaming: true },
      },
    });
    expect(s.ownerMessageId).toBeUndefined();
    expect(
      await session.execute(
        { snapshot: s.token },
        { ...context, messageId: "reaction" },
      ),
    ).toMatchObject({ ok: false });
  });

  it("binds synchronously before a tool event in the same SSE chunk, and only once", async () => {
    const session = new WordDocumentReadSession();
    const s = readySnapshot();
    session.activate(s);
    bindWordDocumentReadRequest(session, s.token, "chat-A");
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "temp-assistant-1", isStreaming: true },
      },
    });
    expect(s.ownerMessageId).toBeUndefined();
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "message-A", isStreaming: true },
      },
    });
    expect(mock.store!.listenerCount()).toBe(0);
    expect((await session.execute({ snapshot: "old-turn" }, context)).ok).toBe(
      true,
    );
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "reaction", isStreaming: true },
      },
    });
    expect(
      await session.execute(
        { snapshot: s.token },
        { ...context, messageId: "reaction" },
      ),
    ).toMatchObject({ ok: false });
    expect(s.ownerMessageId).toBe("message-A");
  });

  it("follows the sending new chat's alias while another chat becomes active", async () => {
    const session = new WordDocumentReadSession();
    const s = readySnapshot();
    session.activate(s);
    mock.store!.setState({ activeStreamKey: "pending-new-chat" });
    bindWordDocumentReadRequest(session, s.token, null);
    mock.store!.setState({
      activeStreamKey: "other-chat",
      streamKeyAliases: { "pending-new-chat": "chat-A" },
      streams: {
        "chat-A": { currentMessageId: "message-A", isStreaming: true },
        "other-chat": { currentMessageId: "message-other", isStreaming: true },
      },
    });
    expect((await session.execute({ snapshot: "old-turn" }, context)).ok).toBe(
      true,
    );
    expect(
      await session.execute(
        { snapshot: s.token },
        { ...context, chatId: "other-chat", messageId: "message-other" },
      ),
    ).toMatchObject({ ok: false });
  });

  it("ignores the previous response and prevents a replaced or cancelled binding from claiming the next capture", async () => {
    const session = new WordDocumentReadSession();
    const old = readySnapshot();
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "message-previous", isStreaming: true },
      },
    });
    session.activate(old);
    const stop = bindWordDocumentReadRequest(session, old.token, "chat-A");
    mock.store!.setState({});
    expect(old.ownerMessageId).toBeUndefined();
    const next = readySnapshot();
    session.activate(next);
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "message-A", isStreaming: true },
      },
    });
    expect(next.ownerMessageId).toBeUndefined();
    expect(
      await session.execute({ snapshot: next.token }, context),
    ).toMatchObject({ ok: false });
    stop();
    const cancel = bindWordDocumentReadRequest(session, next.token, "chat-A");
    cancel();
    mock.store!.setState({
      streams: {
        "chat-A": { currentMessageId: "message-B", isStreaming: true },
      },
    });
    expect(next.ownerMessageId).toBeUndefined();
    expect(mock.store!.listenerCount()).toBe(0);
  });
});
