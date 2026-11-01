import { describe, expect, it } from "vitest";

import { getTaskResultFolds, hasLaterTaskResult } from "./taskResultFolds";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const part: ContentPart = {
  content_type: "task_result",
  child_chat_id: "child-1",
  parent_tool_call_id: "call-1",
  status: "completed",
  summary: "answer",
  truncated: false,
  sequence: 0,
};

const message = (
  id: string,
  role: Message["role"],
  content: ContentPart[] = [],
  previous_message_id?: string,
) => ({ id, role, content, previous_message_id });

describe("getTaskResultFolds", () => {
  it("pairs a result with the assistant reply right below it", () => {
    const folds = getTaskResultFolds(
      {
        result: message("result", "user", [part]),
        reply: message("reply", "assistant", [], "result"),
      },
      ["result", "reply"],
    );

    expect([...folds.foldedRowIds]).toEqual(["result"]);
    expect(folds.byReplyId.reply).toEqual({ rowId: "result", part });
  });

  it("leaves a result alone when what follows is not its reply", () => {
    const messages = {
      result: message("result", "user", [part]),
      other: message("other", "assistant", [], "elsewhere"),
      typed: message("typed", "user", [{ content_type: "text", text: "hi" }]),
    };

    expect(
      getTaskResultFolds(messages, ["result", "other"]).foldedRowIds.size,
    ).toBe(0);
    expect(
      getTaskResultFolds(messages, ["result", "typed"]).foldedRowIds.size,
    ).toBe(0);
    expect(getTaskResultFolds(messages, ["result"]).foldedRowIds.size).toBe(0);
  });
});

describe("hasLaterTaskResult", () => {
  const delivery = (
    sequence: number,
    childChatId = "child-1",
  ): ContentPart => ({
    ...part,
    child_chat_id: childChatId,
    sequence,
  });

  it("finds a later delivery of the same task", () => {
    const messages = {
      first: message("first", "user", [delivery(0)]),
      second: message("second", "user", [delivery(1)]),
    };

    expect(hasLaterTaskResult(messages, "child-1", 0)).toBe(true);
    expect(hasLaterTaskResult(messages, "child-1", 1)).toBe(false);
  });

  it("ignores other tasks and rows that are not delivered results", () => {
    const messages = {
      first: message("first", "user", [delivery(0)]),
      other: message("other", "user", [delivery(3, "child-2")]),
      reply: message("reply", "assistant", [delivery(4)]),
      gone: undefined,
    };

    expect(hasLaterTaskResult(messages, "child-1", 0)).toBe(false);
  });
});
