import { afterEach, describe, expect, it } from "vitest";

import { handleReasoningDelta } from "./handleReasoningDelta";
import { handleTextDelta } from "./handleTextDelta";
import { useMessagingStore } from "../store/messagingStore";

const resetMessagingStore = () => {
  useMessagingStore.getState().clearAllStreaming();
  useMessagingStore.getState().setActiveStreamKey("__test__");
};

describe("reasoning delta streaming handlers", () => {
  afterEach(() => {
    resetMessagingStore();
  });

  it("adds reasoning deltas as reasoning content parts", () => {
    resetMessagingStore();
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: true,
        currentMessageId: "message-1",
        content: [],
      },
      "__test__",
    );

    handleReasoningDelta(
      {
        message_type: "reasoning_delta",
        message_id: "message-1",
        content_index: 0,
        new_text: "Thinking",
      },
      "__test__",
    );
    handleReasoningDelta(
      {
        message_type: "reasoning_delta",
        message_id: "message-1",
        content_index: 0,
        new_text: " through",
      },
      "__test__",
    );

    expect(
      useMessagingStore.getState().getStreaming("__test__").content,
    ).toEqual([{ content_type: "reasoning", text: "Thinking through" }]);
  });

  it("preserves interleaved reasoning and text indexes", () => {
    resetMessagingStore();
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: true,
        currentMessageId: "message-1",
        content: [],
      },
      "__test__",
    );

    handleReasoningDelta(
      {
        message_type: "reasoning_delta",
        message_id: "message-1",
        content_index: 0,
        new_text: "Plan",
      },
      "__test__",
    );
    handleTextDelta(
      {
        message_type: "text_delta",
        message_id: "message-1",
        content_index: 1,
        new_text: "Answer",
      },
      "__test__",
    );

    expect(
      useMessagingStore.getState().getStreaming("__test__").content,
    ).toEqual([
      { content_type: "reasoning", text: "Plan" },
      { content_type: "text", text: "Answer" },
    ]);
  });

  it("inserts late reasoning content without replacing streamed text", () => {
    resetMessagingStore();
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: true,
        currentMessageId: "message-1",
        content: [],
      },
      "__test__",
    );

    handleTextDelta(
      {
        message_type: "text_delta",
        message_id: "message-1",
        content_index: 0,
        new_text: "Answer",
      },
      "__test__",
    );
    handleReasoningDelta(
      {
        message_type: "reasoning_delta",
        message_id: "message-1",
        content_index: 0,
        new_text: "Plan",
      },
      "__test__",
    );

    expect(
      useMessagingStore.getState().getStreaming("__test__").content,
    ).toEqual([
      { content_type: "reasoning", text: "Plan" },
      { content_type: "text", text: "Answer" },
    ]);
  });
});
