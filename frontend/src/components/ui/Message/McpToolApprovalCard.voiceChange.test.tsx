import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useApprovalListening } from "@/hooks/audio/approvalListening";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { ChatContextProviders } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { testChatValue } from "@/test/chatContextValue";
import { FrontendRequestError } from "@/utils/errorReport";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { McpToolApprovalRequestPart } from "./McpToolApprovalCard";
import type { VoiceChange, VoiceDecision } from "@/hooks/audio/approvalChanges";
import type { ChatContextValue } from "@/providers/ChatProvider";

vi.mock("@/auth/tokenStore", () => ({ getIdToken: () => null }));
vi.mock("@/hooks/ui/useThemedIcon", () => ({ useThemedIcon: () => "icon-id" }));
vi.mock("@/hooks/chat/useChatArchived", () => ({
  useChatArchived: () => false,
}));

/** What the card handed the voice on its last render. */
const spoken: {
  items: readonly { approvalId: string; replaces: string | null }[];
  change?: (approvalId: string) => VoiceChange | undefined;
  decide?: (approvalId: string) => Omit<VoiceDecision, "approves"> | undefined;
  /** What the voice answers: whether the card's request names the phrase. */
  approves: boolean;
} = { items: [], approves: false };
vi.mock("@/hooks/audio/useSpokenApprovalCard", () => ({
  useSpokenApprovalCard: (props: typeof spoken) => {
    spoken.items = props.items;
    spoken.change = props.change;
    spoken.decide = props.decide;
    return { key: "spoken-key", approves: spoken.approves };
  },
}));

const request = {
  tool_call_id: "call-1",
  tool_name: "update_record",
  mcp_server_id: "dynamics",
  input: { recordId: "r-1", item: { closeprobability: 60 } },
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

const corrected = {
  ...request,
  tool_call_id: "call-2",
  input: { recordId: "r-1", item: { closeprobability: 75 } },
  approvals: [
    {
      approval_id: "call-2",
      tool_call_id: "call-2",
      tool_name: "update_record",
      input: { recordId: "r-1", item: { closeprobability: 75 } },
      replaces_approval_id: "call-1",
    },
  ],
} as unknown as McpToolApprovalRequestPart;

const renderCard = (
  part: McpToolApprovalRequestPart,
  continueToolApproval: ChatContextValue["continueToolApproval"],
  voiceDecisionsEnabled = false,
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
        <ChatContextProviders
          value={testChatValue({
            currentChatId: "chat-1",
            refetchMessages: async () => undefined,
            continueToolApproval,
          })}
        >
          <McpToolApprovalCard
            messageId="message-1"
            request={part}
            resolution={null}
          />
        </ChatContextProviders>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

const changeOf = (approvalId: string) => {
  const change = spoken.change?.(approvalId);
  if (!change) throw new Error(`no change for ${approvalId}`);
  return change;
};

const conflict = (code: string) =>
  new FrontendRequestError(
    "SSE request failed",
    { method: "POST", url: "/api/v1beta/me/messages/continuestream" },
    { status: 409, statusText: "Conflict", body: JSON.stringify({ code }) },
  );

afterEach(() => {
  spoken.items = [];
  spoken.change = undefined;
  spoken.decide = undefined;
  spoken.approves = false;
  useApprovalListening.setState({ listening: null });
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  useGenerationStatusStore.getState().reset();
});

describe("changing a card by voice", () => {
  it("sends a change request for the approval listened to, with the user's words", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(request, continueToolApproval);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await changeOf("call-1").send("nimm 75 Prozent");
    });
    expect(outcome).toBe("sent");
    expect(continueToolApproval).toHaveBeenCalledTimes(1);
    expect(continueToolApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "message-1",
        decision: "request_change",
        approvalIds: ["call-1"],
        itemDecisions: [
          {
            approvalId: "call-1",
            decision: "request_change",
            changeRequest: "nimm 75 Prozent",
          },
        ],
      }),
    );
  });

  it("never sends an approval or a rejection", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(request, continueToolApproval);
    const change = changeOf("call-1");
    // The only thing the voice gets is the words; whatever they say, the
    // decision is a change request.
    for (const words of ["ja", "approve", "nein, ablehnen", "Einmal erlauben"])
      await act(async () => {
        await change.send(words);
      });
    for (const [input] of continueToolApproval.mock.calls as [
      {
        decision: string;
        itemDecisions?: { decision: string }[];
      },
    ][]) {
      expect(input.decision).toBe("request_change");
      for (const item of input.itemDecisions ?? [])
        expect(item.decision).toBe("request_change");
    }
    expect(Object.keys(change).sort()).toEqual(["approvalId", "ready", "send"]);
  });

  it("a refusal because the card moved on is a conflict; anything else a failure", async () => {
    const moved = vi.fn().mockRejectedValue(conflict("already_continued"));
    renderCard(request, moved);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await changeOf("call-1").send("nimm den 22.");
    });
    expect(outcome).toBe("conflict");
  });

  it("a failed request leaves the card waiting, with its error", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    renderCard(request, failing);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await changeOf("call-1").send("nimm den 22.");
    });
    expect(outcome).toBe("failed");
    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
  });

  it("a card changed on another device (409 card_changed) is refetched without an error", async () => {
    const refetchMessages = vi.fn().mockResolvedValue(undefined);
    const continueToolApproval = vi
      .fn()
      .mockRejectedValue(conflict("card_changed"));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ChatContextProviders
          value={testChatValue({
            currentChatId: "chat-1",
            refetchMessages,
            continueToolApproval,
          })}
        >
          <McpToolApprovalCard
            messageId="message-1"
            request={request}
            resolution={null}
          />
        </ChatContextProviders>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("Allow once"));
    await waitFor(() => expect(refetchMessages).toHaveBeenCalled());
    expect(screen.queryByText(/SSE request failed/)).not.toBeInTheDocument();
  });

  it("a corrected card names its item when decided on screen, and tells the voice what it replaces", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(corrected, continueToolApproval);
    expect(spoken.items).toEqual([
      { approvalId: "call-2", replaces: "call-1" },
    ]);
    fireEvent.click(screen.getByText("Allow once"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          approvalIds: ["call-2"],
        }),
      ),
    );
  });

  it("a first card names its item too", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(request, continueToolApproval);
    expect(spoken.items).toEqual([{ approvalId: "call-1", replaces: null }]);
    fireEvent.click(screen.getByText("Allow once"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          approvalIds: ["call-1"],
        }),
      ),
    );
  });

  it("a task's item cannot be changed by voice; the turn's own waits for the others", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    const withTask = {
      ...request,
      approvals: [
        {
          approval_id: "call-1",
          tool_call_id: "call-1",
          tool_name: "update_record",
          input: request.input,
        },
        {
          approval_id: "task-1",
          tool_call_id: "task-1",
          tool_name: "delegate_task",
          input: { task: "x" },
          child: {
            child_chat_id: "11111111-1111-1111-1111-111111111111",
            child_message_id: "22222222-2222-2222-2222-222222222222",
            child_tool_call_id: "child-1",
            tool_name: "update_record",
            mcp_server_id: "dynamics",
            input: {},
            annotations: request.annotations,
            preset: "restrictive",
            requested_at: request.requested_at,
          },
        },
      ],
    } as unknown as McpToolApprovalRequestPart;
    renderCard(withTask, continueToolApproval);
    expect(spoken.change?.("task-1")).toBeUndefined();
    const own = changeOf("call-1");
    expect(own.ready()).toBe(false);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await own.send("nimm den 22.");
    });
    expect(outcome).toBe("conflict");
    expect(continueToolApproval).not.toHaveBeenCalled();
  });

  it.each(["tool_call_limit", "task_plan", "builtin_tool"])(
    "a %s card cannot be changed by voice",
    (kind) => {
      renderCard(
        { ...request, kind } as unknown as McpToolApprovalRequestPart,
        vi.fn(),
      );
      expect(spoken.change?.("call-1")).toBeUndefined();
    },
  );
});

describe("ERMAIN-1259: deciding a card by voice", () => {
  it("sends the decision for the approval listened to, with its receipt", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(request, continueToolApproval, true);
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

  it("a receipt the server refused shows no server text; the card waits", async () => {
    const refused = vi
      .fn()
      .mockRejectedValue(conflict("voice_receipt_refused"));
    renderCard(request, refused, true);
    let outcome: string | undefined;
    await act(async () => {
      outcome = await spoken.decide?.("call-1")?.send("approve", "receipt-1");
    });
    expect(outcome).toBe("failed");
    expect(screen.queryByText(/SSE request failed/)).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
  });

  it("is not offered while deciding by voice is off, nor for another approval", () => {
    renderCard(request, vi.fn());
    expect(spoken.decide?.("call-1")).toBeUndefined();
    renderCard(request, vi.fn(), true);
    expect(spoken.decide?.("call-9")).toBeUndefined();
  });

  it.each(["tool_call_limit", "task_plan", "builtin_tool"])(
    "a %s card is decided on screen",
    (kind) => {
      renderCard(
        { ...request, kind } as unknown as McpToolApprovalRequestPart,
        vi.fn(),
        true,
      );
      expect(spoken.decide?.("call-1")).toBeUndefined();
    },
  );

  it("a stop with several approvals is decided on screen", () => {
    const several = {
      ...request,
      approvals: ["call-1", "call-2"].map((id) => ({
        approval_id: id,
        tool_call_id: id,
        tool_name: "update_record",
        input: request.input,
      })),
    } as unknown as McpToolApprovalRequestPart;
    renderCard(several, vi.fn(), true);
    expect(spoken.decide?.("call-1")).toBeUndefined();
  });

  it("shows the phrase under the buttons only while a card that names it listens", () => {
    spoken.approves = true;
    renderCard(request, vi.fn(), true);
    expect(screen.queryByTestId("approval-voice-phrase")).toBeNull();
    act(() => useApprovalListening.setState({ listening: "spoken-key" }));
    expect(screen.getByTestId("approval-voice-phrase")).toHaveTextContent(
      "I confirm",
    );
  });

  it("shows the deployment's own phrase under the buttons", () => {
    window.APPROVAL_VOICE_PHRASES = {
      de: "Ich gebe es frei",
      en: "I give my approval",
    };
    try {
      spoken.approves = true;
      renderCard(request, vi.fn(), true);
      act(() => useApprovalListening.setState({ listening: "spoken-key" }));
      const hint = screen.getByTestId("approval-voice-phrase");
      expect(hint).toHaveTextContent("I give my approval");
      expect(hint).not.toHaveTextContent("I confirm");
    } finally {
      window.APPROVAL_VOICE_PHRASES = undefined;
    }
  });
});
