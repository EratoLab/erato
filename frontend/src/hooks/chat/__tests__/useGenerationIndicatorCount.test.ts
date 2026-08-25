import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { useMessagingStore } from "@/hooks/chat/store/messagingStore";
import { useGenerationIndicatorCount } from "@/hooks/chat/useGenerationIndicatorCount";

const startedAt = new Date("2024-01-01T00:00:00.000Z").toISOString();
const running = { kind: "running", startedAt, localSeenAt: 0 } as const;

const count = () =>
  renderHook(() => useGenerationIndicatorCount()).result.current;

describe("useGenerationIndicatorCount", () => {
  beforeEach(() => {
    useGenerationStatusStore.setState({
      statusByChatId: {},
      currentChatId: null,
    });
    useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
    useMessagingStore.setState({ newlyCreatedChatId: null });
  });

  it("counts chats the user is not looking at", () => {
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-a": running,
        "chat-b": { kind: "finished", startedAt },
      },
    });

    expect(count()).toBe(2);
  });

  it("does not announce the chat in view while it generates", () => {
    // A local send seeds the open chat as running; badging it would point at
    // the conversation already filling the screen.
    useGenerationStatusStore.setState({
      statusByChatId: { "chat-a": running },
      currentChatId: "chat-a",
    });

    expect(count()).toBe(0);
  });

  it("does not strand a first turn's outcome on the badge", () => {
    // A first turn streams before its id is adopted, so the status store's
    // currentChatId is still null while the messaging store knows the id —
    // and its terminal outcome is recorded rather than tombstoned.
    useGenerationStatusStore.setState({
      statusByChatId: { "chat-new": { kind: "finished", startedAt } },
      currentChatId: null,
    });
    useMessagingStore.setState({ newlyCreatedChatId: "chat-new" });

    expect(count()).toBe(0);
  });

  it("still counts an approval parked in the chat in view", () => {
    // An open chat waiting on a decision is asking for one; only the
    // generating case is self-evident from the screen.
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-a": { kind: "action_required", startedAt, localSeenAt: 0 },
      },
      currentChatId: "chat-a",
    });

    expect(count()).toBe(1);
  });

  it("counts a chat once when both approval channels report it", () => {
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-a": { kind: "action_required", startedAt, localSeenAt: 0 },
      },
    });
    useConfirmationRegistryStore.setState({
      pendingIdsByChatId: { "chat-a": ["approval-1"] },
    });

    expect(count()).toBe(1);
  });

  it("ignores tombstoned outcomes", () => {
    useGenerationStatusStore.setState({
      statusByChatId: {
        "chat-a": { kind: "cleared", startedAt, consumed: "finished" },
      },
    });

    expect(count()).toBe(0);
  });
});
