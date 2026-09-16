import { beforeEach, describe, expect, it } from "vitest";

import { useMessagingStore } from "../messagingStore";

const persisted = {
  id: "assistant-1",
  role: "assistant" as const,
  createdAt: "2026-02-18T12:00:00.000Z",
  status: "complete" as const,
  content: [
    { content_type: "text" as const, text: "before" },
    {
      content_type: "tool_approval_request" as const,
      tool_call_id: "call_1",
      tool_name: "publish",
      mcp_server_id: "mock",
      input: {},
      annotations: {},
      preset: "restrictive",
      allow_always: false,
      requested_at: "2026-02-18T12:00:01.000Z",
    },
  ],
};

const streamedContent = [
  ...persisted.content,
  {
    content_type: "tool_approval" as const,
    tool_call_id: "call_1",
    approved_at: "2026-02-18T12:00:02.000Z",
  },
  { content_type: "text" as const, text: "after" },
];

describe("messagingStore getRenderableMessages", () => {
  beforeEach(() => {
    useMessagingStore.getState().clearAllStreaming();
    useMessagingStore.getState().clearAllApiMessages();
    useMessagingStore.getState().setApiMessages([persisted as never], "chat1");
  });

  it("renders the streaming buffer over a persisted message of the same id while it streams", () => {
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: true,
        isFinalizing: false,
        currentMessageId: persisted.id,
        content: streamedContent as never,
        createdAt: persisted.createdAt,
      },
      "chat1",
    );
    const rendered = useMessagingStore
      .getState()
      .getRenderableMessages("chat1")[persisted.id];
    expect(rendered.content).toHaveLength(4);
    expect(rendered.status).toBe("sending");
  });

  it("keeps the buffer while the completed turn is still finalizing, so the answer does not blink out before the refetch", () => {
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: false,
        isFinalizing: true,
        currentMessageId: persisted.id,
        content: streamedContent as never,
        createdAt: persisted.createdAt,
      },
      "chat1",
    );
    const rendered = useMessagingStore
      .getState()
      .getRenderableMessages("chat1")[persisted.id];
    expect(rendered.content).toHaveLength(4);
    expect(rendered.status).toBe("complete");
  });

  it("returns to the persisted copy once finalization is over", () => {
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: false,
        isFinalizing: false,
        currentMessageId: persisted.id,
        content: streamedContent as never,
        createdAt: persisted.createdAt,
      },
      "chat1",
    );
    const rendered = useMessagingStore
      .getState()
      .getRenderableMessages("chat1")[persisted.id];
    expect(rendered.content).toHaveLength(2);
  });
});
