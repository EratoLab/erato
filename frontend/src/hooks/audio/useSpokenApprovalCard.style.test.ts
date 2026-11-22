import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import { spokenApprovalFor } from "@/lib/toolCallGist/spokenCard";

import { useSpeechPlayback } from "./speechPlayback";
import { useSpokenApprovalCard } from "./useSpokenApprovalCard";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { SpokenPiece } from "@/lib/toolCallGist/spokenCard";

const speakApprovalCard = vi.fn();
vi.mock("./approvalSpeech", () => ({
  approvalSpoken: () => false,
  speakApprovalCard: (card: unknown) => speakApprovalCard(card),
  offerApprovalCard: () => {},
  forgetApprovalCards: () => {},
}));
vi.mock("./spokenStyle", () => ({
  deploymentNumberWords: () => undefined,
  deploymentSpokenCardLanguages: () => undefined,
  useSpokenStyle: () => ({
    amount: "short",
    shortDetails: 1,
    wording: "natural",
  }),
  deploymentSentences: (language: string) =>
    language.startsWith("de")
      ? { changed: "{field} geht {from} {to}." }
      : undefined,
}));

const { calls } = data as unknown as {
  calls: {
    id: string;
    tool_name: string;
    input: unknown;
    display: { title: string; server_name?: string; label?: unknown };
  }[];
};
const call = calls.find(
  (entry) => entry.id === "update-06-many-fields",
) as (typeof calls)[number];
const MANY = spokenApprovalFor("mcp_tool", {
  ...call,
  display: { ...call.display, label: call.display.label as ToolCallLabel },
});

beforeEach(() => {
  speakApprovalCard.mockClear();
  useSpeechPlayback.setState({
    conversational: true,
    enabled: true,
    playing: false,
    paused: false,
    spokenTurn: "chat-1",
    quietTurn: undefined,
  });
});

describe("the reading style reaches the spoken card", () => {
  it("holds back after the first detail and words it from the variants", () => {
    renderHook(() =>
      useSpokenApprovalCard({
        chatId: "chat-1",
        messageId: "message-1",
        approvals: [MANY],
        keys: ["t:a"],
        index: 0,
        active: true,
        responding: false,
      }),
    );
    const pieces = (
      speakApprovalCard.mock.calls[0][0] as { pieces: SpokenPiece[] }
    ).pieces;
    const details = pieces.filter((piece) => piece.role === "detail");
    expect(details[0].held).toBeUndefined();
    expect(details.slice(1).every((piece) => piece.held === "field")).toBe(
      true,
    );
    expect(pieces.find((piece) => piece.role === "more")?.held).toBe("field");
    // The English test locale: the deployment's variant is German only, so
    // the built-in English one is said.
    expect(details[0].text).toMatch(
      /^Risk level changes from Low to Medium\.$/,
    );
  });
});
