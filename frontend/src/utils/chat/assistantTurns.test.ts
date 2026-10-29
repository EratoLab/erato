import { describe, expect, it } from "vitest";

import { getAssistantTurns } from "./assistantTurns";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const result: ContentPart = {
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
  content: ContentPart[] = [{ content_type: "text", text: id }],
) => ({ id, role, content });

describe("getAssistantTurns", () => {
  it("continues the turn across a hidden result row and a standalone result", () => {
    const turns = getAssistantTurns(
      {
        prompt: message("prompt", "user"),
        dispatch: message("dispatch", "assistant"),
        folded: message("folded", "user", [result]),
        reply: message("reply", "assistant"),
        later: message("later", "user", [result]),
      },
      ["prompt", "dispatch", "folded", "reply", "later"],
      new Set(["folded"]),
    );

    expect([...turns.continuing]).toEqual(["reply", "later"]);
    expect([...turns.continued]).toEqual(["dispatch", "reply"]);
  });

  it("starts a new turn after something the user wrote", () => {
    const turns = getAssistantTurns(
      {
        first: message("first", "assistant"),
        typed: message("typed", "user"),
        second: message("second", "assistant"),
      },
      ["first", "typed", "second"],
      new Set(),
    );

    expect(turns.continuing.size).toBe(0);
  });

  it("starts a new turn below a model switch", () => {
    const turns = getAssistantTurns(
      {
        dispatch: message("dispatch", "assistant"),
        reply: message("reply", "assistant"),
      },
      ["dispatch", "reply"],
      new Set(),
      new Set(["reply"]),
    );

    expect(turns.continuing.size).toBe(0);
    expect(turns.continued.size).toBe(0);
  });
});
