import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSSEConnection } from "@/utils/sse/sseClient";

import {
  MESSAGE_EXPLAIN_MAX_FOLLOW_UPS,
  takeMessageExplainFocusRequest,
  useMessageExplainStore,
} from "../messageExplainStore";

import type { SSEOptions } from "@/utils/sse/sseClient";

vi.mock("@/utils/sse/sseClient", () => ({ createSSEConnection: vi.fn() }));

const anchor = {
  startBlock: "0:1",
  startOffset: 3,
  endBlock: "0:1",
  endOffset: 12,
};

interface Connection {
  url: string;
  options: SSEOptions;
  close: ReturnType<typeof vi.fn>;
}

const connections: Connection[] = [];
const lastConnection = () => connections.at(-1)!;
const send = (connection: Connection, message: object) =>
  connection.options.onMessage?.({
    type: "message",
    data: JSON.stringify(message),
  });
const answer = (connection: Connection, text: string) => {
  send(connection, { message_type: "text_delta", text });
  send(connection, { message_type: "completed" });
};
const card = () => useMessageExplainStore.getState().card;
const { open, ask, retry, close } = useMessageExplainStore.getState();

beforeEach(() => {
  close();
  connections.length = 0;
  vi.mocked(createSSEConnection).mockReset();
  vi.mocked(createSSEConnection).mockImplementation((url, options = {}) => {
    const connection = { url, options, close: vi.fn() };
    connections.push(connection);
    return connection.close;
  });
});

describe("messageExplainStore", () => {
  it("opens with the explanation loading and streams it in", () => {
    open({ messageId: "m1", passage: "a term", anchor });

    expect(card()).toMatchObject({
      messageId: "m1",
      passage: "a term",
      turns: [{ question: null, answer: "", status: "loading" }],
    });
    expect(lastConnection().url).toBe("/api/v1beta/me/messages/m1/explain");
    expect(JSON.parse(lastConnection().options.body!)).toMatchObject({
      selected_text: "a term",
      turns: [],
    });

    send(lastConnection(), { message_type: "text_delta", text: "It " });
    send(lastConnection(), { message_type: "text_delta", text: "means X." });
    expect(card()?.turns[0]).toMatchObject({
      answer: "It means X.",
      status: "streaming",
    });

    send(lastConnection(), { message_type: "completed" });
    lastConnection().options.onClose?.();
    expect(card()?.turns[0].status).toBe("done");
  });

  it("sends the whole small chat with a follow-up question", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    answer(lastConnection(), "It means X.");

    ask("  Why?  ");

    expect(card()?.turns).toHaveLength(2);
    expect(card()?.turns[1]).toMatchObject({
      question: "Why?",
      status: "loading",
    });
    expect(JSON.parse(lastConnection().options.body!).turns).toEqual([
      { role: "assistant", text: "It means X." },
      { role: "user", text: "Why?" },
    ]);
  });

  it("takes no question while an answer is on its way or after it failed", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    ask("Too early?");
    expect(card()?.turns).toHaveLength(1);

    lastConnection().options.onError?.(new Error("offline"));
    expect(card()?.turns[0].status).toBe("error");
    ask("After the failure?");
    expect(card()?.turns).toHaveLength(1);
  });

  it("stops after the follow-up limit", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    answer(lastConnection(), "It means X.");
    for (let count = 0; count < MESSAGE_EXPLAIN_MAX_FOLLOW_UPS + 1; count++) {
      ask(`Question ${count}`);
      if (connections.length === count + 2) {
        answer(lastConnection(), `Answer ${count}`);
      }
    }

    expect(card()?.turns).toHaveLength(1 + MESSAGE_EXPLAIN_MAX_FOLLOW_UPS);
  });

  it("marks a failed, cut-off or empty answer as an error and retries it", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    send(lastConnection(), { message_type: "failed" });
    expect(card()?.turns[0].status).toBe("error");

    retry();
    expect(connections).toHaveLength(2);
    expect(card()?.turns[0]).toMatchObject({ answer: "", status: "loading" });
    send(lastConnection(), { message_type: "text_delta", text: "Partial" });
    lastConnection().options.onClose?.();
    expect(card()?.turns[0]).toMatchObject({
      answer: "Partial",
      status: "error",
    });

    retry();
    send(lastConnection(), { message_type: "completed" });
    expect(card()?.turns[0].status).toBe("error");

    retry();
    answer(lastConnection(), "It means X.");
    expect(card()?.turns).toEqual([
      expect.objectContaining({ answer: "It means X.", status: "done" }),
    ]);
  });

  it("keeps one small chat: opening another replaces it and drops its request", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    const first = lastConnection();

    open({ messageId: "m2", passage: "another term", anchor });

    expect(first.close).toHaveBeenCalled();
    send(first, { message_type: "text_delta", text: "late text" });
    expect(card()).toMatchObject({
      messageId: "m2",
      passage: "another term",
      turns: [{ answer: "", status: "loading" }],
    });
  });

  it("discards everything on close", () => {
    open({ messageId: "m1", passage: "a term", anchor });
    const connection = lastConnection();

    close();

    expect(connection.close).toHaveBeenCalled();
    expect(card()).toBeNull();
    send(connection, { message_type: "text_delta", text: "late text" });
    expect(card()).toBeNull();
  });

  it("asks for focus once per opening", () => {
    open({ messageId: "m1", passage: "a term", anchor });

    expect(takeMessageExplainFocusRequest()).toBe(true);
    expect(takeMessageExplainFocusRequest()).toBe(false);
  });

  it("is not persisted, so a reload starts without a card", async () => {
    open({ messageId: "m1", passage: "a term", anchor });
    expect(
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ).not.toContain("a term");

    vi.resetModules();
    const reloaded = await import("../messageExplainStore");

    expect(reloaded.useMessageExplainStore.getState().card).toBeNull();
  });
});
