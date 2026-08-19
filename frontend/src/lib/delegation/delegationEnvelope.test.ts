import { describe, expect, it } from "vitest";

import { parseDelegationEnvelope } from "./delegationEnvelope";

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
      truncated: false,
    });
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
});
