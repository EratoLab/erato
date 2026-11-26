import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CONVERSATION_MARGIN_PX,
  restingTop,
  usePersonTurn,
  visibleListHeight,
  writtenAnswerStart,
} from "./conversationFollow";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";
import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const part = (content_type: string) =>
  ({ content_type, text: "" }) as unknown as ContentPart;

describe("writtenAnswerStart", () => {
  it("is the first text of the answer that ends the reply", () => {
    expect(
      writtenAnswerStart([
        part("spoken"),
        part("tool_use"),
        part("text"),
        part("text"),
      ]),
    ).toBe(2);
  });

  it("is none while lookups run or a card waits", () => {
    expect(writtenAnswerStart([part("spoken"), part("tool_use")])).toBe(-1);
    expect(
      writtenAnswerStart([part("text"), part("tool_approval_request")]),
    ).toBe(-1);
  });
});

describe.each([828, 772, 648])("restingTop (view %ipx)", (clientHeight) => {
  it("keeps the start of the written answer in view", () => {
    expect(
      restingTop({ clientHeight, waitingCard: null, answerStart: 2_000 }),
    ).toBe(2_000 - CONVERSATION_MARGIN_PX);
  });

  it("shows a waiting card whole when it fits, else its decision at its end", () => {
    const fits = { top: 3_000, height: clientHeight - 100 };
    expect(
      restingTop({ clientHeight, waitingCard: fits, answerStart: null }),
    ).toBe(3_000 - CONVERSATION_MARGIN_PX);

    const tall = { top: 3_000, height: clientHeight + 300 };
    expect(
      restingTop({ clientHeight, waitingCard: tall, answerStart: null }),
    ).toBe(3_000 + 300 + CONVERSATION_MARGIN_PX);
  });
});

const message = (
  id: string,
  role: "user" | "assistant",
  minute: number,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id,
  role,
  content: [],
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  sender: role,
  authorId: role,
  ...extra,
});

const turnOf = (initial: ChatMessage[]) => {
  const view = renderHook(
    ({ list }) =>
      usePersonTurn(
        list.map((entry) => entry.id),
        Object.fromEntries(list.map((entry) => [entry.id, entry])),
      ),
    { initialProps: { list: initial } },
  );
  return {
    turn: () => view.result.current.turn,
    replying: () => view.result.current.replying,
    update: (list: ChatMessage[]) => view.rerender({ list }),
  };
};

describe("usePersonTurn", () => {
  const answered = [message("u1", "user", 0), message("a1", "assistant", 1)];

  it("counts a message the person sends, not the saved one replacing it", () => {
    const { turn, update, replying } = turnOf(answered);
    const before = turn();

    update([
      ...answered,
      message("temp-user-2", "user", 2, { status: "sending" }),
    ]);
    expect(turn()).toBe(before + 1);
    expect(replying()).toBe(true);

    update([...answered, message("u2", "user", 3)]);
    expect(turn()).toBe(before + 1);
  });

  it("counts an edit of the person's last message", () => {
    const { turn, update } = turnOf(answered);
    const before = turn();

    update([message("temp-user-2", "user", 2, { status: "sending" })]);
    expect(turn()).toBe(before + 1);
  });

  it("does not count the reply streaming in", () => {
    const { turn, update, replying } = turnOf(answered);
    const before = turn();

    update([
      ...answered.slice(0, 1),
      message("a1", "assistant", 1, { loading: { state: "typing" } }),
    ]);
    expect(turn()).toBe(before);
    expect(replying()).toBe(true);
  });
});

describe("visibleListHeight", () => {
  it("leaves out what a floating composer covers", () => {
    const list = document.createElement("div");
    vi.spyOn(list, "clientHeight", "get").mockReturnValue(600);
    expect(visibleListHeight(list)).toBe(600);

    // jsdom computes no scroll padding.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      scrollPaddingBottom: "90px",
    } as CSSStyleDeclaration);
    expect(visibleListHeight(list)).toBe(510);
    vi.restoreAllMocks();
  });
});
