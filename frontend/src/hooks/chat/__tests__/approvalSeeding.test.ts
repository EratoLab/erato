import { describe, expect, it } from "vitest";

import { seedDecisionParts } from "../approvalSeeding";
import { applyToolUseUpdate } from "../handlers/toolUsePartHelpers";

import type { MessageSubmitStreamingResponseToolCallUpdate } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const item = {
  approval_id: "call-1",
  tool_call_id: "call-1",
  tool_name: "cancel_reminder",
  input: { reminder_id: "r-1" },
};

const kinds = (parts: ReturnType<typeof seedDecisionParts>) =>
  parts.map((part) => [
    part.content_type,
    "status" in part ? part.status : undefined,
  ]);

describe("seedDecisionParts", () => {
  it("seeds an approved built-in call's decision only: its row comes with the dispatch", () => {
    expect(
      kinds(
        seedDecisionParts(
          [{ item, decision: "approve" }],
          "builtin_tool",
          "2026-11-09T10:00:00Z",
        ),
      ),
    ).toEqual([["tool_approval", undefined]]);
  });

  it("seeds a denied built-in call as a failed call", () => {
    expect(
      kinds(
        seedDecisionParts(
          [{ item, decision: "reject" }],
          "builtin_tool",
          "2026-11-09T10:00:00Z",
        ),
      ),
    ).toEqual([
      ["tool_rejection", undefined],
      ["tool_use", "error"],
    ]);
  });

  it("hands an approved MCP call's result, with its view, to the call it seeded", () => {
    const view = { server_id: "apps", uri: "ui://mock/counter" };
    const seeded = seedDecisionParts(
      [{ item, decision: "approve" }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(kinds(seeded)).toEqual([
      ["tool_approval", undefined],
      ["tool_use", "in_progress"],
    ]);

    // The continuation's update for the call, after the decision it seeded.
    const settled = applyToolUseUpdate(seeded, {
      message_id: "message-1",
      content_index: 1,
      tool_call_id: item.tool_call_id,
      tool_name: item.tool_name,
      status: "success",
      output: "Counter started at 41.",
      result_details: { view },
    } as unknown as MessageSubmitStreamingResponseToolCallUpdate);

    expect(kinds(settled)).toEqual([
      ["tool_approval", undefined],
      ["tool_use", "success"],
    ]);
    expect(settled[1]).toMatchObject({
      tool_call_id: item.tool_call_id,
      input: item.input,
      result_details: { view },
    });
  });
});
