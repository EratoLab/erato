import { describe, expect, it } from "vitest";

import { approvalQueueOf, itemAllowsAlways } from "./approvalItems";

import type { ApprovalItemPart } from "./approvalItems";

const ownItem = (approvalId: string): ApprovalItemPart => ({
  approval_id: approvalId,
  tool_call_id: approvalId,
  tool_name: "publish",
  input: {},
  child: null,
});

const childItem = (
  approvalId: string,
  requestedAt: string,
  allowAlways?: boolean,
): ApprovalItemPart => ({
  approval_id: approvalId,
  tool_call_id: approvalId,
  tool_name: "delegate_task",
  input: { task: approvalId },
  child: {
    child_chat_id: `chat-${approvalId}`,
    child_message_id: `message-${approvalId}`,
    child_tool_call_id: `call-${approvalId}`,
    tool_name: "publish",
    mcp_server_id: "server",
    input: {},
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
      readOnlyHint: false,
    },
    preset: "restrictive",
    requested_at: requestedAt,
    ...(allowAlways === undefined ? {} : { allow_always: allowAlways }),
  },
});

const ids = (items: ApprovalItemPart[]) =>
  items.map((item) => item.approval_id);

describe("approvalQueueOf", () => {
  it("orders a child by its own request and the turn's call by the part's", () => {
    const request = { requested_at: "2026-10-20T10:00:05Z" };
    const open = [
      ownItem("own"),
      childItem("late", "2026-10-20T10:00:09Z"),
      childItem("early", "2026-10-20T10:00:01Z"),
    ];

    expect(ids(approvalQueueOf(request, open))).toEqual([
      "early",
      "own",
      "late",
    ]);
  });

  it("keeps row order for approvals asked at the same time", () => {
    const request = { requested_at: "2026-10-20T10:00:05Z" };
    const open = [
      ownItem("own"),
      childItem("a", "2026-10-20T10:00:05Z"),
      childItem("b", "2026-10-20T10:00:05Z"),
    ];

    expect(ids(approvalQueueOf(request, open))).toEqual(["own", "a", "b"]);
  });

  it("reads the server's microsecond timestamps", () => {
    const request = { requested_at: "2026-10-20T10:00:05.000100+00:00" };
    const open = [
      ownItem("own"),
      childItem("a", "2026-10-20T10:00:05.000300+00:00"),
      childItem("b", "2026-10-20T10:00:04.999999+00:00"),
    ];

    expect(ids(approvalQueueOf(request, open))).toEqual(["b", "own", "a"]);
  });

  it("puts an approval with an unreadable time after the rest", () => {
    const request = { requested_at: "2026-10-20T10:00:05Z" };
    const open = [childItem("unknown", "not a time"), ownItem("own")];

    expect(ids(approvalQueueOf(request, open))).toEqual(["own", "unknown"]);
  });
});

describe("itemAllowsAlways", () => {
  it("reads a child's own policy before the part's", () => {
    const request = { allow_always: true };

    expect(
      itemAllowsAlways(childItem("a", "2026-10-20T10:00:05Z", false), request),
    ).toBe(false);
    expect(itemAllowsAlways(ownItem("own"), request)).toBe(true);
  });

  it("falls back to the part for a child recorded before it carried one", () => {
    expect(
      itemAllowsAlways(childItem("a", "2026-10-20T10:00:05Z"), {
        allow_always: false,
      }),
    ).toBe(false);
  });
});
