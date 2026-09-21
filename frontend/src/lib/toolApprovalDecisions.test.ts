import { describe, expect, it } from "vitest";

import {
  buildContinueStreamBody,
  isApprovalDecision,
} from "./toolApprovalDecisions";

describe("isApprovalDecision", () => {
  it("counts a withdrawal as a denial", () => {
    // Spelled as "everything but reject", a withdrawal would let the gated call
    // run — it is a denial that carries a reason.
    expect(isApprovalDecision("withdraw")).toBe(false);
    expect(isApprovalDecision("reject")).toBe(false);
    expect(isApprovalDecision("reject_always")).toBe(false);
    expect(isApprovalDecision("approve")).toBe(true);
    expect(isApprovalDecision("approve_always")).toBe(true);
  });
});

describe("buildContinueStreamBody", () => {
  it("keeps the legacy body while one approval is open", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["call-a"],
      }),
    ).toEqual({ message_id: "message-1", decision: "approve" });
  });

  it("covers every open item once a stop carries more than one", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "reject",
        approvalIds: ["call-a", "call-b"],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        { approval_id: "call-a", decision: "reject" },
        { approval_id: "call-b", decision: "reject" },
      ],
    });
  });

  it("sends a per-item answer per item", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["plan:0:0", "plan:0:1"],
        itemDecisions: [
          { approvalId: "plan:0:0", decision: "approve" },
          { approvalId: "plan:0:1", decision: "reject" },
        ],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        { approval_id: "plan:0:0", decision: "approve" },
        { approval_id: "plan:0:1", decision: "reject" },
      ],
    });
  });

  it("answers a single open item with its own decision, not the default", () => {
    // A one-row plan is still decided per row: the legacy body carries the
    // row's answer rather than whatever the card's bulk default was.
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["plan:0:0"],
        itemDecisions: [{ approvalId: "plan:0:0", decision: "withdraw" }],
      }),
    ).toEqual({ message_id: "message-1", decision: "withdraw" });
  });

  it("falls back to the legacy body for a row written before items existed", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve_always",
      }),
    ).toEqual({ message_id: "message-1", decision: "approve_always" });
  });
});
