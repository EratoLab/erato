import { describe, expect, it } from "vitest";

import {
  applyToolUseUpdate,
  insertProposedToolUse,
} from "./toolUsePartHelpers";

import type {
  ContentPart,
  MessageSubmitStreamingResponseToolCallProposed,
  MessageSubmitStreamingResponseToolCallUpdate,
  ToolUse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const proposed = (
  toolCallId: string,
  contentIndex: number,
): MessageSubmitStreamingResponseToolCallProposed =>
  ({
    tool_call_id: toolCallId,
    tool_name: "delegate_task",
    content_index: contentIndex,
    input: { task: toolCallId },
  }) as unknown as MessageSubmitStreamingResponseToolCallProposed;

const update = (
  toolCallId: string,
  contentIndex: number,
  output: unknown,
): MessageSubmitStreamingResponseToolCallUpdate =>
  ({
    tool_call_id: toolCallId,
    tool_name: "delegate_task",
    content_index: contentIndex,
    status: "success",
    output,
  }) as unknown as MessageSubmitStreamingResponseToolCallUpdate;

const ids = (content: ContentPart[]): (string | undefined)[] =>
  content.map((part) => (part as ToolUse).tool_call_id);

describe("insertProposedToolUse", () => {
  it("keeps a batch in call order when each call reserves its own index", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));
    content = insertProposedToolUse(content, proposed("call-b", 1));
    content = insertProposedToolUse(content, proposed("call-c", 2));

    expect(ids(content)).toEqual(["call-a", "call-b", "call-c"]);
  });

  it("reverses a batch that reuses one index, which is why indices differ", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));
    content = insertProposedToolUse(content, proposed("call-b", 0));

    expect(ids(content)).toEqual(["call-b", "call-a"]);
  });

  it("ignores a duplicate proposal for a call it already holds", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));
    const before = content;
    content = insertProposedToolUse(content, proposed("call-a", 1));

    expect(content).toBe(before);
    expect(ids(content)).toEqual(["call-a"]);
  });
});

describe("applyToolUseUpdate", () => {
  it("settles two in-flight calls by id, whichever finishes first", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));
    content = insertProposedToolUse(content, proposed("call-b", 1));

    content = applyToolUseUpdate(content, update("call-b", 1, { ok: "b" }));

    expect(ids(content)).toEqual(["call-a", "call-b"]);
    expect((content[0] as ToolUse).status).toBe("in_progress");
    expect((content[1] as ToolUse).status).toBe("success");

    content = applyToolUseUpdate(content, update("call-a", 0, { ok: "a" }));

    expect(ids(content)).toEqual(["call-a", "call-b"]);
    expect((content[0] as ToolUse).output).toEqual({ ok: "a" });
    expect((content[1] as ToolUse).output).toEqual({ ok: "b" });
  });

  it("does not move a settled call when its index says otherwise", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));
    content = insertProposedToolUse(content, proposed("call-b", 1));

    content = applyToolUseUpdate(content, update("call-a", 1, { ok: "a" }));

    expect(ids(content)).toEqual(["call-a", "call-b"]);
  });

  it("inserts at the reserved index when the update arrives with no proposal", () => {
    let content: ContentPart[] = [];
    content = insertProposedToolUse(content, proposed("call-a", 0));

    content = applyToolUseUpdate(content, update("call-b", 1, { ok: "b" }));

    expect(ids(content)).toEqual(["call-a", "call-b"]);
  });
});
