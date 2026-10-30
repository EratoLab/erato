import { describe, expect, it } from "vitest";

import {
  approvalQueueOf,
  approvalStopState,
  itemAllowsAlways,
} from "./approvalItems";

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

  it("orders the server's microsecond timestamps below the millisecond", () => {
    const request = { requested_at: "2026-10-20T10:00:05.000100+00:00" };
    // `a` is listed first and asked within the same millisecond as `own`, so
    // only the microseconds put it after.
    const open = [
      childItem("a", "2026-10-20T10:00:05.000300+00:00"),
      ownItem("own"),
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

const waitingItem = (approvalId: string): ApprovalItemPart => {
  const item = childItem(approvalId, "2026-10-20T10:00:00Z");
  return {
    ...item,
    child: item.child && {
      ...item.child,
      kind: "client_tool",
      waiting_for: { host_context: "outlook_mailbox", attempt_id: "attempt" },
    },
  };
};

const stop = (approvals: ApprovalItemPart[]) => ({
  tool_call_id: approvals[0]?.tool_call_id ?? "call",
  tool_name: "delegate_task",
  input: {},
  approvals,
});

const approved = (approvalId: string) => ({
  content_type: "tool_approval",
  tool_call_id: approvalId,
  approval_id: approvalId,
});

describe("approvalStopState", () => {
  it("never asks for a decision on a waiting item", () => {
    const state = approvalStopState(
      stop([childItem("asks", "2026-10-20T10:00:00Z"), waitingItem("waits")]),
      [],
      {
        slots: { asks: "in_progress", waits: "in_progress" },
        isLastStop: true,
      },
    );
    expect(ids(state.open)).toEqual(["asks"]);
    expect(ids(state.waiting)).toEqual(["waits"]);
    expect(state.resolution).toBeNull();
  });

  it("keeps a stop open while a waiting item's slot is in progress, even once every decision is in", () => {
    const request = stop([
      childItem("asks", "2026-10-20T10:00:00Z"),
      waitingItem("waits"),
    ]);
    const state = approvalStopState(request, [approved("asks")], {
      slots: { waits: "in_progress" },
      isLastStop: true,
    });
    expect(state.open).toEqual([]);
    expect(ids(state.waiting)).toEqual(["waits"]);
    expect(state.resolution).toBeNull();
  });

  it("settles a waiting item with its slot", () => {
    const state = approvalStopState(stop([waitingItem("waits")]), [], {
      slots: { waits: "success" },
      isLastStop: true,
    });
    expect(state.waiting).toEqual([]);
    expect(state.resolution).toBe("approved");
  });

  it("settles a waiting item whose slot is missing", () => {
    expect(
      approvalStopState(stop([waitingItem("waits")]), [], {
        slots: {},
        isLastStop: true,
      }).waiting,
    ).toEqual([]);
  });

  it("ignores the waiting items of an earlier stop and resolves it on its decisions", () => {
    const request = stop([
      childItem("asks", "2026-10-20T10:00:00Z"),
      waitingItem("waits"),
    ]);
    const slots = { waits: "in_progress" };
    const decided = approvalStopState(request, [approved("asks")], {
      slots,
      isLastStop: false,
    });
    expect(decided.waiting).toEqual([]);
    expect(decided.resolution).toBe("approved");
    const denied = approvalStopState(
      request,
      [{ ...approved("asks"), content_type: "tool_rejection" }],
      { slots, isLastStop: false },
    );
    expect(denied.resolution).toBe("denied");
  });

  it("counts every waiting item of the last stop as open when the slots are unknown", () => {
    const state = approvalStopState(stop([waitingItem("waits")]), []);
    expect(ids(state.waiting)).toEqual(["waits"]);
    expect(state.resolution).toBeNull();
  });
});
