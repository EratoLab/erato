import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  forgetDictation,
  noteDictatedTranscript,
  settleDictation,
} from "@/hooks/audio/dictatedTurns";
import { useComposeSessionStore } from "@/hooks/chat/store/composeSessionStore";
import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import { ChatContext } from "@/providers/ChatProvider";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { McpToolApprovalRequestPart } from "./McpToolApprovalCard";
import type { UserTurn } from "@/lib/toolCallGist/spokenDictation";
import type { ChatContextValue } from "@/providers/ChatProvider";

vi.mock("@/auth/tokenStore", () => ({ getIdToken: () => null }));
vi.mock("@/hooks/ui/useThemedIcon", () => ({ useThemedIcon: () => "icon-id" }));
vi.mock("@/hooks/chat/useChatArchived", () => ({
  useChatArchived: () => false,
}));

/** What the card handed the voice on its last render. */
const spoken: { userTurns?: readonly UserTurn[] } = {};
vi.mock("@/hooks/audio/useSpokenApprovalCard", () => ({
  useSpokenApprovalCard: (props: typeof spoken) => {
    spoken.userTurns = props.userTurns;
    return { key: "spoken-key", approves: false };
  },
}));

interface SetCall {
  id: string;
  tool_name: string;
  input: { item: { description: string } };
  display: Record<string, unknown>;
}
const call = (data as unknown as { calls: SetCall[] }).calls.find(
  (entry) => entry.id === "create-01-task-long-description",
) as SetCall;
const DESCRIPTION = call.input.item.description;
const SAID = `Leg eine Aufgabe an, Beschreibung: ${DESCRIPTION}`;

const request = {
  tool_call_id: "call-1",
  tool_name: call.tool_name,
  mcp_server_id: "dynamics",
  input: call.input,
  display: { ...call.display, description_truncated: false },
  annotations: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  preset: "restrictive",
  allow_always: true,
  requested_at: "2026-11-17T10:00:00Z",
  kind: "mcp_tool",
} as unknown as McpToolApprovalRequestPart;

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatContext.Provider
        value={
          {
            currentChatId: "chat-1",
            refetchMessages: async () => undefined,
            messages: {
              "user-1": {
                id: "user-1",
                role: "user",
                content: [{ content_type: "text", text: SAID }],
              },
              "message-1": { id: "message-1", role: "assistant", content: [] },
            },
            messageOrder: ["user-1", "message-1"],
          } as unknown as ChatContextValue
        }
      >
        <McpToolApprovalCard
          messageId="message-1"
          request={request}
          resolution={null}
        />
      </ChatContext.Provider>
    </QueryClientProvider>,
  );

/** The card's markup, with React's per-render ids numbered in order. */
const markupOf = (container: HTMLElement): string => {
  const ids = new Map<string, string>();
  return container.innerHTML.replace(/_r_[0-9a-z]+_/g, (id) => {
    if (!ids.has(id)) ids.set(id, `id-${ids.size}`);
    return ids.get(id) ?? id;
  });
};

afterEach(() => {
  forgetDictation();
  spoken.userTurns = undefined;
});

describe("a dictated text on the card", () => {
  it("the card on screen is the same whether the text was dictated or typed", () => {
    const typed = renderCard();
    const typedHtml = markupOf(typed.container);
    expect(spoken.userTurns).toEqual([]);
    typed.unmount();

    const session = useComposeSessionStore
      .getState()
      .resolveSessionId("chat-1");
    noteDictatedTranscript(session, SAID);
    settleDictation(session, SAID);
    const dictated = renderCard();
    // Only the voice hears of the dictation.
    expect(spoken.userTurns).toEqual([
      { text: SAID, passages: [SAID], whole: true },
    ]);
    expect(markupOf(dictated.container)).toBe(typedHtml);
    expect(typedHtml).toContain("Technisches Layout abstimmen");
  });
});
