import { describe, expect, it } from "vitest";

import {
  CONVERSATION_MARGIN_PX,
  restingTop,
  writtenAnswerStart,
} from "@/utils/chat/conversationFollow";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const SIZES = [
  { name: "desktop", clientHeight: 828 },
  { name: "phone", clientHeight: 772 },
  { name: "add-in pane", clientHeight: 648 },
];

const text = (value: string) =>
  ({ content_type: "text", text: value }) as ContentPart;
const spoken = { content_type: "spoken", text: "Said." } as ContentPart;
const toolUse = {
  content_type: "tool_use",
  tool_call_id: "call",
  tool_name: "search",
  status: "success",
} as unknown as ContentPart;
const approvalRequest = {
  content_type: "tool_approval_request",
  tool_call_id: "call",
  tool_name: "update_record",
} as unknown as ContentPart;

describe("writtenAnswerStart", () => {
  it("is the first text of the answer that ends the reply, after its spoken part and lookups", () => {
    expect(
      writtenAnswerStart([spoken, toolUse, toolUse, text("Brief"), text("…")]),
    ).toBe(3);
  });

  it("has no written answer while lookups run or a card waits", () => {
    expect(writtenAnswerStart([spoken, toolUse])).toBe(-1);
    expect(writtenAnswerStart([text("Updating."), approvalRequest])).toBe(-1);
  });

  it("starts at the closing answer after a decided card, not at the text before the card", () => {
    expect(
      writtenAnswerStart([
        text("Updating."),
        approvalRequest,
        toolUse,
        spoken,
        text("Done."),
      ]),
    ).toBe(4);
  });
});

describe.each(SIZES)("restingTop ($name)", ({ clientHeight }) => {
  const bottom = 5_000;

  it("follows the bottom while nothing else asks to be in view", () => {
    expect(
      restingTop({
        bottom,
        clientHeight,
        waitingCard: null,
        answerStart: null,
      }),
    ).toBe(bottom);
  });

  it("stops at the start of a long written answer instead of chasing its end", () => {
    const answerStart = 2_000;
    expect(
      restingTop({ bottom, clientHeight, waitingCard: null, answerStart }),
    ).toBe(answerStart - CONVERSATION_MARGIN_PX);
  });

  it("follows the bottom while the written answer still fits below its start", () => {
    expect(
      restingTop({
        bottom,
        clientHeight,
        waitingCard: null,
        answerStart: bottom + 200,
      }),
    ).toBe(bottom);
  });

  it("shows a waiting card whole when it fits, though the list goes on below it", () => {
    const card = { top: bottom + clientHeight - 640, height: 560 };
    if (card.height + 2 * CONVERSATION_MARGIN_PX > clientHeight) return;
    const top = restingTop({
      bottom,
      clientHeight,
      waitingCard: card,
      answerStart: null,
    });
    expect(top).toBeLessThanOrEqual(card.top);
    expect(top + clientHeight).toBeGreaterThanOrEqual(card.top + card.height);
  });

  it("shows the decision at the end of a card taller than the view", () => {
    const card = { top: 4_000, height: clientHeight + 300 };
    const top = restingTop({
      bottom,
      clientHeight,
      waitingCard: card,
      answerStart: 3_000,
    });
    expect(top + clientHeight).toBe(
      card.top + card.height + CONVERSATION_MARGIN_PX,
    );
  });
});
