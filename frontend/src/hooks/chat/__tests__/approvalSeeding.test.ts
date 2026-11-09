import { describe, expect, it } from "vitest";

import { seedDecisionParts } from "../approvalSeeding";

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
});
