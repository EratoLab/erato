import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { componentRegistry } from "@/config/componentRegistry";
import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { ChatContextProviders } from "@/providers/ChatProvider";
import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";
import { testChatValue } from "@/test/chatContextValue";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { McpToolApprovalRequestPart } from "./McpToolApprovalCard";
import type { ApprovalItemCardProps } from "@/config/componentRegistry";
import type { VoiceDecision } from "@/hooks/audio/approvalChanges";
import type { SpokenApproval } from "@/lib/toolCallGist/spokenCard";
import type { ChatContextValue } from "@/providers/ChatProvider";

vi.mock("@/auth/tokenStore", () => ({ getIdToken: () => null }));
vi.mock("@/hooks/ui/useThemedIcon", () => ({ useThemedIcon: () => "icon-id" }));
vi.mock("@/hooks/chat/useChatArchived", () => ({
  useChatArchived: () => false,
}));

/** What the card handed the voice on its last render. */
const spoken: {
  approvals: readonly SpokenApproval[];
  decide?: (approvalId: string) => Omit<VoiceDecision, "approves"> | undefined;
} = { approvals: [] };
vi.mock("@/hooks/audio/useSpokenApprovalCard", () => ({
  useSpokenApprovalCard: (props: typeof spoken) => {
    spoken.approvals = props.approvals;
    spoken.decide = props.decide;
    return { key: "spoken-key", approves: false };
  },
}));

const APPLY_ID = "call-plan.apply";

const display = {
  title: "Change “Vertrag.docx”",
  description: "Updates 2 of 9 sections: § 3, § 5",
  description_truncated: false,
  label: { action: "update", object_kind: "document", source: "own_mapping" },
};

const chainedRequest = (
  chained: { decide_on_screen: boolean; reason?: string } = {
    decide_on_screen: false,
  },
  allowAlways = true,
) =>
  ({
    tool_call_id: APPLY_ID,
    tool_name: "apply_document_plan",
    mcp_server_id: "word",
    input: { submission_call_id: "call-plan", draft_id: "d-1" },
    annotations: {
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
    preset: "",
    allow_always: allowAlways,
    requested_at: "2026-11-23T10:00:00Z",
    kind: "client_tool",
    display,
    approvals: [
      {
        approval_id: APPLY_ID,
        tool_call_id: APPLY_ID,
        tool_name: "apply_document_plan",
        input: { submission_call_id: "call-plan", draft_id: "d-1" },
        display,
        child: null,
        chained: { submission_call_id: "call-plan", ...chained },
      },
    ],
  }) as unknown as McpToolApprovalRequestPart;

const otherClientRequest = {
  ...chainedRequest(),
  tool_call_id: "call-search",
  tool_name: "search_sidecar_index",
  mcp_server_id: "desktop",
  input: { query: "quarterly report" },
  display: undefined,
  approvals: undefined,
} as unknown as McpToolApprovalRequestPart;

const renderCard = (
  request: McpToolApprovalRequestPart,
  continueToolApproval: ChatContextValue["continueToolApproval"] = vi
    .fn()
    .mockResolvedValue(undefined),
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
            request={request}
            resolution={null}
          />
        </ChatContextProviders>
      </StaticFeatureConfigProvider>
    </QueryClientProvider>,
  );

/** What a host's card does with its props, set per test. */
let hostCard: (props: ApprovalItemCardProps) => React.ReactNode = (props) =>
  props.renderDefault();

function HostCardStub(props: ApprovalItemCardProps) {
  return <>{hostCard(props)}</>;
}

const registerApplyExecutor = () =>
  registerClientToolExecutor("apply_document_plan", () =>
    Promise.resolve({ ok: true as const, result: {} }),
  );

beforeEach(() => {
  componentRegistry.ApprovalItemCard = HostCardStub;
});

afterEach(() => {
  componentRegistry.ApprovalItemCard = null;
  hostCard = (props) => props.renderDefault();
  resetClientToolRegistryForTests();
  spoken.approvals = [];
  spoken.decide = undefined;
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  useGenerationStatusStore.getState().reset();
});

describe("a host's own card in the decision place", () => {
  it("draws the host card for its tool and the generic card for any other", () => {
    registerApplyExecutor();
    hostCard = (props) =>
      `${props.serverId}/${props.item.tool_name}` ===
      "word/apply_document_plan" ? (
        <div data-testid="host-card">
          {props.item.display?.title} · {props.messageId} · {props.chatId}
        </div>
      ) : (
        props.renderDefault()
      );

    const view = renderCard(chainedRequest());
    expect(screen.getByTestId("host-card")).toHaveTextContent(
      "Change “Vertrag.docx” · message-1 · chat-1",
    );
    expect(screen.queryByText("Allow once")).not.toBeInTheDocument();
    view.unmount();

    renderCard(otherClientRequest);
    expect(screen.queryByTestId("host-card")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Allow this tool to run on your device?").length,
    ).toBeGreaterThan(0);
  });

  it("sends the host card's choices as the approval's confirmation", async () => {
    registerApplyExecutor();
    hostCard = (props) => (
      <button
        type="button"
        onClick={() =>
          props.onDecide("approve", {
            clientConfirmation: { replace_whole_document: true },
          })
        }
      >
        Apply
      </button>
    );
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(chainedRequest(), continueToolApproval);

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          itemDecisions: [
            {
              approvalId: APPLY_ID,
              decision: "approve",
              clientConfirmation: { replace_whole_document: true },
            },
          ],
        }),
      ),
    );
  });

  it("sends a change asked for on the host card with the user's words", async () => {
    registerApplyExecutor();
    hostCard = (props) => (
      <button
        type="button"
        onClick={() =>
          props.onDecide("request_change", { changeRequest: "Only § 3" })
        }
      >
        Change
      </button>
    );
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(chainedRequest(), continueToolApproval);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "request_change",
          itemDecisions: [
            {
              approvalId: APPLY_ID,
              decision: "request_change",
              changeRequest: "Only § 3",
            },
          ],
        }),
      ),
    );
  });

  it("keeps a confirmation off a call the server did not chain", async () => {
    registerClientToolExecutor("search_sidecar_index", () =>
      Promise.resolve({ ok: true as const, result: {} }),
    );
    hostCard = (props) => (
      <button
        type="button"
        onClick={() =>
          props.onDecide("approve", { clientConfirmation: { tick: true } })
        }
      >
        Run
      </button>
    );
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(otherClientRequest, continueToolApproval);

    fireEvent.click(screen.getByRole("button", { name: "Run" }));

    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: "approve",
          itemDecisions: undefined,
        }),
      ),
    );
  });

  it("shows the change's title and summary with the host's line when its review is gone", () => {
    registerApplyExecutor();
    hostCard = (props) =>
      props.renderDefault({
        note: "The document has to be read again before this change can be made.",
      });
    renderCard(chainedRequest());

    const item = screen.getByTestId("chained-approval-item");
    expect(item).toHaveTextContent("Change “Vertrag.docx”");
    expect(item).toHaveTextContent("Updates 2 of 9 sections: § 3, § 5");
    expect(screen.getByTestId("chained-approval-note")).toHaveTextContent(
      "The document has to be read again before this change can be made.",
    );
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
  });

  it("offers no approval where the change's tool cannot run, and still lets it be denied", async () => {
    hostCard = () => <div data-testid="host-card" />;
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(chainedRequest(), continueToolApproval);

    expect(screen.queryByTestId("host-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("chained-approval-item")).toHaveAttribute(
      "data-runs-here",
      "false",
    );
    expect(screen.getByTestId("chained-approval-elsewhere")).toHaveTextContent(
      "Open the Erato pane where this change was prepared to apply it.",
    );
    expect(screen.getByText("Change “Vertrag.docx”")).toBeInTheDocument();
    expect(screen.queryByText("Allow once")).not.toBeInTheDocument();
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Deny"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "reject" }),
      ),
    );
  });

  it("offers no Always on a change that needs a choice on screen", () => {
    registerApplyExecutor();
    renderCard(chainedRequest({ decide_on_screen: true }, false));

    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();
    expect(screen.getByText("Never allow")).toBeInTheDocument();
  });
});

/** The chained change on one stop with a task's question, asked at `taskAskedAt`. */
const withTask = (
  base: McpToolApprovalRequestPart,
  taskAskedAt = "2026-11-23T10:00:05Z",
) =>
  ({
    ...base,
    approvals: [
      ...(base.approvals ?? []),
      {
        approval_id: "task-a",
        tool_call_id: "task-a",
        tool_name: "delegate_task",
        input: { task: "Summarize the release notes" },
        child: {
          child_chat_id: "11111111-1111-1111-1111-111111111111",
          child_message_id: "22222222-2222-2222-2222-222222222222",
          child_tool_call_id: "child-call-1",
          tool_name: "publish_approval_probe",
          mcp_server_id: "mock_mcp_approval",
          input: { channel: "release" },
          annotations: base.annotations,
          preset: "permissive",
          requested_at: taskAskedAt,
          allow_always: false,
        },
      },
    ],
  }) as unknown as McpToolApprovalRequestPart;

describe("a host's own card in a queue", () => {
  it("holds the host card's choices until the stop is fully decided", async () => {
    registerApplyExecutor();
    hostCard = (props) => (
      <button
        type="button"
        onClick={() =>
          props.onDecide("approve", { clientConfirmation: { rows: [1] } })
        }
      >
        Apply
      </button>
    );
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(withTask(chainedRequest()), continueToolApproval);

    expect(screen.getByTestId("approval-queue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(continueToolApproval).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          itemDecisions: [
            {
              approvalId: APPLY_ID,
              decision: "approve",
              clientConfirmation: { rows: [1] },
            },
            { approvalId: "task-a", decision: "approve" },
          ],
        }),
      ),
    );
  });
});

describe("Allow all on a stop with a chained change", () => {
  it("leaves a change that cannot be made here open, and allows the rest", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(
      withTask(chainedRequest(), "2026-11-23T09:59:00Z"),
      continueToolApproval,
    );

    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));

    expect(continueToolApproval).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("chained-approval-elsewhere"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-allow-all"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Deny"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          itemDecisions: [
            { approvalId: APPLY_ID, decision: "reject" },
            { approvalId: "task-a", decision: "approve" },
          ],
        }),
      ),
    );
  });

  it("leaves a change that needs a choice on screen to its card", async () => {
    registerApplyExecutor();
    hostCard = (props) => (
      <button
        type="button"
        onClick={() =>
          props.onDecide("approve", {
            clientConfirmation: { replace_whole_document: true },
          })
        }
      >
        Apply
      </button>
    );
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(
      withTask(
        chainedRequest({ decide_on_screen: true, reason: "whole_document" }),
        "2026-11-23T09:59:00Z",
      ),
      continueToolApproval,
    );

    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));
    expect(continueToolApproval).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          itemDecisions: [
            {
              approvalId: APPLY_ID,
              decision: "approve",
              clientConfirmation: { replace_whole_document: true },
            },
            { approvalId: "task-a", decision: "approve" },
          ],
        }),
      ),
    );
  });

  it("allows a change this device can make with the rest", async () => {
    registerApplyExecutor();
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(withTask(chainedRequest()), continueToolApproval);

    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          itemDecisions: [
            { approvalId: APPLY_ID, decision: "approve" },
            { approvalId: "task-a", decision: "approve" },
          ],
        }),
      ),
    );
  });
});

/** Registers or removes executors the way a pane does after the card is up. */
const afterRender = (change: () => void) =>
  act(async () => {
    change();
    await Promise.resolve();
  });

describe("a chained change when the pane registers its tool later", () => {
  it("turns into the host card once the tool can run here, and back when it goes", async () => {
    hostCard = () => <div data-testid="host-card" />;
    renderCard(chainedRequest());
    expect(
      screen.getByTestId("chained-approval-elsewhere"),
    ).toBeInTheDocument();

    let unregister = () => {};
    await afterRender(() => {
      unregister = registerApplyExecutor();
    });
    expect(screen.getByTestId("host-card")).toBeInTheDocument();
    expect(
      screen.queryByTestId("chained-approval-elsewhere"),
    ).not.toBeInTheDocument();

    await afterRender(() => unregister());
    expect(screen.queryByTestId("host-card")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("chained-approval-elsewhere"),
    ).toBeInTheDocument();
  });

  it("offers Allow all for the change once the tool can run here", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(
      withTask(chainedRequest(), "2026-11-23T09:59:00Z"),
      continueToolApproval,
    );
    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));
    expect(
      screen.queryByTestId("tool-approval-allow-all"),
    ).not.toBeInTheDocument();

    await afterRender(registerApplyExecutor);
    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          itemDecisions: [
            { approvalId: APPLY_ID, decision: "approve" },
            { approvalId: "task-a", decision: "approve" },
          ],
        }),
      ),
    );
  });

  it("hands the voice a decision once the tool can run here", async () => {
    renderCard(chainedRequest(), undefined, true);
    const before = spoken.decide;
    expect(before?.(APPLY_ID)).toBeUndefined();

    await afterRender(registerApplyExecutor);
    // The voice reads whether it may decide when the card is drawn.
    expect(spoken.decide).not.toBe(before);
    expect(spoken.decide?.(APPLY_ID)).toBeDefined();
  });

  it("does not draw the host card again when nothing it shows changed", async () => {
    let renders = 0;
    hostCard = () => {
      renders += 1;
      return <div data-testid="host-card" />;
    };
    const unregister = registerApplyExecutor();
    renderCard(chainedRequest());
    const drawn = renders;

    await afterRender(() => {
      registerClientToolExecutor("search_sidecar_index", () =>
        Promise.resolve({ ok: true as const, result: {} }),
      );
      // A pane registering its tools again removes and adds them in one go.
      unregister();
      registerApplyExecutor();
    });
    expect(renders).toBe(drawn);
  });
});

describe("a chained change by voice", () => {
  it("is said from the change's title and summary", () => {
    registerApplyExecutor();
    renderCard(chainedRequest(), undefined, true);

    expect(spoken.approvals).toEqual([
      expect.objectContaining({
        type: "call",
        summary: {
          title: "Change “Vertrag.docx”",
          description: "Updates 2 of 9 sections: § 3, § 5",
          onScreen: false,
        },
      }),
    ]);
    expect(spoken.decide?.(APPLY_ID)).toBeDefined();
  });

  it("takes no decision by voice on a card that needs a choice on screen", () => {
    registerApplyExecutor();
    renderCard(
      chainedRequest({ decide_on_screen: true, reason: "whole_document" }),
      undefined,
      true,
    );

    expect(spoken.approvals).toEqual([
      expect.objectContaining({
        summary: expect.objectContaining({ onScreen: true }),
      }),
    ]);
    expect(spoken.decide?.(APPLY_ID)).toBeUndefined();
  });

  it("takes no decision by voice where the change cannot be made", () => {
    renderCard(chainedRequest(), undefined, true);
    expect(spoken.decide?.(APPLY_ID)).toBeUndefined();
  });
});
