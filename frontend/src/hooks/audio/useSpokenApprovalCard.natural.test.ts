import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import {
  sameSpokenKind,
  spokenApprovalFor,
  spokenApprovalPieces,
} from "@/lib/toolCallGist/spokenCard";

import { useSpeechPlayback } from "./speechPlayback";
import { useSpokenApprovalCard } from "./useSpokenApprovalCard";

import type { ToolCallLabel } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type {
  SpokenApproval,
  SpokenPiece,
} from "@/lib/toolCallGist/spokenCard";

// The real rewording module, with the backend answering every piece
// precisely: the natural style must then say exactly the precise card.
const fetchRewordApproval = vi.fn();
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchRewordApproval: (...args: unknown[]) => fetchRewordApproval(...args),
}));
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useOptionalAudioConversationalFeature: () => ({
    enabled: true,
    maxRecordingDurationSeconds: 60,
    approvalSpeechStyle: "natural",
    approvalSpeechUserChoice: false,
  }),
}));

const speakApprovalCard = vi.fn();
const started = new Set<string>();
vi.mock("./approvalSpeech", () => ({
  approvalSpoken: (key: string) => started.has(key),
  speakApprovalCard: (card: { key: string }) => {
    started.add(card.key);
    speakApprovalCard(card);
  },
  offerApprovalCard: (card: { key: string }) => started.add(card.key),
  forgetApprovalCards: () => {},
}));

const { calls } = data as unknown as {
  calls: {
    id: string;
    tool_name: string;
    input: unknown;
    display: { title: string; server_name?: string; label?: unknown };
  }[];
};
const approval = (id: string): SpokenApproval => {
  const call = calls.find((entry) => entry.id === id);
  if (!call) throw new Error(id);
  return spokenApprovalFor("mcp_tool", {
    ...call,
    display: { ...call.display, label: call.display.label as ToolCallLabel },
  });
};
const QUEUE = [
  approval("create-01-task-long-description"),
  approval("create-05-task-many-fields"),
  approval("create-06-task-unread-regarding"),
];

beforeEach(() => {
  speakApprovalCard.mockClear();
  started.clear();
  fetchRewordApproval.mockReset();
  fetchRewordApproval.mockImplementation(
    (request: { body: { pieces: { id: string; text: string }[] } }) =>
      Promise.resolve({
        pieces: request.body.pieces.map((piece) => ({
          id: piece.id,
          text: piece.text,
          natural: false,
        })),
      }),
  );
  useSpeechPlayback.setState({
    conversational: true,
    enabled: true,
    playing: false,
    spokenTurn: "chat-1",
    quietTurn: undefined,
  });
});

describe("a queue in the natural style", () => {
  it.each([0, 1, 2])(
    "says card %i with the precise pieces, count and ordinal included",
    async (index) => {
      useSpeechPlayback.setState({ playing: true });
      const first = {
        chatId: "chat-1",
        messageId: `message-${index}`,
        approvals: QUEUE,
        keys: ["t:a", "t:b", "t:c"],
        index,
        active: true,
        responding: false,
      };
      const { rerender } = renderHook((p) => useSpokenApprovalCard(p), {
        initialProps: first,
      });
      act(() => useSpeechPlayback.setState({ playing: false }));
      rerender({ ...first });
      await act(async () => {
        await Promise.resolve();
      });
      expect(speakApprovalCard).toHaveBeenCalledTimes(1);
      const said = (
        speakApprovalCard.mock.calls[0][0] as {
          pieces: SpokenPiece[];
        }
      ).pieces;
      const precise = spokenApprovalPieces(QUEUE[index], {
        language: "en",
        now: new Date(),
        position: {
          index,
          total: 3,
          sameAsPrevious:
            index > 0 && sameSpokenKind(QUEUE[index - 1], QUEUE[index]),
        },
      });
      expect(said.map((piece) => [piece.id, piece.text])).toEqual(
        precise.map((piece) => [piece.id, piece.text]),
      );
      // The request sent was for exactly the pieces said.
      const asked = (
        fetchRewordApproval.mock.calls.at(-1)?.[0] as {
          body: { pieces: { id: string }[] };
        }
      ).body.pieces.map((piece) => piece.id);
      expect(asked).toEqual(precise.map((piece) => piece.id));
    },
  );
});
