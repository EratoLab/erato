import { describe, expect, it } from "vitest";

import { isSameMessage, shallowEqual } from "./stableValues";

import type { ChatMessage } from "@/components/ui/MessageList/MessageList";

const message: ChatMessage = {
  id: "m1",
  role: "assistant",
  content: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  sender: "assistant",
  authorId: "assistant",
  loading: { state: "typing" },
};
const missing = undefined as unknown as ChatMessage;

describe("stableValues", () => {
  it("never matches a missing key with an undefined value", () => {
    expect(
      shallowEqual(
        { canEdit: true, dialogOwnerId: undefined },
        { canEdit: true, isSharedDialog: true },
      ),
    ).toBe(false);
  });

  it("matches a message whose loading object was rebuilt unchanged", () => {
    expect(
      isSameMessage(message, { ...message, loading: { state: "typing" } }),
    ).toBe(true);
    expect(
      isSameMessage(message, { ...message, loading: { state: "done" } }),
    ).toBe(false);
  });

  it("treats a message replaced by a missing entry as changed", () => {
    expect(isSameMessage(message, missing)).toBe(false);
    expect(isSameMessage(missing, message)).toBe(false);
  });
});
