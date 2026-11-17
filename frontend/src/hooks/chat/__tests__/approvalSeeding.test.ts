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

  it("seeds a change request as a call not run, with the reason and the words", () => {
    const parts = seedDecisionParts(
      [{ item, decision: "request_change", changeRequest: "nimm den 22." }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(kinds(parts)).toEqual([
      ["tool_rejection", undefined],
      ["tool_use", "error"],
    ]);
    expect(parts[0]).toMatchObject({
      reason: "change_requested",
      change_request: "nimm den 22.",
      never_allow: false,
    });
  });

  it("a plain denial carries no reason and no words", () => {
    const [part] = seedDecisionParts(
      [{ item, decision: "reject" }],
      "mcp_tool",
      "2026-11-09T10:00:00Z",
    );
    expect(part).toMatchObject({ reason: null });
    expect(part).not.toHaveProperty("change_request");
  });
});
