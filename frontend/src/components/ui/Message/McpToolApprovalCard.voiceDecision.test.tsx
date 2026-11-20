import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useApprovalListening } from "@/hooks/audio/approvalListening";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import data from "@/lib/toolCallGist/fixtures/spokenCards/calls.json";
import { ChatContext } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { McpToolApprovalRequestPart } from "./McpToolApprovalCard";
import type { VoiceDecision } from "@/hooks/audio/approvalChanges";
import type { ChatContextValue } from "@/providers/ChatProvider";

vi.mock("@/auth/tokenStore", () => ({ getIdToken: () => null }));
vi.mock("@/hooks/ui/useThemedIcon", () => ({ useThemedIcon: () => "icon-id" }));
vi.mock("@/hooks/chat/useChatArchived", () => ({
  useChatArchived: () => false,
}));

/** What the card handed the voice on its last render. */
const spoken: {
  keys: readonly string[];
  decide?: (approvalId: string) => Omit<VoiceDecision, "approves"> | undefined;
} = { keys: [] };
vi.mock("@/hooks/audio/useSpokenApprovalCard", () => ({
  useSpokenApprovalCard: (props: typeof spoken) => {
    spoken.keys = props.keys;
    spoken.decide = props.decide;
  },
}));

const { calls } = data as unknown as {
  calls: { id: string; input: unknown; display: { label?: unknown } }[];
};
const fixture = calls.find(
  (call) => call.id === "update-01-date-and-probability",
);
if (!fixture) throw new Error("the set has the update");

const request = {
  tool_call_id: "call-1",
  tool_name: "update_record",
  mcp_server_id: "dynamics",
  input: fixture.input,
  display: { title: "Update record", label: fixture.display.label },
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

const renderCard = (
  part: McpToolApprovalRequestPart,
  continueToolApproval: ChatContextValue["continueToolApproval"],
  voiceDecisionsEnabled = true,
) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaticFeatureConfigProvider
        config={{
          audioConversational: { enabled: true, voiceDecisionsEnabled },
        }}
      >
        <ChatContext.Provider
          value={
            {
              currentChatId: "chat-1",
              refetchMessages: async () => undefined,
              continueToolApproval,
            } as unknown as ChatContextValue
          }
        >
          <McpToolApprovalCard
            messageId="message-1"
            request={part}
            resolution={null}
          />
        </ChatContext.Provider>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

afterEach(() => {
  spoken.keys = [];
  spoken.decide = undefined;
  useApprovalListening.setState({ listening: null });
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  useGenerationStatusStore.getState().reset();
});

describe("ERMAIN-1259: deciding a card by voice", () => {
  it("sends the decision for the approval listened to, with its receipt", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(request, continueToolApproval);
    const decision = spoken.decide?.("call-1");
    expect(decision?.approvalId).toBe("call-1");
    let outcome: string | undefined;
    await act(async () => {
      outcome = await decision?.send("approve", "receipt-1");
    });
    expect(outcome).toBe("sent");
    expect(continueToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "approve",
        itemDecisions: [
          {
            approvalId: "call-1",
            decision: "approve",
            voiceReceipt: "receipt-1",
          },
        ],
      }),
    );
  });

  it("is not offered while deciding by voice is off, nor for another approval", () => {
    renderCard(request, vi.fn(), false);
    expect(spoken.decide?.("call-1")).toBeUndefined();
    renderCard(request, vi.fn());
    expect(spoken.decide?.("call-9")).toBeUndefined();
  });

  it.each(["tool_call_limit", "task_plan", "builtin_tool"])(
    "a %s card is decided on screen",
    (kind) => {
      renderCard(
        { ...request, kind } as unknown as McpToolApprovalRequestPart,
        vi.fn(),
      );
      expect(spoken.decide?.("call-1")).toBeUndefined();
    },
  );

  it("a stop with several approvals is decided on screen", () => {
    const several = {
      ...request,
      approvals: [
        {
          approval_id: "call-1",
          tool_call_id: "call-1",
          tool_name: "update_record",
          input: request.input,
        },
        {
          approval_id: "call-2",
          tool_call_id: "call-2",
          tool_name: "update_record",
          input: request.input,
        },
      ],
    } as unknown as McpToolApprovalRequestPart;
    renderCard(several, vi.fn());
    expect(spoken.decide?.("call-1")).toBeUndefined();
  });

  it("shows the phrase under the buttons only while the card listens", () => {
    renderCard(request, vi.fn());
    expect(screen.queryByTestId("approval-voice-phrase")).toBeNull();
    act(() =>
      useApprovalListening.setState({
        listening: `message-1:${spoken.keys[0]}`,
      }),
    );
    expect(screen.getByTestId("approval-voice-phrase")).toHaveTextContent(
      "I confirm",
    );
  });
});
