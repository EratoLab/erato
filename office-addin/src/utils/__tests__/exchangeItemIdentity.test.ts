import { describe, expect, it } from "vitest";

import { resolveEditExchangeItemIdentity } from "../exchangeItemIdentity";

import type { Message } from "@erato/frontend/library";

function message(
  id: string,
  role: "user" | "assistant",
  previousMessageId?: string,
): Message {
  return {
    id,
    role,
    status: "complete",
    content: [],
    createdAt: "2026-07-20T00:00:00Z",
    previous_message_id: previousMessageId,
  };
}

/** [u1, a1, u2, a2] — two complete exchanges. */
const messages: Record<string, Message> = {
  u1: message("u1", "user"),
  a1: message("a1", "assistant", "u1"),
  u2: message("u2", "user"),
  a2: message("a2", "assistant", "u2"),
};
const messageOrder = ["u1", "a1", "u2", "a2"];

describe("resolveEditExchangeItemIdentity", () => {
  it("returns the identity of the assistant that replied to the edited message", () => {
    const identities = new Map([
      ["a1", "item-alpha"],
      ["a2", "item-beta"],
    ]);

    expect(
      resolveEditExchangeItemIdentity(messages, messageOrder, "u1", identities),
    ).toBe("item-alpha");
  });

  it("never picks up a later exchange's identity", () => {
    // Editing u1 while only the LATER exchange's identity is known must not
    // borrow it — that is the wrong email.
    const identities = new Map([["a2", "item-beta"]]);

    expect(
      resolveEditExchangeItemIdentity(messages, messageOrder, "u1", identities),
    ).toBeNull();
  });

  it("returns null when this session no longer knows the identity", () => {
    expect(
      resolveEditExchangeItemIdentity(messages, messageOrder, "u1", new Map()),
    ).toBeNull();
  });

  it("returns null when the edited message has no reply yet", () => {
    const pending: Record<string, Message> = {
      u1: message("u1", "user"),
      a1: message("a1", "assistant", "u1"),
      u2: message("u2", "user"),
    };

    expect(
      resolveEditExchangeItemIdentity(
        pending,
        ["u1", "a1", "u2"],
        "u2",
        new Map([["a1", "item-alpha"]]),
      ),
    ).toBeNull();
  });

  it("ignores a user message that shares the edited message as its predecessor", () => {
    const withUserSuccessor: Record<string, Message> = {
      u1: message("u1", "user"),
      u2: message("u2", "user", "u1"),
      a1: message("a1", "assistant", "u1"),
    };

    expect(
      resolveEditExchangeItemIdentity(
        withUserSuccessor,
        ["u1", "u2", "a1"],
        "u1",
        new Map([["a1", "item-alpha"]]),
      ),
    ).toBe("item-alpha");
  });
});
