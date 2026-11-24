import { describe, expect, it, vi } from "vitest";

import {
  answerFences,
  carryOverMappingsFor,
  isLatestAssistantMessage,
  parseProposalApplyInput,
  proposalOnceByCallId,
  sameItem,
} from "../proposalApply";

import type { ApprovalToolInfo, ContentPart } from "@erato/frontend/library";

const text = (value: string): ContentPart => ({
  content_type: "text",
  text: value,
});
const context = { toolCallId: "call-1.apply", messageId: "m1", chatId: "c1" };

describe("proposal apply input", () => {
  it("reads the proposal, the action, the item and the confirmation", () => {
    expect(
      parseProposalApplyInput({
        proposal_call_id: "call-1",
        action: "outlook.reply",
        item_identity: "item-A",
        confirmation: { confirmed: true },
      }),
    ).toEqual({
      proposalCallId: "call-1",
      action: "outlook.reply",
      itemIdentity: "item-A",
      confirmation: { confirmed: true },
    });
    expect(
      parseProposalApplyInput({
        proposal_call_id: "call-1",
        action: "outlook.reply",
        item_identity: null,
      }),
    ).toMatchObject({ itemIdentity: null, confirmation: {} });
    expect(parseProposalApplyInput({ action: "outlook.reply" })).toBeNull();
  });
});

describe("the item check", () => {
  it("fails closed when either side is missing", () => {
    expect(sameItem("a", "a")).toBe(true);
    expect(sameItem("a", "b")).toBe(false);
    expect(sameItem(undefined, "a")).toBe(false);
    expect(sameItem("a", null)).toBe(false);
  });

  it("knows the latest answer", () => {
    const messages = {
      u1: { role: "user" },
      a1: { role: "assistant" },
      u2: { role: "user" },
      a2: { role: "assistant" },
    };
    const order = ["u1", "a1", "u2", "a2"];
    expect(isLatestAssistantMessage(messages, order, "a2")).toBe(true);
    expect(isLatestAssistantMessage(messages, order, "a1")).toBe(false);
  });
});

describe("answer fences", () => {
  it("reads each closed fence with its tag", () => {
    expect(
      answerFences([
        text(
          "Here:\n\n```erato-email\nHello\n\nBye\n```\n\n~~~\nplain\n~~~\n```erato-appointment\n{",
        ),
      ]),
    ).toEqual([
      { language: "erato-email", body: "Hello\n\nBye" },
      { language: "", body: "plain" },
    ]);
  });
});

describe("one run per call", () => {
  it("answers a call sent again with the first run's result", async () => {
    const run = vi.fn(() => Promise.resolve({ status: "applied" as const }));
    const execute = proposalOnceByCallId(run);
    const input = { proposal_call_id: "call-1", action: "outlook.reply" };
    await execute(input, context);
    await expect(execute(input, context)).resolves.toEqual({
      ok: true,
      result: { status: "applied" },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs again after the user decided on screen", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ status: "needs_decision" })
      .mockResolvedValueOnce({ status: "applied" });
    const execute = proposalOnceByCallId(run);
    const input = { proposal_call_id: "call-1", action: "word.x" };
    await execute(input, context);
    await expect(execute(input, context)).resolves.toMatchObject({
      result: { status: "applied" },
    });
  });

  it("refuses a call without its proposal", async () => {
    const execute = proposalOnceByCallId(() =>
      Promise.resolve({ status: "applied" }),
    );
    await expect(execute({}, context)).resolves.toEqual({
      ok: true,
      result: { status: "failed", reason: "invalid_input" },
    });
  });
});

describe("carry-over mappings from the server", () => {
  const tools = [
    {
      qualified_name: "outlook/open_reply",
      title: "Reply",
      approval: "user_decision",
      client_actions: ["outlook.reply"],
    },
    {
      qualified_name: "word/apply_document_plan",
      title: "Change",
      approval: "user_decision",
      client_actions: ["word.apply_document_plan"],
    },
    { qualified_name: "outlook/other", title: "x", approval: "user_decision" },
  ] as ApprovalToolInfo[];

  it("maps each tool of the host to the actions it carries out", () => {
    const mappings = carryOverMappingsFor(tools, "outlook");
    expect(mappings).toEqual([
      { serverKey: "outlook/open_reply", actions: ["outlook.reply"] },
    ]);
  });
});
