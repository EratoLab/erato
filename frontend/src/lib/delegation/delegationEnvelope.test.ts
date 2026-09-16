import { describe, expect, it } from "vitest";

import {
  DELEGATE_TASK_TOOL_NAME,
  DELEGATION_TOOL_NAME,
  isDelegationToolName,
  parseDelegationEnvelope,
} from "./delegationEnvelope";

const RUNNING = {
  assistant_id: "asst-1",
  assistant_name: "Research",
  delegate_chat_id: "chat-1",
  localTrace: { steps: [{ sequence: 0, id: "search_web", status: "running" }] },
};

describe("parseDelegationEnvelope", () => {
  it("reads a progress frame, which carries no status of its own", () => {
    expect(parseDelegationEnvelope(RUNNING)).toEqual({
      status: undefined,
      assistantId: "asst-1",
      assistantName: "Research",
      delegateChatId: "chat-1",
      result: undefined,
      background: false,
      truncated: false,
    });
  });

  it("reads a detached dispatch: marker, identity, and no status", () => {
    expect(
      parseDelegationEnvelope({
        assistant_id: "asst-1",
        assistant_name: "Research",
        delegate_chat_id: "chat-1",
        background: true,
      }),
    ).toMatchObject({
      status: undefined,
      background: true,
      delegateChatId: "chat-1",
    });
  });

  it("lets a settled status outrank a stray background marker", () => {
    expect(
      parseDelegationEnvelope({
        ...RUNNING,
        status: "completed",
        background: true,
      }),
    ).toMatchObject({ status: "completed", background: false });
  });

  it("rejects a background marker with no run to open", () => {
    expect(parseDelegationEnvelope({ background: true })).toBeUndefined();
  });

  it("reads a settled envelope with its result", () => {
    expect(
      parseDelegationEnvelope({
        ...RUNNING,
        status: "completed",
        result: "42",
        truncated: true,
      }),
    ).toMatchObject({
      status: "completed",
      result: "42",
      truncated: true,
    });
  });

  it("accepts an outcome that never got a chat id", () => {
    expect(parseDelegationEnvelope({ status: "timeout" })).toMatchObject({
      status: "timeout",
      delegateChatId: undefined,
    });
  });

  it("rejects a refusal, which dispatched nothing", () => {
    expect(
      parseDelegationEnvelope({
        status: "error",
        error: "delegation disabled",
      }),
    ).toBeUndefined();
  });

  it("rejects anything that is not a dispatched run", () => {
    expect(parseDelegationEnvelope(undefined)).toBeUndefined();
    expect(parseDelegationEnvelope(null)).toBeUndefined();
    expect(parseDelegationEnvelope("completed")).toBeUndefined();
    expect(parseDelegationEnvelope([RUNNING])).toBeUndefined();
    expect(parseDelegationEnvelope({})).toBeUndefined();
    expect(
      parseDelegationEnvelope({ assistant_name: "Research" }),
    ).toBeUndefined();
    expect(
      parseDelegationEnvelope({ localTrace: RUNNING.localTrace }),
    ).toBeUndefined();
  });

  it("drops identifiers that are not usable strings", () => {
    expect(
      parseDelegationEnvelope({
        status: "completed",
        assistant_id: 7,
        assistant_name: "   ",
        delegate_chat_id: null,
        result: 42,
      }),
    ).toEqual({
      status: "completed",
      assistantId: undefined,
      assistantName: undefined,
      delegateChatId: undefined,
      result: undefined,
      background: false,
      truncated: false,
    });
  });

  it("bounds the assistant name rendered in the title", () => {
    const envelope = parseDelegationEnvelope({
      status: "completed",
      assistant_name: "n".repeat(500),
    });
    expect(envelope?.assistantName).toHaveLength(128);
  });

  it("parses every status the backend may emit, plus legacy timeout", () => {
    for (const status of [
      "queued",
      "working",
      "input_required",
      "completed",
      "failed",
      "cancelled",
      "dispatched",
      "timeout",
    ]) {
      expect(parseDelegationEnvelope({ ...RUNNING, status })).toMatchObject({
        status,
      });
    }
  });

  it("admits a queued slot, which has no run to point at yet", () => {
    expect(parseDelegationEnvelope({ status: "queued" })).toMatchObject({
      status: "queued",
      delegateChatId: undefined,
      background: false,
    });
  });

  it("admits a parked child that has not answered", () => {
    expect(parseDelegationEnvelope({ status: "input_required" })).toMatchObject(
      { status: "input_required" },
    );
  });

  it("still rejects a status it does not know", () => {
    expect(parseDelegationEnvelope({ status: "elaborating" })).toBeUndefined();
  });

  it("reads the reason and the parent tool call", () => {
    expect(
      parseDelegationEnvelope({
        ...RUNNING,
        status: "cancelled",
        reason: "timeout",
        parent_tool_call_id: "call-9",
      }),
    ).toMatchObject({
      status: "cancelled",
      reason: "timeout",
      parentToolCallId: "call-9",
    });
  });

  it("falls back to child_run_id when the legacy key is absent", () => {
    expect(
      parseDelegationEnvelope({
        status: "completed",
        child_run_id: "chat-7",
      }),
    ).toMatchObject({ delegateChatId: "chat-7" });
  });

  it("prefers delegate_chat_id when a writer sends both", () => {
    expect(
      parseDelegationEnvelope({
        status: "completed",
        delegate_chat_id: "chat-1",
        child_run_id: "chat-1",
      }),
    ).toMatchObject({ delegateChatId: "chat-1" });
  });

  it("reads a task envelope that carries no assistant at all", () => {
    expect(
      parseDelegationEnvelope({
        status: "completed",
        child_run_id: "chat-3",
        result: "done",
      }),
    ).toMatchObject({
      assistantId: undefined,
      assistantName: undefined,
      delegateChatId: "chat-3",
      result: "done",
    });
  });
});

describe("isDelegationToolName", () => {
  it("recognises both delegation routes", () => {
    expect(isDelegationToolName(DELEGATION_TOOL_NAME)).toBe(true);
    expect(isDelegationToolName(DELEGATE_TASK_TOOL_NAME)).toBe(true);
  });

  it("recognises nothing else", () => {
    expect(isDelegationToolName("search_web")).toBe(false);
    expect(isDelegationToolName(undefined)).toBe(false);
    // The model sees the bare name; `erato/` is allowlist selection syntax.
    expect(isDelegationToolName("erato/delegate_task")).toBe(false);
  });
});
