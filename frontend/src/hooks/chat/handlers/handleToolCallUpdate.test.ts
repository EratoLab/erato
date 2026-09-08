import { afterEach, describe, expect, it } from "vitest";

import { handleToolCallProposed } from "./handleToolCallProposed";
import { handleToolCallUpdate } from "./handleToolCallUpdate";
import { useMessagingStore } from "../store/messagingStore";

describe("MCP progress event consumer", () => {
  afterEach(() => useMessagingStore.getState().clearAllStreaming());

  it("delivers three updates to the matching call and stream before its result", () => {
    const store = useMessagingStore.getState();
    store.setActiveStreamKey("chat-a");
    for (const key of ["chat-a", "chat-b"]) {
      store.setStreaming(
        { isStreaming: true, currentMessageId: key, content: [] },
        key,
      );
      for (const [index, call] of ["call-1", "call-2"].entries()) {
        handleToolCallProposed(
          {
            message_type: "tool_call_proposed",
            message_id: key,
            content_index: index,
            tool_call_id: call,
            tool_name: "read_file",
            input: { path: call } as never,
          },
          key,
        );
      }
    }
    for (const progress of [1, 2, 3]) {
      handleToolCallUpdate(
        {
          message_type: "tool_call_update",
          message_id: "chat-b",
          content_index: 0,
          tool_call_id: "call-2",
          tool_name: "read_file",
          status: "in_progress",
          input: null,
          output: null,
          progress,
          ...(progress === 2
            ? {}
            : { total: 3, progress_message: `Step ${progress}` }),
        },
        "chat-b",
      );
      const content = useMessagingStore
        .getState()
        .getStreaming("chat-b").content;
      expect(content[1]).toMatchObject({
        tool_call_id: "call-2",
        status: "in_progress",
        progress,
        input: { path: "call-2" },
      });
      expect(content[0]).not.toHaveProperty("progress");
      expect(
        useMessagingStore.getState().getStreaming("chat-a").content[1],
      ).not.toHaveProperty("progress");
      if (progress === 2) {
        expect(content[1]).not.toHaveProperty("total");
        expect(content[1]).toHaveProperty("progress_message", null);
      }
    }
    handleToolCallUpdate(
      {
        message_type: "tool_call_update",
        message_id: "chat-b",
        content_index: 0,
        tool_call_id: "call-2",
        tool_name: "read_file",
        status: "success",
        input: null,
        output: "file contents" as never,
      },
      "chat-b",
    );
    for (const message_id of ["chat-b", "old-message"]) {
      handleToolCallUpdate(
        {
          message_type: "tool_call_update",
          message_id,
          content_index: 1,
          tool_call_id: "call-2",
          tool_name: "read_file",
          status: "in_progress",
          input: null,
          output: null,
          progress: 99,
        },
        "chat-b",
      );
    }
    expect(
      useMessagingStore.getState().getStreaming("chat-b").content[1],
    ).toMatchObject({ status: "success", output: "file contents" });
    expect(
      useMessagingStore.getState().getStreaming("chat-b").content[1],
    ).not.toHaveProperty("progress");
  });
});
