import { beforeEach, describe, expect, it } from "vitest";

import { handleMessageComplete } from "../../handlers/handleMessageComplete";
import { useMessagingStore } from "../messagingStore";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

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

  it.each(["accepted", "unresolved"] as const)(
    "renders the completed %s outcome before history refetch",
    (status) => {
      const outcome = { status, attempts_used: 2, max_attempts: 5 };
      useMessagingStore
        .getState()
        .setStreaming(
          { isStreaming: true, currentMessageId: persisted.id },
          "chat1",
        );
      handleMessageComplete(
        {
          message_type: "assistant_message_completed",
          message_id: persisted.id,
          message: {
            id: persisted.id,
            content: streamedContent,
            submission_outcome: outcome,
          },
        } as Parameters<typeof handleMessageComplete>[0],
        "chat1",
      );
      expect(
        useMessagingStore.getState().getRenderableMessages("chat1")[
          persisted.id
        ].submission_outcome,
      ).toEqual(outcome);
      useMessagingStore.getState().resetStreaming("chat1");
      expect(
        useMessagingStore.getState().getStreaming("chat1").submissionOutcome,
      ).toBeUndefined();
    },
  );

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

describe("messagingStore kept answers", () => {
  const text = (value: string) => [
    { content_type: "text" as const, text: value },
  ];
  const userMessage = {
    id: "u1",
    role: "user" as const,
    createdAt: "2026-02-18T12:00:00.000Z",
    status: "complete" as const,
    content: text("question"),
  };
  const keepAnswer = (id: string, content: ContentPart[]) => {
    const store = useMessagingStore.getState();
    store.setStreaming(
      {
        isStreaming: true,
        isFinalizing: false,
        currentMessageId: id,
        content,
        createdAt: "2026-02-18T12:00:01.000Z",
      },
      "chat1",
    );
    store.keepStreamedAnswer("chat1", { saved: false });
    store.resetStreaming("chat1");
  };

  beforeEach(() => {
    useMessagingStore.getState().clearAllStreaming();
    useMessagingStore.getState().clearAllApiMessages();
  });

  it("gives way to the saved copy even when it is shorter", () => {
    keepAnswer("a1", [
      ...text("Done, I added"),
      { content_type: "spoken" as const, text: "Done, I added the paragraph." },
    ]);
    useMessagingStore.getState().markAnswersSaved("chat1", ["a1"]);
    const saved = {
      id: "a1",
      role: "assistant" as const,
      createdAt: "2026-02-18T12:00:01.000Z",
      status: "complete" as const,
      content: text("Done, I added the paragraph."),
    };
    useMessagingStore.getState().setApiMessages([userMessage, saved], "chat1");

    expect(
      useMessagingStore.getState().getRenderableMessages("chat1").a1.content,
    ).toEqual(saved.content);
  });

  it("stands in only in its own place, never beside another version of the turn", () => {
    keepAnswer("a-old", text("the first version, read before the stop"));
    useMessagingStore.getState().setApiMessages(
      [
        userMessage,
        {
          id: "a-v2",
          role: "assistant",
          createdAt: "2026-02-18T12:00:02.000Z",
          status: "complete",
          content: text("the other version"),
        },
      ],
      "chat1",
    );

    expect(
      Object.keys(useMessagingStore.getState().getRenderableMessages("chat1")),
    ).toEqual(["u1", "a-v2"]);
  });
});
