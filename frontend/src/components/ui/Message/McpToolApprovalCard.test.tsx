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
import { FrontendRequestError } from "@/utils/errorReport";

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

// A live origin: the backend sends the title with the id, and drops the title
// once the chat is gone. Tests that need a deleted origin clear the title.
const originChat: {
  value: {
    id: string;
    origin_chat_id?: string;
    origin_chat_title?: string;
  };
} = {
  value: {
    id: "chat-1",
    origin_chat_id: "origin-1",
    origin_chat_title: "Origin chat",
  },
};

// The origin link reads this chat's provenance; the rest of the module is the
// real thing, because the card's cache invalidation uses its query keys.
vi.mock(
  "@/lib/generated/v1betaApi/v1betaApiComponents",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/lib/generated/v1betaApi/v1betaApiComponents")
      >();
    return {
      ...actual,
      useChatDetail: () => ({ data: originChat.value }),
    };
  },
);

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

const childApprovalRef = {
  child_chat_id: "11111111-1111-1111-1111-111111111111",
  child_message_id: "22222222-2222-2222-2222-222222222222",
  child_tool_call_id: "child-call-1",
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
  requested_at: "2026-08-06T00:00:00Z",
};

// A kind that names no MCP server writes an empty server id and the synthetic
// dispatch name on the flat fields.
const delegatedTaskRequest = {
  ...approvalRequest,
  tool_name: "delegate_task",
  mcp_server_id: "",
  kind: "delegated_task" as const,
  approvals: [
    {
      approval_id: "parent-call-1",
      tool_call_id: "parent-call-1",
      tool_name: "delegate_task",
      input: { task: "Summarize the release notes" },
      child: childApprovalRef,
    },
  ],
};

// Two children of one turn, parked on different MCP servers: a grant on each
// is written where that child's tool lives.
const twoChildRequest = {
  ...delegatedTaskRequest,
  approvals: [
    ...delegatedTaskRequest.approvals,
    {
      approval_id: "parent-call-2",
      tool_call_id: "parent-call-2",
      tool_name: "delegate_task",
      input: { task: "Check the migration notes" },
      child: {
        ...childApprovalRef,
        child_tool_call_id: "child-2",
        mcp_server_id: "mock_mcp_file",
      },
    },
  ],
};

const taskPlanRequest = {
  ...approvalRequest,
  tool_name: "delegate_task",
  mcp_server_id: "",
  allow_always: false,
  kind: "task_plan" as const,
  approvals: [
    {
      approval_id: "plan:0:0",
      tool_call_id: "call-a",
      tool_name: "delegate_task",
      input: { task: "Draft the changelog", run_mode: "async" },
    },
    {
      approval_id: "plan:0:1",
      tool_call_id: "call-b",
      tool_name: "delegate_task",
      input: { task: "Check the migration notes" },
    },
  ],
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
  originChat.value = {
    id: "chat-1",
    origin_chat_id: "origin-1",
    origin_chat_title: "Origin chat",
  };
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

  it("drops the roster of every child a standing grant was written on", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response("", { status: 200 })),
        ),
    );

    const { queryClient } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={twoChildRequest}
        resolution={null}
      />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getAllByText("Always allow")[0]);
    fireEvent.click(screen.getByText("Always allow"));

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: listMcpServerToolsQuery({
          pathParams: { serverId: "mock_mcp_approval" },
        }).queryKey,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: listMcpServerToolsQuery({
        pathParams: { serverId: "mock_mcp_file" },
      }).queryKey,
    });
  });

  it("drops the rosters even when the last row answered was a one-off", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response("", { status: 200 })),
        ),
    );

    const { queryClient } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={twoChildRequest}
        resolution={null}
      />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getAllByText("Always allow")[0]);
    fireEvent.click(screen.getByText("Allow once"));

    // The request is sent on the last row's click, but what it carries is every
    // row's answer — the grant above is in it.
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: listMcpServerToolsQuery({
        pathParams: { serverId: "mock_mcp_approval" },
      }).queryKey,
    });
    // Nothing standing was answered for the other child.
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: listMcpServerToolsQuery({
        pathParams: { serverId: "mock_mcp_file" },
      }).queryKey,
    });
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
        // A row written before approvals were addressable still answers as one
        // item, keyed by the gated call.
        approvalIds: [approvalRequest.tool_call_id],
        itemDecisions: undefined,
        items: [
          {
            approval_id: approvalRequest.tool_call_id,
            tool_call_id: approvalRequest.tool_call_id,
            tool_name: approvalRequest.tool_name,
            input: approvalRequest.input,
            child: null,
          },
        ],
        kind: "mcp_tool",
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

  it("posts a decisions array once the stop covers more than one approval", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...approvalRequest,
          kind: "mcp_tool",
          approvals: [
            {
              approval_id: "tool-call-1",
              tool_call_id: "tool-call-1",
              tool_name: "publish_approval_probe",
              input: {},
            },
            {
              approval_id: "tool-call-2",
              tool_call_id: "tool-call-2",
              tool_name: "publish_approval_probe",
              input: {},
            },
          ],
        }}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));

    // The legacy body names no approval, so the server would refuse it here:
    // every open item has to be covered.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({
          body: JSON.stringify({
            message_id: "message-1",
            decisions: [
              { approval_id: "tool-call-1", decision: "approve" },
              { approval_id: "tool-call-2", decision: "approve" },
            ],
          }),
        }),
      );
    });
  });

  it("keeps the legacy body for a single approval", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...approvalRequest,
          kind: "mcp_tool",
          approvals: [
            {
              approval_id: "tool-call-1",
              tool_call_id: "tool-call-1",
              tool_name: "publish_approval_probe",
              input: {},
            },
          ],
        }}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({
          body: JSON.stringify({
            message_id: "message-1",
            decision: "approve",
          }),
        }),
      );
    });
  });

  it("falls back to the generic card for a kind this build has no card for", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...approvalRequest,
          // What the server writes for a kind that names no MCP server.
          tool_name: "delegate_task",
          mcp_server_id: "",
          kind: "some_later_kind" as never,
        }}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("tool-approval-generic")).toHaveAttribute(
      "data-approval-kind",
      "some_later_kind",
    );
    // The MCP layout would have shown an empty server id as the referent.
    expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();
  });

  it.each([
    ["delegated_task", "delegated-task-approval"],
    ["task_plan", "task-plan-approval"],
  ] as const)(
    "asks a %s stop written without an approvals array all the same",
    (kind, testId) => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={{
            ...approvalRequest,
            tool_name: "delegate_task",
            mcp_server_id: "",
            kind,
          }}
          resolution={null}
        />,
      );

      // The flat fields are one item's worth, so the kind's own card can still
      // put the question — and it is the one that knows how to say what is
      // missing from the row.
      expect(screen.getByTestId(testId)).toHaveAttribute(
        "data-item-count",
        "1",
      );
    },
  );

  it("shows the child's own MCP call, not the parent's dispatch, on a delegated task", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={delegatedTaskRequest}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("delegated-task-approval")).toHaveAttribute(
      "data-item-count",
      "1",
    );
    // The task the child was given identifies it; a task child has no
    // assistant name to be known by.
    expect(screen.getByText("Summarize the release notes")).toBeInTheDocument();
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
    expect(screen.getByText("mock_mcp_approval")).toBeInTheDocument();
    expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-generic"),
    ).not.toBeInTheDocument();
  });

  it("keys a standing grant on a parked child to the child's own server", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn());

    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={delegatedTaskRequest}
          resolution={null}
        />,
        "chat-1",
        { continueToolApproval },
      ),
    );

    fireEvent.click(screen.getByText("Always allow"));

    await waitFor(() => {
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "delegated_task",
          // Carried per item, because one stop can hold children of several
          // servers; the request's own id is only the fallback for an item that
          // names no child, and is empty on this route.
          mcpServerId: "",
          items: [
            expect.objectContaining({
              approval_id: "parent-call-1",
              child: expect.objectContaining({
                mcp_server_id: "mock_mcp_approval",
              }),
            }),
          ],
          itemDecisions: [
            { approvalId: "parent-call-1", decision: "approve_always" },
          ],
        }),
      );
    });
  });

  it("renders one card with a row per parked child", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...delegatedTaskRequest,
          approvals: [
            ...delegatedTaskRequest.approvals,
            {
              approval_id: "parent-call-2",
              tool_call_id: "parent-call-2",
              tool_name: "delegate_task",
              input: { task: "Check the migration notes" },
              child: { ...childApprovalRef, child_tool_call_id: "child-2" },
            },
          ],
        }}
        resolution={null}
      />,
    );

    expect(screen.getAllByTestId("delegated-task-approval-item")).toHaveLength(
      2,
    );
    expect(screen.getAllByTestId("delegated-task-approval")).toHaveLength(1);
  });

  it("holds a per-task answer until the whole plan is decided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={taskPlanRequest}
        resolution={null}
      />,
    );

    const rows = screen.getAllByTestId("task-plan-approval-item");
    expect(rows).toHaveLength(2);

    // The server refuses a body that does not cover the open set exactly, so
    // the first answer cannot be sent on its own.
    fireEvent.click(screen.getAllByText("Allow once")[0]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/sent once every item is decided/).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("Deny once"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({
          body: JSON.stringify({
            message_id: "message-1",
            decisions: [
              { approval_id: "plan:0:0", decision: "approve" },
              { approval_id: "plan:0:1", decision: "reject" },
            ],
          }),
        }),
      );
    });
  });

  it("offers no standing answer on a task plan", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={taskPlanRequest}
        resolution={null}
      />,
    );

    // What a deployment dispatches unasked is config's to say, not a
    // per-user setting's.
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();
    expect(screen.queryByText("Never allow")).not.toBeInTheDocument();
  });

  it("withdraws every open item with one decision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={taskPlanRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByTestId("tool-approval-withdraw"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1beta/me/messages/continuestream",
        expect.objectContaining({
          body: JSON.stringify({
            message_id: "message-1",
            decisions: [
              { approval_id: "plan:0:0", decision: "withdraw" },
              { approval_id: "plan:0:1", decision: "withdraw" },
            ],
          }),
        }),
      );
    });
  });

  it("points at the origin chat when the parent holds the same approval", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "covered_by_parent",
          parent_message_id: "22222222-2222-2222-2222-222222222222",
        }),
        { status: 409 },
      ),
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
      expect(
        screen.getByTestId("tool-approval-origin-link"),
      ).toBeInTheDocument();
    });
    // The card stays answerable: the refusal lifts by itself once the origin
    // settles or is withdrawn.
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
    // The link IS the explanation; the wire envelope beside it would read as a
    // second, unexplained failure.
    expect(screen.queryByText(/covered_by_parent/)).not.toBeInTheDocument();
  });

  it("says where the decision lives without linking when the origin chat is gone", async () => {
    // The id outlives the chat it names; the backend drops the title instead.
    // A link here would land the user on a chat that is not there.
    originChat.value = { id: "chat-1", origin_chat_id: "origin-1" };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "covered_by_parent",
          parent_message_id: "22222222-2222-2222-2222-222222222222",
        }),
        { status: 409 },
      ),
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
      expect(
        screen.getByTestId("tool-approval-origin-notice"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("tool-approval-origin-link"),
    ).not.toBeInTheDocument();
    // Still the explanation, and the card is still answerable.
    expect(screen.queryByText(/covered_by_parent/)).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
  });

  it("points at the origin chat on the streamed path too", async () => {
    const continueToolApproval = vi.fn().mockRejectedValue(
      new FrontendRequestError(
        "SSE request failed",
        { method: "POST", url: "/api/v1beta/me/messages/continuestream" },
        {
          status: 409,
          statusText: "Conflict",
          body: JSON.stringify({
            code: "covered_by_parent",
            parent_message_id: "22222222-2222-2222-2222-222222222222",
          }),
        },
      ),
    );
    vi.stubGlobal("fetch", vi.fn());

    renderWiredCard(continueToolApproval);
    fireEvent.click(screen.getByText("Allow once"));

    // The streamed continuation is the path the real app takes; its refusal
    // arrives as the same envelope wrapped by the SSE client.
    await waitFor(() => {
      expect(
        screen.getByTestId("tool-approval-origin-link"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/covered_by_parent/)).not.toBeInTheDocument();
    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
  });

  it("settles off the row instead of failing when the stop was already answered", async () => {
    const refetchMessages = vi.fn().mockResolvedValue(undefined);
    const continueToolApproval = vi.fn().mockRejectedValue(
      new FrontendRequestError(
        "SSE request failed",
        { method: "POST", url: "/api/v1beta/me/messages/continuestream" },
        {
          status: 409,
          statusText: "Conflict",
          body: JSON.stringify({ code: "already_continued" }),
        },
      ),
    );
    vi.stubGlobal("fetch", vi.fn());

    renderWiredCard(continueToolApproval, { refetchMessages });
    fireEvent.click(screen.getByText("Allow once"));

    // The answer landed on a stop that was already decided — a second tab, a
    // stale row — so the card resolves off the settled row rather than calling
    // the decision a failure.
    await waitFor(() => {
      expect(refetchMessages).toHaveBeenCalled();
    });
    expect(screen.queryByText(/already_continued/)).not.toBeInTheDocument();
    expect(screen.queryByText(/SSE request failed/)).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-origin-link"),
    ).not.toBeInTheDocument();
  });

  it("holds the last row's answer on screen while the stop is in flight", async () => {
    let respond!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
      ),
    );

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={taskPlanRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getAllByText("Allow once")[0]);
    fireEvent.click(screen.getByText("Deny once"));

    // The row that triggered the send is answered like the rest of them: left
    // undecided it reads as a click that went nowhere.
    expect(
      screen.getAllByText(/Denied — sent once every item is decided/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Allowed — sent once every item is decided/).length,
    ).toBeGreaterThan(0);

    await act(async () => {
      respond(new Response("", { status: 200 }));
    });
  });

  it("puts a row back in play when the stop is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 409 })),
    );

    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={taskPlanRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getAllByText("Allow once")[0]);
    fireEvent.click(screen.getByText("Deny once"));

    await waitFor(() => {
      expect(screen.getByText(/nope/)).toBeInTheDocument();
    });
    // Held answers left on screen would read as decided with no way to send
    // them again. Waited for: the card's live region catches up one render
    // behind the row it announces.
    await waitFor(() => {
      expect(
        screen.queryAllByText(/sent once every item is decided/),
      ).toHaveLength(0);
    });
    expect(screen.getAllByText("Allow once")).toHaveLength(2);
  });

  it("renders the MCP layout for a row written before kinds existed", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("mcp-tool-approval")).toBeInTheDocument();
    expect(
      screen.queryByTestId("tool-approval-generic"),
    ).not.toBeInTheDocument();
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
