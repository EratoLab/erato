import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { ChatContext } from "@/providers/ChatProvider";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { ToolApprovalStatus } from "../Trace/Trace";
import type { ChatContextValue } from "@/providers/ChatProvider";
import type { ReactNode } from "react";

vi.mock("@/auth/tokenStore", () => ({
  getIdToken: () => null,
}));

const archived: { value: boolean | undefined } = { value: false };
vi.mock("@/hooks/chat/useChatArchived", () => ({
  useChatArchived: () => archived.value,
}));

const approvalRequest = {
  tool_call_id: "tool-call-1",
  tool_name: "publish_approval_probe",
  mcp_server_id: "mock_mcp_approval",
  input: { channel: "release", message: "Ready to publish" },
  annotations: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  preset: "permissive",
  allow_always: true,
  requested_at: "2026-08-06T00:00:00Z",
};

const withChatContext = (
  ui: ReactNode,
  chatId = "chat-1",
  overrides: Partial<ChatContextValue> = {},
) => (
  <ChatContext.Provider
    value={
      {
        currentChatId: chatId,
        refetchMessages: async () => undefined,
        ...overrides,
      } as unknown as ChatContextValue
    }
  >
    {ui}
  </ChatContext.Provider>
);

const renderCard = (ui: ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
  return { ...result, queryClient };
};

afterEach(() => {
  vi.unstubAllGlobals();
  archived.value = false;
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
  useGenerationStatusStore.getState().reset();
});

describe("McpToolApprovalCard", () => {
  it("shows the pending tool call as a visible referent above the consent card", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("mcp-tool-approval")).toHaveAttribute(
      "data-tool-name",
      "publish_approval_probe",
    );
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
    expect(screen.getByText("mock_mcp_approval")).toBeInTheDocument();
    // The input is visible without interaction — the user sees what they
    // approve, like the add-in's confirmation summary.
    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    expect(screen.getByText(/"release"/)).toBeInTheDocument();
  });

  it("resolves the card in place after a decision instead of navigating", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    });
  });

  it("posts a standing refusal, so a tool can be settled from the chat", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Never allow"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            message_id: "message-1",
            decision: "reject_always",
          }),
        }),
      );
    });
  });

  it("drops the cached tool rosters after an Always allow, not after a one-off", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("", { status: 200 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient, unmount } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByText("Always allow"));

    await waitFor(() => {
      expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    });
    // The grant lands on the server's roster and the account-wide settings
    // list; both are addressed by the same keys their consumers subscribe
    // with, so a stale 5-minute listing cannot outlive the decision.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: listMcpServerToolsQuery({
        pathParams: { serverId: "mock_mcp_approval" },
      }).queryKey,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
    });
    unmount();

    const { queryClient: onceClient } = renderCard(
      <McpToolApprovalCard
        messageId="message-2"
        request={approvalRequest}
        resolution={null}
      />,
    );
    const onceInvalidate = vi.spyOn(onceClient, "invalidateQueries");

    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    });
    expect(onceInvalidate).not.toHaveBeenCalled();
  });

  it("holds the chat's confirmation registry while the decision is pending", () => {
    const { unmount } = renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
      true,
    );

    unmount();
    expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
      false,
    );
  });

  it("releases the registry hold once the decision resolves", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    fireEvent.click(screen.getByText("Deny once"));

    await waitFor(() => {
      expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
        false,
      );
    });
  });

  it("greys out Always allow with the policy reason instead of hiding it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{ ...approvalRequest, allow_always: false }}
        resolution={null}
      />,
    );

    const alwaysAllow = screen.getByRole("button", { name: "Always allow" });
    expect(alwaysAllow).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByText(/requires confirmation each time/),
    ).toBeInTheDocument();

    fireEvent.click(alwaysAllow);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withdraws the decision from an archived chat, which refuses the write", () => {
    archived.value = true;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull();
    expect(
      screen.getByText(/archived and no longer takes messages/),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("neither holds the registry nor seeds the marker on an archived chat", () => {
    archived.value = true;

    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
      false,
    );
    expect(
      useGenerationStatusStore.getState().statusByChatId["chat-1"],
    ).toBeUndefined();
  });

  it("holds the registry but seeds nothing until the chat is known", () => {
    archived.value = undefined;

    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
      true,
    );
    expect(
      useGenerationStatusStore.getState().statusByChatId["chat-1"],
    ).toBeUndefined();
  });

  it("seeds the marker once the chat is known not to be archived", () => {
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    expect(
      useGenerationStatusStore.getState().statusByChatId["chat-1"]?.kind,
    ).toBe("action_required");
  });

  it("does not register an already-resolved request", () => {
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution="approved"
        />,
      ),
    );

    expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
      false,
    );
  });
  const renderWiredCard = (
    continueToolApproval: () => Promise<void>,
    context: Partial<ChatContextValue> = {},
  ) => {
    const card = (resolution: ToolApprovalStatus | null) =>
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={resolution}
        />,
        "chat-1",
        { continueToolApproval, ...context },
      );
    const { queryClient, rerender, ...rest } = renderCard(card(null));
    return {
      ...rest,
      rerenderResolved: (resolution: ToolApprovalStatus) =>
        rerender(
          <QueryClientProvider client={queryClient}>
            {card(resolution)}
          </QueryClientProvider>,
        ),
    };
  };

  it("hands the decision to the chat's streamed continuation instead of consuming it here", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { rerenderResolved } = renderWiredCard(continueToolApproval);
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(continueToolApproval).toHaveBeenCalledWith({
        messageId: "message-1",
        decision: "approve",
        toolCallId: approvalRequest.tool_call_id,
        toolName: approvalRequest.tool_name,
        toolInput: approvalRequest.input,
        mcpServerId: approvalRequest.mcp_server_id,
      });
    });
    // The card no longer buffers the continuation itself.
    expect(fetchMock).not.toHaveBeenCalled();

    // Nor does it latch its own resolution: hiding is the seeded decision
    // part's job, so a refused decision brings the card back on its own.
    await waitFor(() => {
      expect(screen.getByText("Allow once")).not.toBeDisabled();
    });
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();

    rerenderResolved("approved");
    expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
  });

  it("holds the buttons while the decision is in flight and releases them once it is accepted", async () => {
    let accept!: () => void;
    const continueToolApproval = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        accept = resolve;
      }),
    );
    vi.stubGlobal("fetch", vi.fn());

    renderWiredCard(continueToolApproval);
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => expect(continueToolApproval).toHaveBeenCalled());
    expect(screen.getByText("Allow once")).toBeDisabled();

    await act(async () => {
      accept();
    });
    await waitFor(() => {
      expect(screen.getByText("Allow once")).not.toBeDisabled();
    });
  });

  it("holds the buttons while the chat is still settling the previous turn", () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());

    renderWiredCard(continueToolApproval, { isPendingResponse: true });

    const allowOnce = screen.getByText("Allow once");
    expect(allowOnce).toBeDisabled();
    fireEvent.click(allowOnce);
    expect(continueToolApproval).not.toHaveBeenCalled();
  });

  it("keeps the card up with the reason when the decision is refused", async () => {
    const continueToolApproval = vi
      .fn()
      .mockRejectedValue(new Error("Message generation is not awaiting"));
    vi.stubGlobal("fetch", vi.fn());

    renderWiredCard(continueToolApproval);
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(
        screen.getByText(/Message generation is not awaiting/),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
  });
});
