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
    expect(isApprovalDecision("approve_context")).toBe(true);
  });
});

describe("buildContinueStreamBody", () => {
  it("names a single open item, so a late tap cannot answer a later card", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["call-a"],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [{ approval_id: "call-a", decision: "approve" }],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("names the question a task's item showed, so a late tap cannot answer its next one", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["task-a", "call-b"],
        items: [
          {
            approval_id: "task-a",
            child: { child_tool_call_id: "child-message:2:call_second" },
          },
          { approval_id: "call-b", child: null },
        ],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        {
          approval_id: "task-a",
          decision: "approve",
          child_tool_call_id: "child-message:2:call_second",
        },
        { approval_id: "call-b", decision: "approve" },
      ],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("keeps the legacy body only for a caller that knows no approval id", () => {
    expect(
      buildContinueStreamBody({ messageId: "message-1", decision: "approve" }),
    ).toEqual({
      message_id: "message-1",
      decision: "approve",
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
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
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
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
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("answers a single open item with its own decision, not the default", () => {
    // A one-row plan is still decided per row: the body carries the row's
    // answer rather than whatever the card's bulk default was.
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["plan:0:0"],
        itemDecisions: [{ approvalId: "plan:0:0", decision: "withdraw" }],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [{ approval_id: "plan:0:0", decision: "withdraw" }],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("sends each item's scope position with approve_context", () => {
    const position = { journal: "journal-1", seq: 41, events: true };
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve_context",
        approvalIds: ["task-a", "task-b", "task-c"],
        itemDecisions: [
          {
            approvalId: "task-a",
            decision: "approve_context",
            scopePosition: position,
          },
          {
            approvalId: "task-b",
            decision: "approve_context",
            scopePosition: position,
          },
          { approvalId: "task-c", decision: "reject" },
        ],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        {
          approval_id: "task-a",
          decision: "approve_context",
          scope_position: position,
        },
        {
          approval_id: "task-b",
          decision: "approve_context",
          scope_position: position,
        },
        { approval_id: "task-c", decision: "reject" },
      ],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("names a single approve_context item, whose position the legacy body cannot carry", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve_context",
        approvalIds: ["task-a"],
        itemDecisions: [{ approvalId: "task-a", decision: "approve_context" }],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [{ approval_id: "task-a", decision: "approve_context" }],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("falls back to the legacy body for a row written before items existed", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve_always",
      }),
    ).toEqual({
      message_id: "message-1",
      decision: "approve_always",
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });

  it("asks for the continued answer to be read back only when the turn was", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        approvalIds: ["a", "b"],
        readBack: true,
      }),
    ).toMatchObject({ conversational_audio_back: true });
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        readBack: true,
      }),
    ).toMatchObject({ conversational_audio_back: true });
    expect(
      buildContinueStreamBody({ messageId: "message-1", decision: "approve" }),
    ).not.toHaveProperty("conversational_audio_back");
  });

  it("names the approval of a change request and carries the user's words", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "request_change",
        itemDecisions: [
          {
            approvalId: "call-a",
            decision: "request_change",
            changeRequest: "nimm den 22.",
          },
        ],
        readBack: true,
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        {
          approval_id: "call-a",
          decision: "request_change",
          change_request: "nimm den 22.",
        },
      ],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
      conversational_audio_back: true,
    });
  });

  it("sends the words with a change request only", () => {
    const body = buildContinueStreamBody({
      messageId: "message-1",
      decision: "approve",
      itemDecisions: [
        { approvalId: "call-a", decision: "approve", changeRequest: "x" },
        {
          approvalId: "call-b",
          decision: "request_change",
          changeRequest: "ohne Anna",
        },
      ],
    });
    expect(body.decisions).toEqual([
      { approval_id: "call-a", decision: "approve" },
      {
        approval_id: "call-b",
        decision: "request_change",
        change_request: "ohne Anna",
      },
    ]);
  });

  it("names a single decision said by voice, with its receipt", () => {
    expect(
      buildContinueStreamBody({
        messageId: "message-1",
        decision: "approve",
        itemDecisions: [
          { approvalId: "call-a", decision: "approve", voiceReceipt: "r-1" },
        ],
      }),
    ).toEqual({
      message_id: "message-1",
      decisions: [
        { approval_id: "call-a", decision: "approve", voice_receipt: "r-1" },
      ],
      shows_child_items: true,
      shows_limit_and_builtin_child_items: true,
    });
  });
});
