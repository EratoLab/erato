import { afterEach, describe, expect, it } from "vitest";

import { handleReasoningDelta } from "./handleReasoningDelta";
import { handleTextDelta } from "./handleTextDelta";
import { handleToolCallProposed } from "./handleToolCallProposed";
import { handleToolCallUpdate } from "./handleToolCallUpdate";
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

  it("interleaves tool calls inline without phantom reasoning blocks", () => {
    // Regression: previously when reasoning resumed at content_index=3 after
    // two tool calls (which the frontend kept in a side-dict, leaving content[]
    // shorter than the expected index), appendTextLikeDelta would push three
    // separate reasoning parts before settling — producing two single-delta
    // phantom blocks. With tool calls now occupying their content_index slots
    // in content[], the gap is filled and the phantom case never arises.
    resetMessagingStore();
    useMessagingStore.getState().setStreaming(
      {
        isStreaming: true,
        currentMessageId: "message-1",
        content: [],
      },
      "__test__",
    );

    // Reasoning block at index 0
    for (const chunk of ["Thinking", " carefully"]) {
      handleReasoningDelta(
        {
          message_type: "reasoning_delta",
          message_id: "message-1",
          content_index: 0,
          new_text: chunk,
        },
        "__test__",
      );
    }

    // Two tool calls at indices 1 and 2
    // Note: the generated Value type is `void` so test JSON payloads need a
    // cast to satisfy the typechecker.
    handleToolCallProposed(
      {
        message_type: "tool_call_proposed",
        message_id: "message-1",
        content_index: 1,
        tool_call_id: "call-a",
        tool_name: "search",
        input: { query: "first" } as unknown as never,
      },
      "__test__",
    );
    handleToolCallUpdate(
      {
        message_type: "tool_call_update",
        message_id: "message-1",
        content_index: 1,
        tool_call_id: "call-a",
        tool_name: "search",
        status: "success",
        output: { results: ["one"] } as unknown as never,
      },
      "__test__",
    );
    handleToolCallProposed(
      {
        message_type: "tool_call_proposed",
        message_id: "message-1",
        content_index: 2,
        tool_call_id: "call-b",
        tool_name: "search",
        input: { query: "second" } as unknown as never,
      },
      "__test__",
    );
    handleToolCallUpdate(
      {
        message_type: "tool_call_update",
        message_id: "message-1",
        content_index: 2,
        tool_call_id: "call-b",
        tool_name: "search",
        status: "success",
        output: { results: ["two"] } as unknown as never,
      },
      "__test__",
    );

    // Reasoning resumes at content_index=3 with multiple deltas — these
    // must all collapse into ONE reasoning part, not several.
    for (const chunk of ["Now", " I", " know"]) {
      handleReasoningDelta(
        {
          message_type: "reasoning_delta",
          message_id: "message-1",
          content_index: 3,
          new_text: chunk,
        },
        "__test__",
      );
    }

    // Final text at index 4
    handleTextDelta(
      {
        message_type: "text_delta",
        message_id: "message-1",
        content_index: 4,
        new_text: "Answer",
      },
      "__test__",
    );

    const content = useMessagingStore
      .getState()
      .getStreaming("__test__").content;

    expect(content).toHaveLength(5);
    expect(content[0]).toEqual({
      content_type: "reasoning",
      text: "Thinking carefully",
    });
    expect(content[1]).toMatchObject({
      content_type: "tool_use",
      tool_call_id: "call-a",
      status: "success",
    });
    expect(content[2]).toMatchObject({
      content_type: "tool_use",
      tool_call_id: "call-b",
      status: "success",
    });
    expect(content[3]).toEqual({
      content_type: "reasoning",
      text: "Now I know",
    });
    expect(content[4]).toEqual({ content_type: "text", text: "Answer" });

    // Sanity: only ONE reasoning part per logical block — no phantoms.
    const reasoningParts = content.filter(
      (part) => part.content_type === "reasoning",
    );
    expect(reasoningParts).toHaveLength(2);
    for (const part of reasoningParts) {
      expect(part.text.length).toBeGreaterThan(1);
    }
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
