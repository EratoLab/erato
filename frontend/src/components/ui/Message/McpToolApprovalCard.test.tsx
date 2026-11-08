import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerClientToolExecutor,
  resetClientToolRegistryForTests,
} from "@/hooks/chat/clientToolExecutors";
import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useGenerationStatusStore } from "@/hooks/chat/store/generationStatusStore";
import { registerOperationExecutor } from "@/lib/clientOperations/registration";
import {
  listMcpServerToolsQuery,
  listUserToolApprovalSettingsQuery,
  profileQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { ChatContext } from "@/providers/ChatProvider";
import { FrontendRequestError } from "@/utils/errorReport";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { ToolApprovalStatus } from "../Trace/Trace";
import type {
  ApprovalScope,
  ToolArgumentNode,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatContextValue } from "@/providers/ChatProvider";
import type { ReactNode } from "react";

vi.mock("@/auth/tokenStore", () => ({
  getIdToken: () => null,
}));

vi.mock("@/hooks/ui/useThemedIcon", () => ({
  useThemedIcon: () => "icon-id",
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
  it.each([
    ["Continue tool calls", "approve"],
    ["Generate answer now", "reject"],
    ["Stop", "withdraw"],
  ])("submits the budget choice for %s", async (label, decision) => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={{
            ...approvalRequest,
            kind: "tool_call_limit",
            tool_name: "",
            mcp_server_id: "",
            allow_always: false,
            input: { budget: 15 },
          }}
          resolution={null}
        />,
        "chat-1",
        { continueToolApproval },
      ),
    );
    expect(
      screen.getByRole("group", { name: "Tool-call limit reached" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Always allow")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          decision,
          kind: "tool_call_limit",
          approvalIds: ["tool-call-1"],
        }),
      ),
    );
  });

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

  it("names the server by the name saved with the request", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...approvalRequest,
          display: {
            title: "publish_approval_probe",
            description_truncated: false,
            server_name: "Approval Probe",
          },
        }}
        resolution={null}
      />,
    );

    expect(screen.getByText("Approval Probe")).toBeInTheDocument();
    expect(screen.queryByText("mock_mcp_approval")).not.toBeInTheDocument();
  });

  it("uses the saved descriptor as plain text and submits the executable identity", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    const request = {
      ...approvalRequest,
      display: {
        title: "Publish release notes",
        description: "Send [notes](https://example.com) <b>unchanged</b>",
        description_truncated: false,
      },
    };
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={request}
          resolution={null}
        />,
        "chat-1",
        { continueToolApproval },
      ),
    );
    expect(screen.getByText("Publish release notes")).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(screen.getByText(request.display.description)).toHaveAttribute(
      "dir",
      "auto",
    );
    expect(
      screen.queryByText("Description shortened by Erato"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "notes" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "publish_approval_probe",
          toolCallId: "tool-call-1",
          mcpServerId: "mock_mcp_approval",
          toolInput: approvalRequest.input,
          approvalIds: ["tool-call-1"],
        }),
      ),
    );
  });

  it("keeps long multiline arguments complete alongside a shortened description", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    const message = `${"Message  line\n".repeat(500)}Final message line`;
    const request = {
      ...approvalRequest,
      input: { message },
      display: {
        title: "Publish release notes",
        description: "Shortened tool description",
        description_truncated: true,
      },
    };
    const { container } = renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={request}
          resolution={null}
        />,
        "chat-1",
        { continueToolApproval },
      ),
    );
    const value = container.querySelector("span.text-theme-success-fg");

    expect(value?.textContent).toBe(`"${message}"`);
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(value?.closest(".max-h-48")).toHaveClass("overflow-y-auto");
    expect(screen.getByText("Description shortened by Erato")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({ toolInput: request.input }),
      ),
    );
  });

  it("keeps full multiline task arguments beneath a shortened plan heading", () => {
    const task = `${"Task  line\n".repeat(30)}Final task line`;
    const { container } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...taskPlanRequest,
          approvals: [{ ...taskPlanRequest.approvals[0], input: { task } }],
        }}
      />,
    );
    const heading = screen
      .getByTestId("task-plan-approval-item")
      .querySelector("p");
    const value = container.querySelector("span.text-theme-success-fg");

    expect(heading?.textContent).toBe(`${task.slice(0, 160)}…`);
    expect(value?.textContent).toBe(`"${task}"`);
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(value?.closest(".max-h-48")).toHaveClass("overflow-y-auto");
  });

  it("preserves multiline arguments on a delegated child's approval", () => {
    const message = "First line\n\n  Indented  line";
    const { container } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...delegatedTaskRequest,
          approvals: [
            {
              ...delegatedTaskRequest.approvals[0],
              child: { ...childApprovalRef, input: { message } },
            },
          ],
        }}
      />,
    );
    const value = container.querySelector("span.text-theme-success-fg");

    expect(value?.textContent).toBe(`"${message}"`);
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
    expect(value?.closest(".max-h-48")).toHaveClass("overflow-y-auto");
  });

  it("renders the child's saved descriptor on a delegated approval", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...delegatedTaskRequest,
          approvals: [
            {
              ...delegatedTaskRequest.approvals[0],
              child: {
                ...childApprovalRef,
                display: {
                  title: "Child tool title",
                  description: "A truncated child description",
                  description_truncated: true,
                  server_name: "Approval Probe",
                },
              },
            },
          ],
        }}
      />,
    );
    expect(screen.getByText("Child tool title")).toBeInTheDocument();
    expect(screen.getByText("Approval Probe")).toBeInTheDocument();
    expect(screen.queryByText("mock_mcp_approval")).not.toBeInTheDocument();
    expect(
      screen.getByText("A truncated child description"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Description shortened by Erato"),
    ).toBeInTheDocument();
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
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
            shows_child_items: true,
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
        enumerate: false,
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
            shows_child_items: true,
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
            shows_child_items: true,
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
    ["delegated_task", "approval-queue"],
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

    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
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

  it("shows a stop's parked children one at a time on one card", () => {
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

    expect(screen.getAllByTestId("approval-queue")).toHaveLength(1);
    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-item-count",
      "2",
    );
    expect(screen.getAllByTestId("delegated-task-approval-item")).toHaveLength(
      1,
    );
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
            shows_child_items: true,
          }),
        }),
      );
    });
  });

  it.each([
    {
      row: "Allow once",
      bulk: "tool-approval-deny-all",
      sent: ["reject", "reject"],
    },
    {
      row: "Deny once",
      bulk: "tool-approval-allow-all",
      sent: ["reject", "approve"],
    },
  ])(
    "lets a denial win when a row's $row meets the plan's $bulk",
    async ({ row, bulk, sent }) => {
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

      fireEvent.click(screen.getAllByText(row)[0]);
      fireEvent.click(screen.getByTestId(bulk));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(
        JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body),
      ).toMatchObject({
        decisions: [
          { approval_id: "plan:0:0", decision: sent[0] },
          { approval_id: "plan:0:1", decision: sent[1] },
        ],
      });
    },
  );

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
            shows_child_items: true,
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

describe("client tool approvals", () => {
  const clientToolRequest = {
    ...approvalRequest,
    tool_call_id: "client-call-1",
    tool_name: "search_sidecar_index",
    mcp_server_id: "desktop",
    input: { query: "quarterly report" },
    preset: "",
    kind: "client_tool" as const,
  };

  it("names this device even when a server name was saved", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...clientToolRequest,
          display: {
            title: "search_sidecar_index",
            description_truncated: false,
            server_name: "Desktop",
          },
        }}
        resolution={null}
      />,
    );

    const card = screen.getByTestId("mcp-tool-approval");
    expect(card).toHaveTextContent("This device");
    expect(card).not.toHaveTextContent("Desktop");
  });

  it("asks on the same card as an MCP tool, naming this device instead of a server", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={clientToolRequest}
        resolution={null}
      />,
    );

    const card = screen.getByTestId("mcp-tool-approval");
    expect(card).toHaveAttribute("data-approval-kind", "client_tool");
    expect(card).toHaveTextContent("search_sidecar_index");
    expect(card).toHaveTextContent("This device");
    expect(card).not.toHaveTextContent("desktop");
    expect(
      screen.getAllByText("Allow this tool to run on your device?").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("tool-approval-generic")).toBeNull();
    for (const label of [
      "Allow once",
      "Always allow",
      "Deny once",
      "Never allow",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(
      screen.queryByText("This tool may send data to an external service."),
    ).toBeNull();
  });

  it("tells the server which client tools this device runs and refreshes the saved decisions", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("", { status: 200 })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { queryClient } = renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={clientToolRequest}
        resolution={null}
      />,
    );
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    fireEvent.click(screen.getByText("Always allow"));

    await waitFor(() => {
      expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toHaveProperty("X-Erato-Client-Tools");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: profileQuery({}).queryKey,
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: listMcpServerToolsQuery({
        pathParams: { serverId: "desktop" },
      }).queryKey,
    });
  });
});

describe("approval queue", () => {
  // The turn's own gated call with two of its tasks parked in the same batch.
  // Task A asked before the turn's call did, so it leads the queue although the
  // row lists the turn's call first.
  const mixedRequest = {
    ...approvalRequest,
    kind: "mcp_tool" as const,
    allow_always: false,
    requested_at: "2026-08-06T00:00:05Z",
    approvals: [
      {
        approval_id: "tool-call-1",
        tool_call_id: "tool-call-1",
        tool_name: "publish_approval_probe",
        input: approvalRequest.input,
        child: null,
      },
      {
        approval_id: "task-a",
        tool_call_id: "task-a",
        tool_name: "delegate_task",
        input: { task: "Summarize the release notes" },
        child: {
          ...childApprovalRef,
          child_chat_id: "child-a",
          requested_at: "2026-08-06T00:00:01Z",
          allow_always: false,
        },
      },
      {
        approval_id: "task-b",
        tool_call_id: "task-b",
        tool_name: "delegate_task",
        input: { task: "Check the migration notes" },
        child: {
          ...childApprovalRef,
          child_chat_id: "child-b",
          child_tool_call_id: "child-2",
          mcp_server_id: "mock_mcp_file",
          requested_at: "2026-08-06T00:00:09Z",
          allow_always: false,
        },
      },
    ],
  };

  const okResponse = () =>
    vi
      .fn()
      .mockResolvedValue(
        new Response("event: done\\ndata: {}\\n\\n", { status: 200 }),
      );

  const sentDecisions = (fetchMock: ReturnType<typeof vi.fn>) =>
    (
      JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body) as {
        decisions: unknown[];
      }
    ).decisions;

  it("shows the oldest open approval first, names its task and counts the rest", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    const queue = screen.getByTestId("approval-queue");
    expect(queue).toHaveAttribute("data-item-count", "3");
    expect(queue).toHaveAttribute("data-position", "1");
    expect(screen.queryByTestId("mcp-tool-approval")).not.toBeInTheDocument();
    expect(screen.getByText("Summarize the release notes")).toBeInTheDocument();
    expect(
      screen.queryByText("Check the migration notes"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("delegated-task-approval-item")).toHaveAttribute(
      "data-child-chat-id",
      "child-a",
    );
    const counter = screen.getByTestId("approval-queue-counter");
    expect(counter).toHaveTextContent("Decision 1 of 3");
    expect(counter).toHaveTextContent("2 more after this one");
  });

  it("shows the next approval once one is decided, and sends nothing yet", () => {
    const fetchMock = okResponse();
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-position",
      "2",
    );
    // The turn's own call keeps the MCP layout inside the queue.
    expect(screen.getByTestId("mcp-tool-approval-item")).toHaveAttribute(
      "data-approval-id",
      "tool-call-1",
    );
    expect(
      screen.getByRole("group", { name: "Allow MCP tool call?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("mock_mcp_approval")).toBeInTheDocument();
    expect(
      screen.queryByTestId("delegated-task-approval-item"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("approval-queue-counter")).toHaveTextContent(
      "1 more after this one",
    );
  });

  it("sends every answer in row order once the last approval is decided", async () => {
    const fetchMock = okResponse();
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText("Deny once"));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentDecisions(fetchMock)).toEqual([
      { approval_id: "tool-call-1", decision: "reject" },
      { approval_id: "task-a", decision: "approve" },
      { approval_id: "task-b", decision: "approve" },
    ]);
  });

  it.each([
    ["tool-approval-allow-all", "approve"],
    ["tool-approval-withdraw", "withdraw"],
  ])(
    "decides every open approval at once with %s",
    async (testId, decision) => {
      const fetchMock = okResponse();
      vi.stubGlobal("fetch", fetchMock);
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={mixedRequest}
          resolution={null}
        />,
      );

      fireEvent.click(screen.getByTestId(testId));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(sentDecisions(fetchMock)).toEqual([
        { approval_id: "tool-call-1", decision },
        { approval_id: "task-a", decision },
        { approval_id: "task-b", decision },
      ]);
    },
  );

  it("keeps an answer the queue no longer shows when everything else is allowed", async () => {
    const fetchMock = okResponse();
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Deny once"));
    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-position",
      "2",
    );
    fireEvent.click(screen.getByTestId("tool-approval-allow-all"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentDecisions(fetchMock)).toEqual([
      { approval_id: "tool-call-1", decision: "approve" },
      { approval_id: "task-a", decision: "reject" },
      { approval_id: "task-b", decision: "approve" },
    ]);
  });

  it("denies an answer already given when everything is denied", async () => {
    const fetchMock = okResponse();
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByTestId("tool-approval-deny-all"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentDecisions(fetchMock)).toEqual([
      { approval_id: "tool-call-1", decision: "reject" },
      { approval_id: "task-a", decision: "reject" },
      { approval_id: "task-b", decision: "reject" },
    ]);
  });

  it("withdraws an answer already given along with the rest", async () => {
    const fetchMock = okResponse();
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByTestId("tool-approval-withdraw"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentDecisions(fetchMock)).toEqual([
      { approval_id: "tool-call-1", decision: "withdraw" },
      { approval_id: "task-a", decision: "withdraw" },
      { approval_id: "task-b", decision: "withdraw" },
    ]);
  });

  it("puts the queue back at its first approval when the stop is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 409 })),
    );
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedRequest}
        resolution={null}
      />,
    );

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => {
      expect(screen.getByText(/nope/)).toBeInTheDocument();
    });
    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-position",
      "1",
    );
    expect(screen.getByText("Summarize the release notes")).toBeInTheDocument();
  });

  describe("on a client-tool stop", () => {
    // A client tool's own standing answer is the user's preference, so the part
    // allows it; its parked task asks about an MCP tool under its own policy.
    const clientRequest = (childAllowsAlways: boolean) => ({
      ...approvalRequest,
      tool_name: "read_document",
      mcp_server_id: "word",
      kind: "client_tool" as const,
      allow_always: true,
      requested_at: "2026-08-06T00:00:01Z",
      approvals: [
        {
          approval_id: "own-call",
          tool_call_id: "own-call",
          tool_name: "read_document",
          input: { range: "all" },
          child: null,
        },
        {
          approval_id: "task-a",
          tool_call_id: "task-a",
          tool_name: "delegate_task",
          input: { task: "Summarize the release notes" },
          child: {
            ...childApprovalRef,
            requested_at: "2026-08-06T00:00:02Z",
            allow_always: childAllowsAlways,
          },
        },
      ],
    });

    it("locks Always allow on a task whose policy forbids it", () => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={clientRequest(false)}
          resolution={null}
        />,
      );

      expect(screen.getByText("This device")).toBeInTheDocument();
      expect(
        screen.queryByText(/requires confirmation each time/),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Allow once"));

      expect(
        screen.getByText("Summarize the release notes"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/requires confirmation each time/),
      ).toBeInTheDocument();
    });

    it("saves each standing answer where it lives", async () => {
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
          request={clientRequest(true)}
          resolution={null}
        />,
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      fireEvent.click(screen.getByText("Always allow"));
      fireEvent.click(screen.getByText("Always allow"));

      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: profileQuery({}).queryKey,
        });
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: listMcpServerToolsQuery({
          pathParams: { serverId: "mock_mcp_approval" },
        }).queryKey,
      });
      // The client tool's namespace names no MCP roster.
      expect(invalidate).not.toHaveBeenCalledWith({
        queryKey: listMcpServerToolsQuery({
          pathParams: { serverId: "word" },
        }).queryKey,
      });
    });
  });

  describe("on a client task's stop", () => {
    // A task that reads through the user's pane asked about a client tool,
    // under a deployment whose MCP policy forbids standing grants.
    const clientTaskRequest = {
      ...delegatedTaskRequest,
      allow_always: false,
      approvals: [
        {
          ...delegatedTaskRequest.approvals[0],
          child: {
            ...childApprovalRef,
            tool_name: "read_document_blocks",
            mcp_server_id: "word",
            input: { part: "intro" },
            preset: "",
            allow_always: true,
            kind: "client_tool" as const,
          },
        },
      ],
    };

    it("names this device, without the MCP warning, and offers Always allow", () => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={clientTaskRequest}
          resolution={null}
        />,
      );

      const item = screen.getByTestId("delegated-task-approval-item");
      expect(item).toHaveTextContent("read_document_blocks");
      expect(item).toHaveTextContent("This device");
      expect(item).not.toHaveTextContent("word");
      expect(
        screen.queryByText("This tool may send data to an external service."),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/requires confirmation each time/),
      ).not.toBeInTheDocument();
    });

    it("saves its standing answer as the user's client tool preference", async () => {
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
          request={clientTaskRequest}
          resolution={null}
        />,
      );
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");

      fireEvent.click(screen.getByText("Always allow"));

      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: profileQuery({}).queryKey,
        });
      });
      expect(invalidate).not.toHaveBeenCalledWith({
        queryKey: listMcpServerToolsQuery({
          pathParams: { serverId: "word" },
        }).queryKey,
      });
      expect(invalidate).not.toHaveBeenCalledWith({
        queryKey: listUserToolApprovalSettingsQuery({}).queryKey,
      });
    });
  });
});

describe("tasks waiting on the device", () => {
  const waitingItem = (approvalId: string, task: string) => ({
    approval_id: approvalId,
    tool_call_id: approvalId,
    tool_name: "delegate_task",
    input: { task },
    child: {
      ...childApprovalRef,
      child_chat_id: `child-${approvalId}`,
      tool_name: "fetch_availability",
      mcp_server_id: "outlook",
      kind: "client_tool" as const,
      waiting_for: { host_context: "outlook_mailbox", attempt_id: "attempt" },
    },
  });
  const asking = {
    approval_id: "task-ask",
    tool_call_id: "task-ask",
    tool_name: "delegate_task",
    input: { task: "Publish the notes" },
    child: { ...childApprovalRef, child_chat_id: "child-ask" },
  };
  const askingTwo = {
    ...asking,
    approval_id: "task-ask-2",
    tool_call_id: "task-ask-2",
    input: { task: "Publish the summary" },
    child: { ...childApprovalRef, child_chat_id: "child-ask-2" },
  };
  const waits = waitingItem("task-wait", "Check the calendar");
  const mixedStop = {
    ...delegatedTaskRequest,
    approvals: [asking, askingTwo, waits],
  };
  const waitingStop = { ...delegatedTaskRequest, approvals: [waits] };
  const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
    JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body) as {
      decisions?: { approval_id: string; decision: string }[];
    };

  it("lists a waiting task with its host and no decision", () => {
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={waitingStop}
          openItems={[]}
          waitingItems={[waits]}
          resolution={null}
        />,
      ),
    );

    expect(
      screen.getByText("This response is waiting on a task"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("It continues on its own once the task finishes."),
    ).toBeInTheDocument();
    const item = screen.getByTestId("waiting-task-item");
    expect(item).toHaveAttribute("data-child-chat-id", "child-task-wait");
    expect(item).toHaveTextContent("Check the calendar");
    expect(item).toHaveTextContent("Waiting for Outlook on this device");
    expect(screen.queryByRole("button", { name: /Allow/ })).toBeNull();
    expect(screen.queryByTestId("approval-queue-bulk")).toBeNull();
  });

  it("holds the queue as waiting only and seeds no action required", () => {
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={waitingStop}
          openItems={[]}
          waitingItems={[waits]}
          resolution={null}
        />,
      ),
    );

    const ids =
      useConfirmationRegistryStore.getState().pendingIdsByChatId["chat-1"];
    expect(ids).toHaveLength(1);
    expect(
      useConfirmationRegistryStore.getState().waitingOnlyIds[ids?.[0] ?? ""],
    ).toBe(true);
    expect(
      useGenerationStatusStore.getState().statusByChatId["chat-1"],
    ).toBeUndefined();
  });

  it("reads the row again while a task waits", () => {
    vi.useFakeTimers();
    try {
      const refetchMessages = vi.fn(async () => undefined);
      renderCard(
        withChatContext(
          <McpToolApprovalCard
            messageId="message-1"
            request={waitingStop}
            openItems={[]}
            waitingItems={[waits]}
            resolution={null}
          />,
          "chat-1",
          { refetchMessages },
        ),
      );
      act(() => {
        vi.advanceTimersByTime(4_999);
      });
      expect(refetchMessages).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(refetchMessages).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the decisions once the asking tasks are answered, while a task still waits", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={mixedStop}
        openItems={[asking, askingTwo]}
        waitingItems={[waits]}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-item-count",
      "2",
    );
    expect(screen.getByText("Also waiting on a task")).toBeInTheDocument();
    expect(screen.getByTestId("waiting-task-item")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(sentBody(fetchMock).decisions).toEqual([
      { approval_id: "task-ask", decision: "approve" },
      { approval_id: "task-ask-2", decision: "approve" },
    ]);
  });

  it("keeps the answers given and asks only the new question when a waiting task stopped on one", async () => {
    const mismatch = JSON.stringify({
      code: "decisions_mismatch",
      missing: ["task-wait"],
      unknown: [],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(mismatch, { status: 400 }))
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refetchMessages = vi.fn(async () => undefined);
    const card = (props: {
      openItems: (typeof asking)[];
      waitingItems: (typeof waits)[];
    }) =>
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={mixedStop}
          resolution={null}
          {...props}
        />,
        "chat-1",
        { refetchMessages },
      );
    const { rerender } = renderCard(
      card({ openItems: [asking, askingTwo], waitingItems: [waits] }),
    );

    fireEvent.click(screen.getByText("Allow once"));
    fireEvent.click(screen.getByText("Allow once"));
    await waitFor(() => expect(refetchMessages).toHaveBeenCalled());
    expect(screen.queryByText(/decisions_mismatch/)).toBeNull();

    // The refetched row: the waiting task became an ordinary child approval.
    const converted = {
      ...waits,
      child: { ...waits.child, waiting_for: undefined },
    };
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        {card({ openItems: [asking, askingTwo, converted], waitingItems: [] })}
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("approval-queue")).toHaveAttribute(
      "data-position",
      "3",
    );
    expect(screen.getByText("Check the calendar")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Allow once"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(sentBody(fetchMock, 1).decisions).toEqual([
      { approval_id: "task-ask", decision: "approve" },
      { approval_id: "task-ask-2", decision: "approve" },
      { approval_id: "task-wait", decision: "approve" },
    ]);
  });

  it("names a single answer while a task waits, so a question it turned into comes back", async () => {
    const mismatch = JSON.stringify({
      code: "decisions_mismatch",
      missing: ["task-wait"],
      unknown: [],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(mismatch, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const refetchMessages = vi.fn(async () => undefined);
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={{ ...delegatedTaskRequest, approvals: [asking, waits] }}
          openItems={[asking]}
          waitingItems={[waits]}
          resolution={null}
        />,
        "chat-1",
        { refetchMessages },
      ),
    );

    fireEvent.click(screen.getByText("Allow once"));

    await waitFor(() => expect(refetchMessages).toHaveBeenCalled());
    expect(sentBody(fetchMock).decisions).toEqual([
      { approval_id: "task-ask", decision: "approve" },
    ]);
    expect(screen.queryByText(/decisions_mismatch/)).toBeNull();
  });

  it.each(["children_waiting", "generation_running"])(
    "settles silently off the row on a 409 %s",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ code }), { status: 409 }),
          ),
      );
      const refetchMessages = vi.fn(async () => undefined);
      renderCard(
        withChatContext(
          <McpToolApprovalCard
            messageId="message-1"
            request={mixedStop}
            openItems={[asking]}
            waitingItems={[waits]}
            resolution={null}
          />,
          "chat-1",
          { refetchMessages },
        ),
      );

      fireEvent.click(screen.getByText("Allow once"));

      await waitFor(() => expect(refetchMessages).toHaveBeenCalled());
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    },
  );
});

describe("document and response approvals", () => {
  const READ = "read_document_blocks";
  const position = { journal: "journal-1", seq: 41, events: true };
  const binding = {
    device_id: "pane-device-000000",
    realm: "office-addin" as const,
    host_context: { kind: "word_document", identity: "identity-1" },
  };
  const documentScope = {
    host_context: "word_document",
    covers: "document" as const,
    scope_id: "identity-1",
  };

  const scopedTask = (
    index: number,
    scope: ApprovalScope | null = documentScope,
    toolName = READ,
  ) => ({
    approval_id: `task-${index}`,
    tool_call_id: `task-${index}`,
    tool_name: "delegate_task",
    input: { task: `Read chapter ${index}` },
    child: {
      ...childApprovalRef,
      child_chat_id: `child-${index}`,
      child_tool_call_id: `child-call-${index}`,
      tool_name: toolName,
      mcp_server_id: "word",
      input: { part: `chapter-${index}` },
      preset: "",
      allow_always: true,
      kind: "client_tool" as const,
      requested_at: `2026-08-06T00:00:${String(index).padStart(2, "0")}Z`,
      ...(scope ? { approval_scope: scope } : {}),
    },
  });

  const stopOf = (approvals: ReturnType<typeof scopedTask>[]) => ({
    ...delegatedTaskRequest,
    allow_always: false,
    approvals,
  });

  const anchorPane = () => {
    const take = vi.fn(() => position);
    const cleanup = [
      registerClientToolExecutor(
        READ,
        async () => ({ ok: true, result: null }),
        undefined,
        {
          acceptsGrantCalls: true,
          checksApprovalScope: () => true,
          anchorsApprovalScope: (scope) =>
            scope.hostContext === "word_document" &&
            scope.scopeId === "identity-1"
              ? take
              : undefined,
        },
      ),
      registerOperationExecutor(READ, () => binding, { yields: true }),
    ];
    return { take, cleanup: () => cleanup.forEach((undo) => undo()) };
  };

  const sentRequest = (fetchMock: ReturnType<typeof vi.fn>) => {
    const init = fetchMock.mock.calls[0][1] as {
      body: string;
      headers: Record<string, string>;
    };
    return {
      body: JSON.parse(init.body) as { decisions: unknown[] },
      headers: init.headers,
    };
  };

  afterEach(resetClientToolRegistryForTests);

  it("allows ten tasks for their document with one click and sends one position", async () => {
    const pane = anchorPane();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tasks = Array.from({ length: 10 }, (_, index) =>
      scopedTask(index + 1),
    );
    // Another tool on the same document is its own decision.
    const other = scopedTask(30, documentScope, "read_comments");
    try {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={stopOf([...tasks, other])}
          resolution={null}
        />,
      );

      expect(screen.getByTestId("approval-scope-others")).toHaveTextContent(
        "Also covers 9 other tasks reading this document",
      );
      expect(screen.getByText("Allow this call")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Allow for this document"));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(pane.take).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("approval-queue")).toHaveAttribute(
        "data-position",
        "11",
      );
      expect(screen.getByText("Read chapter 30")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Deny once"));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const { body, headers } = sentRequest(fetchMock);
      expect(body.decisions).toEqual([
        ...tasks.map((task) => ({
          approval_id: task.approval_id,
          decision: "approve_context",
          scope_position: position,
        })),
        { approval_id: "task-30", decision: "reject" },
      ]);
      expect(headers["X-Erato-Executor"]).toBe(JSON.stringify(binding));
    } finally {
      pane.cleanup();
    }
  });

  it("keeps the position already held when a waiting task joins the document", async () => {
    const pane = anchorPane();
    pane.take
      .mockReturnValueOnce(position)
      .mockReturnValue({ ...position, seq: 42 });
    const mismatch = JSON.stringify({
      code: "decisions_mismatch",
      missing: ["task-3"],
      unknown: [],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(mismatch, { status: 400 }))
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const refetchMessages = vi.fn(async () => undefined);
    const unscoped = scopedTask(3, null);
    const waiting = {
      ...unscoped,
      child: {
        ...unscoped.child,
        waiting_for: { host_context: "word_document", attempt_id: "attempt" },
      },
    };
    const card = (
      openItems: ReturnType<typeof scopedTask>[],
      waitingItems: (typeof waiting)[],
    ) =>
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={stopOf([scopedTask(1), scopedTask(2), waiting])}
          openItems={openItems}
          waitingItems={waitingItems}
          resolution={null}
        />,
        "chat-1",
        { refetchMessages },
      );
    try {
      const { rerender } = renderCard(
        card([scopedTask(1), scopedTask(2)], [waiting]),
      );
      fireEvent.click(screen.getByText("Allow for this document"));
      await waitFor(() => expect(refetchMessages).toHaveBeenCalled());

      rerender(
        <QueryClientProvider client={new QueryClient()}>
          {card([scopedTask(1), scopedTask(2), scopedTask(3)], [])}
        </QueryClientProvider>,
      );
      expect(screen.getByText("Read chapter 3")).toBeInTheDocument();
      fireEvent.click(screen.getByText("Allow for this document"));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const sent = JSON.parse(
        (fetchMock.mock.calls[1][1] as { body: string }).body,
      ) as { decisions: unknown[] };
      expect(sent.decisions).toEqual(
        [1, 2, 3].map((index) => ({
          approval_id: `task-${index}`,
          decision: "approve_context",
          scope_position: position,
        })),
      );
      expect(pane.take).toHaveBeenCalledTimes(1);
    } finally {
      pane.cleanup();
    }
  });

  it("holds a document approval on the last item while the stop is sent", async () => {
    const pane = anchorPane();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    try {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={stopOf([scopedTask(1)])}
          resolution={null}
        />,
      );

      expect(
        screen.queryByTestId("approval-scope-others"),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByText("Allow for this document"));

      expect(
        screen.getByTestId("delegated-task-approval-item-card"),
      ).toHaveTextContent(
        "Allowed for this document. Sent once every item is decided.",
      );
    } finally {
      pane.cleanup();
    }
  });

  it("offers a document only in the pane that has it open, and says so", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={stopOf([scopedTask(1), scopedTask(2)])}
        resolution={null}
      />,
    );

    expect(
      screen.queryByText("Allow for this document"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByTestId("approval-scope-elsewhere")).toHaveTextContent(
      "To allow the whole document, decide in the pane that has it open.",
    );
  });

  it("offers no document scope for another pane's document", () => {
    const pane = anchorPane();
    try {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={stopOf([
            scopedTask(1, { ...documentScope, scope_id: "identity-2" }),
          ])}
          resolution={null}
        />,
      );

      expect(
        screen.queryByText("Allow for this document"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("approval-scope-elsewhere")).toBeVisible();
    } finally {
      pane.cleanup();
    }
  });

  it("allows a response from any client, without a position", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const turnScope = {
      host_context: "outlook_mailbox",
      covers: "turn" as const,
      scope_id: "parent-message",
    };
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={stopOf([
          scopedTask(1, turnScope, "fetch_availability"),
          scopedTask(2, turnScope, "fetch_availability"),
        ])}
        resolution={null}
      />,
    );

    expect(screen.getByTestId("approval-scope-others")).toHaveTextContent(
      "Also covers 1 other task of this response",
    );
    expect(
      screen.getByText(
        "Tasks of this response use this tool without asking again until the response is done.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Allow for this response"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentRequest(fetchMock).body.decisions).toEqual([
      { approval_id: "task-1", decision: "approve_context" },
      { approval_id: "task-2", decision: "approve_context" },
    ]);
  });

  it("says the document changed when it asks again after an outside change", () => {
    const pane = anchorPane();
    try {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={stopOf([scopedTask(1, { ...documentScope, changed: true })])}
          resolution={null}
        />,
      );

      expect(screen.getByTestId("approval-scope-changed")).toHaveTextContent(
        "The document changed since you allowed it.",
      );
      expect(screen.getByText("Allow for this document")).toBeInTheDocument();
    } finally {
      pane.cleanup();
    }
  });

  it("offers no scope on the turn's own call or a task's own card", () => {
    const pane = anchorPane();
    try {
      // A task's own card carries the scope its gate asked with, but only the
      // parent's card may allow it.
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          request={{
            ...approvalRequest,
            tool_name: READ,
            mcp_server_id: "word",
            kind: "client_tool" as const,
            approval_scope: documentScope,
          }}
          resolution={null}
        />,
      );

      expect(screen.getByText("Allow once")).toBeInTheDocument();
      expect(
        screen.queryByText("Allow for this document"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("approval-scope-elsewhere"),
      ).not.toBeInTheDocument();
    } finally {
      pane.cleanup();
    }
  });
});

describe("gist cards", () => {
  /** The readable view the backend sends for an input, member by member. */
  const viewOf = (value: unknown, path = ""): ToolArgumentNode =>
    Array.isArray(value)
      ? {
          path,
          kind: "list",
          children: value.map((entry, index) =>
            viewOf(entry, `${path}/${index}`),
          ),
        }
      : typeof value === "object" && value !== null
        ? {
            path,
            kind: "group",
            children: Object.entries(value).map(([name, member]) =>
              viewOf(
                member,
                `${path}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`,
              ),
            ),
          }
        : { path, kind: "value" };

  const DATA_SOURCE_ID = "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b";
  const createRowInput = {
    parent: { data_source_id: DATA_SOURCE_ID },
    pages: [{ properties: { Name: "Northwind", Status: "Lead" } }],
  };
  const createRowLabel = {
    action: "create" as const,
    object_kind: "row" as const,
    source: "rules" as const,
    arguments: viewOf(createRowInput),
    items: [
      {
        title: {
          pointer: "/pages/*/properties/Name",
          values: [{ path: "/pages/0/properties/Name", text: "Northwind" }],
        },
        target: {
          pointer: "/parent/data_source_id",
          values: [
            {
              path: "/parent/data_source_id",
              text: DATA_SOURCE_ID,
              resolved: "Companies",
            },
          ],
        },
        fields: [
          {
            pointer: "/pages/*/properties/Status",
            name: "Status",
            values: [{ path: "/pages/0/properties/Status", text: "Lead" }],
          },
        ],
      },
    ],
  };
  const createRowDisplay = {
    title: "Create pages",
    description: "Creates pages in a data source.",
    description_truncated: false,
    server_name: "Records",
    label: createRowLabel,
  };
  const gistRequest = {
    ...approvalRequest,
    tool_name: "create_pages",
    mcp_server_id: "records",
    input: createRowInput,
    display: createRowDisplay,
  };

  const openTechnicalDetails = (within: HTMLElement = document.body) =>
    fireEvent.click(
      Array.from(within.querySelectorAll("button")).find(
        (button) => button.textContent === "Technical details",
      )!,
    );

  it("reads a labelled call as one line with its key values and keeps the raw call one click away", async () => {
    const continueToolApproval = vi.fn().mockResolvedValue(undefined);
    renderCard(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={gistRequest}
          resolution={null}
        />,
        "chat-1",
        { continueToolApproval },
      ),
    );

    const line = screen.getByTestId("tool-call-gist-line");
    expect(line).toHaveTextContent("Create row Northwind in Companies");
    const written = line.querySelector('[data-origin="written"]');
    expect(written?.tagName).toBe("Q");
    expect(written).toHaveAttribute("dir", "auto");
    const resolved = line.querySelector('[data-origin="resolved"]');
    expect(resolved).toHaveTextContent("Companies");
    expect(resolved).toHaveAttribute(
      "title",
      "Name from an earlier result in this chat",
    );
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Lead")).toBeInTheDocument();
    expect(screen.getByText("Records")).toBeInTheDocument();
    expect(screen.queryByText("Input Parameters")).not.toBeInTheDocument();
    expect(screen.queryByText("create_pages")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Creates pages in a data source."),
    ).not.toBeInTheDocument();

    openTechnicalDetails();
    expect(screen.getByText("create_pages")).toBeInTheDocument();
    expect(screen.getByText("records")).toBeInTheDocument();
    expect(
      screen.getByText("Creates pages in a data source."),
    ).toBeInTheDocument();
    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    expect(screen.getByText(`"${DATA_SOURCE_ID}"`)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    await waitFor(() =>
      expect(continueToolApproval).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "create_pages",
          mcpServerId: "records",
          toolInput: createRowInput,
        }),
      ),
    );
  });

  it("shows an ID no earlier result named whole, apart from text as written", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...gistRequest,
          display: {
            ...createRowDisplay,
            label: {
              ...createRowLabel,
              items: [
                {
                  ...createRowLabel.items[0],
                  target: {
                    pointer: "/parent/data_source_id",
                    values: [
                      { path: "/parent/data_source_id", text: DATA_SOURCE_ID },
                    ],
                  },
                },
              ],
            },
          },
        }}
      />,
    );

    const id = screen
      .getByTestId("tool-call-gist-line")
      .querySelector('[data-origin="id"]');
    expect(id?.textContent).toBe(DATA_SOURCE_ID);
    expect(id).not.toHaveAttribute("title");
    expect(id).toHaveClass("font-mono");
  });

  describe("IDs that start alike", () => {
    const FIRST = "9b1d5f2e-3c4a-4f88-a1b2-0c1d2e3f4a5b";
    const SECOND = "9b1d5f2e-77d0-4e19-9c3b-5f6a7b8c9d0e";
    const deleteRows = (resolved?: string) => {
      const input = { ids: [FIRST, SECOND] };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            tool_name: "delete_rows",
            input,
            display: {
              ...createRowDisplay,
              label: {
                action: "delete",
                object_kind: "row",
                source: "rules",
                arguments: viewOf(input),
                items: [
                  {
                    id: {
                      pointer: "/ids/*",
                      values: [FIRST, SECOND].map((text, index) => ({
                        path: `/ids/${index}`,
                        text,
                        resolved,
                      })),
                    },
                  },
                ],
              },
            },
          }}
        />,
      );
    };
    const rowTexts = () =>
      Array.from(
        screen.getByTestId("tool-call-gist-rows").querySelectorAll("li"),
        (row) => row.textContent,
      );

    it("shows each ID of a batch whole, so the rows differ", () => {
      deleteRows();

      expect(rowTexts()).toEqual([FIRST, SECOND]);
      expect(
        screen.queryByTestId("tool-call-other-arguments"),
      ).not.toBeInTheDocument();
    });

    it("puts each whole ID beside the one name both resolved to", () => {
      deleteRows("Northwind");

      expect(rowTexts()).toEqual([
        `Northwind written as <${FIRST}>`,
        `Northwind written as <${SECOND}>`,
      ]);
      for (const written of screen.getAllByTestId("tool-call-gist-written")) {
        expect(written.querySelector(".font-mono")).not.toHaveAttribute(
          "title",
        );
      }
    });

    it("shows a field's IDs whole", () => {
      const input = {
        recordId: "r1",
        owner_id: FIRST,
        reviewer_id: SECOND,
      };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            tool_name: "update_row",
            input,
            display: {
              ...createRowDisplay,
              label: {
                action: "update",
                object_kind: "row",
                source: "rules",
                arguments: viewOf(input),
                items: [
                  {
                    id: {
                      pointer: "/recordId",
                      values: [
                        { path: "/recordId", text: "r1", resolved: "Acme" },
                      ],
                    },
                    fields: ["owner_id", "reviewer_id"].map((name) => ({
                      pointer: `/${name}`,
                      name,
                      values: [
                        {
                          path: `/${name}`,
                          text: input[name as "owner_id" | "reviewer_id"],
                        },
                      ],
                    })),
                  },
                ],
              },
            },
          }}
        />,
      );

      const ids = Array.from(
        screen
          .getByTestId("tool-call-gist-values")
          .querySelectorAll('[data-origin="id"]'),
        (id) => id.textContent,
      );
      expect(ids).toEqual([FIRST, SECOND]);
    });

    it("shows IDs whole on the generic card", () => {
      const input = { source_id: FIRST, target_id: SECOND };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            tool_name: "link_records",
            input,
            display: {
              ...createRowDisplay,
              label: {
                action: "other",
                object_kind: "other",
                source: "generic",
                arguments: {
                  path: "",
                  kind: "group",
                  children: [
                    { path: "/source_id", kind: "id" },
                    { path: "/target_id", kind: "id" },
                  ],
                },
              },
            },
          }}
        />,
      );

      const values = Array.from(
        screen.getByTestId("tool-argument-view").querySelectorAll("dd"),
        (value) => value.textContent,
      );
      expect(values).toEqual([FIRST, SECOND]);
      expect(
        screen.getByTestId("tool-argument-view").querySelector(".font-mono"),
      ).not.toHaveAttribute("title");
    });
  });

  describe("a 4,000-character ID", () => {
    const LONG_ID = `${"a1b2c3d4".repeat(499)}tail0001`;
    const OTHER_ID = `${"a1b2c3d4".repeat(499)}tail0002`;
    const cardWith = (input: unknown, label: unknown) =>
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            input,
            display: {
              ...createRowDisplay,
              label: label as typeof createRowLabel,
            },
          }}
        />,
      );
    const createIn = (resolved?: string) => {
      const input = { ...createRowInput, parent: { data_source_id: LONG_ID } };
      cardWith(input, {
        ...createRowLabel,
        arguments: viewOf(input),
        items: [
          {
            ...createRowLabel.items[0],
            target: {
              pointer: "/parent/data_source_id",
              values: [
                { path: "/parent/data_source_id", text: LONG_ID, resolved },
              ],
            },
          },
        ],
      });
    };
    const scrollBoxOf = (node: Element) =>
      node.closest<HTMLElement>(".overflow-y-auto");
    const expectButtons = () => {
      expect(
        screen.getByRole("button", { name: "Allow once" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Deny once" }),
      ).toBeInTheDocument();
    };

    it("shows it whole in the line, which scrolls in a box of its own", () => {
      createIn();

      const line = screen.getByTestId("tool-call-gist-line");
      const id = line.querySelector('[data-origin="id"]')!;
      expect(id.textContent).toBe(LONG_ID);
      expect(scrollBoxOf(id)).toBe(line);
      expect(line).toHaveClass("max-h-32");
      expectButtons();
    });

    it("shows it whole beside a resolved name, inside the line's box", () => {
      createIn("Companies");

      const line = screen.getByTestId("tool-call-gist-line");
      const id = within(line)
        .getByTestId("tool-call-gist-written")
        .querySelector(".font-mono")!;
      expect(id.textContent).toBe(LONG_ID);
      expect(scrollBoxOf(id)).toBe(line);
      expectButtons();
    });

    it("shows each in a batch whole, every row in a box of its own", () => {
      const input = { ids: [LONG_ID, OTHER_ID] };
      cardWith(input, {
        action: "delete",
        object_kind: "row",
        source: "rules",
        arguments: viewOf(input),
        items: [
          {
            id: {
              pointer: "/ids/*",
              values: input.ids.map((text, index) => ({
                path: `/ids/${index}`,
                text,
              })),
            },
          },
        ],
      });

      const rows = Array.from(
        screen.getByTestId("tool-call-gist-rows").querySelectorAll("li"),
      );
      expect(rows.map((row) => row.textContent)).toEqual([LONG_ID, OTHER_ID]);
      for (const row of rows) {
        const box = scrollBoxOf(row.querySelector('[data-origin="id"]')!);
        expect(row).toContainElement(box);
        expect(box).toHaveClass("max-h-24");
      }
      expectButtons();
    });

    it("shows it whole in a field, whose value scrolls in a box of its own", () => {
      const input = { recordId: "r1", owner_id: LONG_ID };
      cardWith(input, {
        action: "update",
        object_kind: "row",
        source: "rules",
        arguments: viewOf(input),
        items: [
          {
            id: {
              pointer: "/recordId",
              values: [{ path: "/recordId", text: "r1", resolved: "Acme" }],
            },
            fields: [
              {
                pointer: "/owner_id",
                name: "owner_id",
                values: [{ path: "/owner_id", text: LONG_ID }],
              },
            ],
          },
        ],
      });

      const id = screen
        .getByTestId("tool-call-gist-values")
        .querySelector('[data-origin="id"]')!;
      expect(id.textContent).toBe(LONG_ID);
      const box = scrollBoxOf(id);
      expect(box?.tagName).toBe("DD");
      expect(box).toHaveClass("max-h-24");
      expectButtons();
    });
  });

  it("lines a batch's fields up only under the names' own arrays, and lists the rest once", () => {
    const field = (pointer: string, values: [string, string][]) => ({
      pointer,
      values: values.map(([path, text]) => ({ path, text })),
    });
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...gistRequest,
          display: {
            ...createRowDisplay,
            label: {
              action: "update",
              object_kind: "paragraph",
              source: "rules",
              items: [
                {
                  id: field("/entries/*/source/*/id", [
                    ["/entries/0/source/0/id", "p-1"],
                    ["/entries/0/source/1/id", "p-2"],
                    ["/entries/1/source/0/id", "p-3"],
                  ]),
                  fields: [
                    field("/entries/*/source/*/tags/*", [
                      ["/entries/0/source/1/tags/0", "legal"],
                    ]),
                    field("/entries/*/kind", [
                      ["/entries/0/kind", "replace"],
                      ["/entries/1/kind", "keep"],
                    ]),
                    field("/deleted/*/source/*", [
                      ["/deleted/0/source/0", "d-17"],
                      ["/deleted/0/source/1", "d-18"],
                    ]),
                    field("/other/*/x", [
                      ["/other/0/x", "alpha"],
                      ["/other/1/x", "beta"],
                    ]),
                  ],
                },
              ],
            },
          },
        }}
      />,
    );

    const rows = Array.from(
      screen.getByTestId("tool-call-gist-rows").querySelectorAll("li"),
    );
    expect(rows.map((row) => row.textContent)).toEqual([
      "p-1",
      "p-2tagslegal",
      "p-3",
    ]);
    const values = screen.getByTestId("tool-call-gist-values");
    for (const text of ["replace", "keep", "d-17", "d-18", "alpha", "beta"]) {
      expect(values).toHaveTextContent(text);
    }
  });

  it("warns when the call shares what it creates with the workspace, past the label's fields", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...gistRequest,
          input: {
            title: "Hiring",
            description: "Open roles",
            color: "blue",
            icon: "briefcase",
            parent: "root",
            visibility: "workspace",
          },
          display: {
            ...createRowDisplay,
            label: {
              action: "create",
              object_kind: "folder",
              source: "rules",
              items: [
                {
                  title: {
                    pointer: "/title",
                    values: [{ path: "/title", text: "Hiring" }],
                  },
                  fields: ["description", "color", "icon", "parent"].map(
                    (name) => ({
                      pointer: `/${name}`,
                      name,
                      values: [{ path: `/${name}`, text: name }],
                    }),
                  ),
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
      "Create folder Hiring",
    );
    expect(
      screen.getByText(
        "Shared with your workspace: everyone in it can see this.",
      ),
    ).toBeInTheDocument();
  });

  it("shows a generic label's arguments as names and values, as inert text", () => {
    const input = {
      channel: "release",
      "a/b": "escaped name",
      hasUserApproved: true,
      note: "[notes](https://example.com) <b>raw</b>\u202E",
    };
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...approvalRequest,
          input,
          display: {
            title: "Publish approval demo",
            description_truncated: false,
            server_name: "Approval Probe",
            label: {
              action: "other",
              object_kind: "other",
              source: "generic",
              arguments: {
                path: "",
                kind: "group",
                children: [
                  { path: "/channel", kind: "value" },
                  { path: "/a~1b", kind: "value" },
                  { path: "/hasUserApproved", kind: "value" },
                  { path: "/note", kind: "value" },
                ],
                omitted: 2,
              },
              warnings: ["arguments_truncated"],
            },
          },
        }}
      />,
    );

    const view = screen.getByTestId("tool-argument-view");
    expect(view).toHaveTextContent("channel");
    expect(view).toHaveTextContent("release");
    expect(view).toHaveTextContent("a/b");
    expect(view).not.toHaveTextContent("hasUserApproved");
    expect(view).toHaveTextContent("2 more not shown");
    const note = screen.getByText("[notes](https://example.com) <b>raw</b>");
    expect(note).toHaveAttribute("dir", "auto");
    expect(
      screen.queryByRole("link", { name: "notes" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Publish approval demo")).toBeInTheDocument();
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
    expect(screen.getByText("Approval Probe")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Some arguments are not shown here. Technical details has all of them.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Input Parameters")).not.toBeInTheDocument();

    openTechnicalDetails();
    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    expect(screen.getByText("hasUserApproved")).toBeInTheDocument();
  });

  it("shows the raw input once for a label without a readable view", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...approvalRequest,
          display: {
            title: "Publish approval demo",
            description_truncated: false,
            server_name: "Approval Probe",
            label: { action: "other", object_kind: "other", source: "rules" },
          },
        }}
      />,
    );

    expect(screen.getAllByText("Input Parameters")).toHaveLength(1);
    expect(screen.queryByTestId("tool-argument-view")).not.toBeInTheDocument();
    openTechnicalDetails();
    expect(screen.getAllByText("Input Parameters")).toHaveLength(1);
    expect(screen.getByTestId("tool-call-identity")).toHaveTextContent(
      "publish_approval_probe",
    );
  });

  it("renders a request saved before labels exactly as before", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        request={{
          ...approvalRequest,
          display: {
            title: "Publish approval demo",
            description_truncated: false,
            server_name: "Approval Probe",
          },
        }}
        resolution={null}
      />,
    );

    expect(screen.getByText("Input Parameters")).toBeInTheDocument();
    expect(screen.getByText(/"release"/)).toBeInTheDocument();
    expect(screen.queryByTestId("tool-call-gist")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("approval-technical-details"),
    ).not.toBeInTheDocument();
  });

  it("reads a parked child's labelled call as its gist under the task", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...delegatedTaskRequest,
          approvals: [
            {
              ...delegatedTaskRequest.approvals[0],
              child: {
                ...childApprovalRef,
                tool_name: "create_pages",
                mcp_server_id: "records",
                input: createRowInput,
                display: createRowDisplay,
              },
            },
          ],
        }}
      />,
    );

    const item = screen.getByTestId("delegated-task-approval-item");
    expect(item).toHaveTextContent("Summarize the release notes");
    expect(
      item.querySelector('[data-testid="tool-call-gist-line"]'),
    ).toHaveTextContent("Create row Northwind in Companies");
    expect(item).not.toHaveTextContent("Input Parameters");
    openTechnicalDetails(item);
    expect(item).toHaveTextContent("create_pages");
    expect(item).toHaveTextContent("Input Parameters");
  });

  it("reads the turn's own call in a queue by the label on its item", () => {
    renderCard(
      <McpToolApprovalCard
        messageId="message-1"
        resolution={null}
        request={{
          ...gistRequest,
          kind: "mcp_tool" as const,
          requested_at: "2026-08-06T00:00:00Z",
          approvals: [
            {
              approval_id: "tool-call-1",
              tool_call_id: "tool-call-1",
              tool_name: "create_pages",
              input: createRowInput,
              display: createRowDisplay,
              child: null,
            },
            {
              approval_id: "task-a",
              tool_call_id: "task-a",
              tool_name: "delegate_task",
              input: { task: "Summarize the release notes" },
              child: {
                ...childApprovalRef,
                requested_at: "2026-08-06T00:00:09Z",
              },
            },
          ],
        }}
      />,
    );

    const item = screen.getByTestId("mcp-tool-approval-item");
    expect(item).toHaveAttribute("data-tool-name", "create_pages");
    expect(
      item.querySelector('[data-testid="tool-call-gist-line"]'),
    ).toHaveTextContent("Create row Northwind in Companies");
  });

  describe("arguments the summary does not show", () => {
    const emailInput = {
      to: ["ana@example.com"],
      bcc: ["leak@example.net"],
      subject: "Q3 numbers",
      body: "Attached.",
    };
    const sendEmailLabel = {
      action: "send" as const,
      object_kind: "email" as const,
      source: "model" as const,
      arguments: viewOf(emailInput),
      items: [
        {
          title: {
            pointer: "/subject",
            values: [{ path: "/subject", text: "Q3 numbers" }],
          },
          target: {
            pointer: "/to/*",
            values: [{ path: "/to/0", text: "ana@example.com" }],
          },
          after: {
            pointer: "/body",
            values: [{ path: "/body", text: "Attached." }],
          },
        },
      ],
    };
    const emailRequest = {
      ...approvalRequest,
      tool_name: "send_email",
      mcp_server_id: "mail",
      input: emailInput,
      display: {
        title: "Send email",
        description_truncated: false,
        server_name: "Mail",
        label: sendEmailLabel,
      },
    };

    const otherArguments = () =>
      screen.queryByTestId("tool-call-other-arguments");

    /** Whether `node` comes before the card's first decision button. */
    const isAboveButtons = (node: HTMLElement) =>
      Boolean(
        node.compareDocumentPosition(
          screen.getByRole("button", { name: "Allow once" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      );

    it("lists a bcc the summary leaves out under the gist, above the buttons and without a click", () => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={emailRequest}
        />,
      );

      expect(screen.getByTestId("tool-call-gist-line")).toHaveTextContent(
        "Send email Q3 numbers to ana@example.com",
      );
      const rest = otherArguments()!;
      expect(rest).toHaveTextContent("Other arguments");
      expect(rest).toHaveTextContent("bcc");
      expect(rest).toHaveTextContent("leak@example.net");
      expect(rest).not.toHaveTextContent("subject");
      expect(rest).not.toHaveTextContent("ana@example.com");
      expect(rest).not.toHaveTextContent("Attached.");
      expect(isAboveButtons(rest)).toBe(true);
      expect(rest.closest('div[style*="0fr"]')).toBeNull();
    });

    it("lists recipients past the values a field shows, arrays included", () => {
      const input = {
        subject: "Offsite",
        to: ["a@x.example"],
        cc: ["b@x.example", "c@x.example", "d@x.example", "e@x.example"],
      };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...emailRequest,
            input,
            display: {
              ...emailRequest.display,
              label: {
                ...sendEmailLabel,
                arguments: viewOf(input),
                items: [
                  {
                    title: sendEmailLabel.items[0].title,
                    target: {
                      pointer: "/to/*",
                      values: [{ path: "/to/0", text: "a@x.example" }],
                    },
                    fields: [
                      {
                        pointer: "/cc/*",
                        name: "cc",
                        values: input.cc.map((text, index) => ({
                          path: `/cc/${index}`,
                          text,
                        })),
                      },
                    ],
                  },
                ],
              },
            },
          }}
        />,
      );

      const rest = otherArguments()!;
      expect(rest).toHaveTextContent("e@x.example");
      expect(rest).not.toHaveTextContent("b@x.example");
      expect(rest.querySelector("ul")).not.toBeNull();
    });

    it("shows no list when the summary shows every argument", () => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={gistRequest}
        />,
      );

      expect(screen.getByTestId("tool-call-gist")).toBeInTheDocument();
      expect(otherArguments()).toBeNull();
    });

    it("keeps every argument in view when a generic card turns into a gist", async () => {
      const continueToolApproval = vi.fn().mockResolvedValue(undefined);
      const card = (label: unknown) =>
        withChatContext(
          <McpToolApprovalCard
            messageId="message-1"
            resolution={null}
            request={{
              ...emailRequest,
              display: {
                ...emailRequest.display,
                label: label as typeof sendEmailLabel,
              },
            }}
          />,
          "chat-1",
          { continueToolApproval },
        );
      const { rerender, queryClient } = renderCard(
        card({
          action: "other",
          object_kind: "other",
          source: "generic",
          arguments: viewOf(emailInput),
        }),
      );
      expect(screen.getByTestId("tool-argument-view")).toHaveTextContent(
        "leak@example.net",
      );

      rerender(
        <QueryClientProvider client={queryClient}>
          {card(sendEmailLabel)}
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("tool-call-gist-line")).toBeInTheDocument();
      expect(otherArguments()).toHaveTextContent("leak@example.net");
      fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
      await waitFor(() =>
        expect(continueToolApproval).toHaveBeenCalledWith(
          expect.objectContaining({ toolInput: emailInput }),
        ),
      );
    });

    it("shows the raw arguments under a gist whose label has no readable view", () => {
      const { arguments: _view, ...withoutView } = sendEmailLabel;
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...emailRequest,
            display: { ...emailRequest.display, label: withoutView },
          }}
        />,
      );

      expect(screen.getByTestId("tool-call-gist-line")).toBeInTheDocument();
      expect(screen.getAllByText("Input Parameters")).toHaveLength(1);
      expect(screen.getByText(/leak@example\.net/)).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Technical details" }),
      );
      expect(screen.getAllByText("Input Parameters")).toHaveLength(1);
    });

    it("never shows a consent flag as a key value or another argument", () => {
      const input = { ...emailInput, bcc: [], hasUserApproved: true };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...emailRequest,
            input,
            display: {
              ...emailRequest.display,
              label: {
                ...sendEmailLabel,
                arguments: viewOf(input),
                items: [
                  {
                    ...sendEmailLabel.items[0],
                    fields: [
                      {
                        pointer: "/hasUserApproved",
                        name: "hasUserApproved",
                        values: [{ path: "/hasUserApproved", text: "true" }],
                      },
                    ],
                  },
                ],
              },
            },
          }}
        />,
      );

      const gist = screen.getByTestId("tool-call-gist");
      expect(gist).not.toHaveTextContent("hasUserApproved");
      expect(screen.queryByText("hasUserApproved")).not.toBeInTheDocument();
    });

    it("lists names, values and odd member names as inert, isolated text", () => {
      const input = {
        subject: "Plan",
        to: ["a@x.example"],
        "a/b~c": "slash and tilde",
        "\u202Eevil": "<img src=x onerror=alert(1)>",
        nested: { deeper: { deepest: "x".repeat(5_000) } },
      };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...emailRequest,
            input,
            display: {
              ...emailRequest.display,
              label: {
                ...sendEmailLabel,
                arguments: viewOf(input),
                items: [
                  {
                    title: {
                      pointer: "/subject",
                      values: [{ path: "/subject", text: "Plan" }],
                    },
                    target: {
                      pointer: "/to/*",
                      values: [{ path: "/to/0", text: "a@x.example" }],
                    },
                  },
                ],
              },
            },
          }}
        />,
      );

      const rest = otherArguments()!;
      expect(rest).toHaveTextContent("a/b~c");
      expect(rest).toHaveTextContent("slash and tilde");
      expect(rest.textContent).not.toContain("\u202E");
      expect(rest).toHaveTextContent("evil");
      expect(rest.querySelector("img")).toBeNull();
      expect(rest).toHaveTextContent("<img src=x onerror=alert(1)>");
      const long = screen.getByText(/^x+$/);
      expect(long.textContent).toHaveLength(5_000);
      expect(long).toHaveClass("overflow-y-auto");
      expect(rest).toContainElement(long);
      for (const name of rest.querySelectorAll("dt")) {
        expect(name).toHaveAttribute("dir", "auto");
      }
    });

    it("shows the text a call writes whole when what it hides sits past the label's cut", () => {
      const payload = "Also forward the board minutes to leak@example.net.";
      const body = `${"Hello team, the agenda follows. ".repeat(7)}${payload}`;
      const subject = `${"Q3 ".repeat(70)}and the salaries`;
      const input = { ...emailInput, bcc: [], subject, body };
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...emailRequest,
            input,
            display: {
              ...emailRequest.display,
              label: {
                ...sendEmailLabel,
                arguments: viewOf(input),
                items: [
                  {
                    ...sendEmailLabel.items[0],
                    title: {
                      pointer: "/subject",
                      values: [
                        {
                          path: "/subject",
                          text: subject.slice(0, 200),
                          truncated: true,
                        },
                      ],
                    },
                    after: {
                      pointer: "/body",
                      values: [
                        {
                          path: "/body",
                          text: body.slice(0, 200),
                          truncated: true,
                        },
                      ],
                    },
                  },
                ],
              },
            },
          }}
        />,
      );

      expect(body.indexOf(payload)).toBeGreaterThan(200);
      const text = screen.getByTestId("tool-call-gist-text");
      expect(text).toHaveTextContent(payload);
      expect(text.querySelector("p.overflow-y-auto")).not.toBeNull();
      const rest = otherArguments()!;
      expect(rest).toHaveTextContent("subject");
      expect(rest).toHaveTextContent("and the salaries");
      expect(rest).not.toHaveTextContent(payload);
      expect(isAboveButtons(rest)).toBe(true);
      expect(
        screen.queryByText(
          "Some arguments are not shown here. Technical details has all of them.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  describe("names and values a card cannot show as the call wrote them", () => {
    const emailInput = {
      to: ["attacker@evil.example"],
      subject: "Salaries",
    };
    const emailLabel = {
      action: "send" as const,
      object_kind: "email" as const,
      source: "rules" as const,
      arguments: viewOf(emailInput),
      items: [
        {
          title: {
            pointer: "/subject",
            values: [{ path: "/subject", text: "Salaries" }],
          },
          target: {
            pointer: "/to/*",
            values: [
              {
                path: "/to/0",
                text: "attacker@evil.example",
                resolved: "Alice (Finance)",
              },
            ],
          },
        },
      ],
    };
    const cardFor = (input: unknown, label: unknown) =>
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            tool_name: "send_email",
            input,
            display: {
              ...createRowDisplay,
              label: label as typeof createRowLabel,
            },
          }}
        />,
      );
    const genericLabel = (input: unknown, extra: object = {}) => ({
      action: "other",
      object_kind: "other",
      source: "generic",
      arguments: viewOf(input),
      ...extra,
    });
    const consentNote = () =>
      screen.queryByTestId("tool-call-consent-left-out");
    const hiddenNote = () =>
      screen.queryByTestId("tool-call-hidden-characters");

    it("puts the address the call writes beside a name an earlier result gave it", () => {
      cardFor(emailInput, emailLabel);

      const line = screen.getByTestId("tool-call-gist-line");
      expect(line).toHaveTextContent(
        "Send email Salaries to Alice (Finance) written as <attacker@evil.example>",
      );
      const written = within(line).getByTestId("tool-call-gist-written");
      expect(written).toHaveTextContent("<attacker@evil.example>");
      expect(written.querySelector('[dir="auto"]')).toHaveClass(
        "[unicode-bidi:isolate]",
      );
    });

    it("puts the whole ID the call writes beside a name", () => {
      cardFor(createRowInput, createRowLabel);

      const line = screen.getByTestId("tool-call-gist-line");
      expect(line).toHaveTextContent(
        `in Companies written as <${DATA_SOURCE_ID}>`,
      );
      const id = within(line)
        .getByTestId("tool-call-gist-written")
        .querySelector(".font-mono");
      expect(id?.textContent).toBe(DATA_SOURCE_ID);
    });

    it("lists the whole value a name stands for when the label cut it", () => {
      const address = `${"a".repeat(195)}@evil.example`;
      const input = { ...emailInput, to: [address] };
      cardFor(input, {
        ...emailLabel,
        arguments: viewOf(input),
        items: [
          {
            ...emailLabel.items[0],
            target: {
              pointer: "/to/*",
              values: [
                {
                  path: "/to/0",
                  text: address.slice(0, 200),
                  resolved: "Alice (Finance)",
                  truncated: true,
                },
              ],
            },
          },
        ],
      });

      expect(
        within(screen.getByTestId("tool-call-gist-line")).getByTestId(
          "tool-call-gist-written",
        ),
      ).toHaveTextContent("…");
      expect(screen.getByTestId("tool-call-other-arguments")).toHaveTextContent(
        address,
      );
    });

    it("leaves out only well-known consent flags, says so, and shows other consent fields", () => {
      const input = {
        recordId: "r1",
        hasUserApproved: true,
        marketing_consent: true,
        user_confirmed: "yes",
      };
      cardFor(input, genericLabel(input));

      const view = screen.getByTestId("tool-argument-view");
      expect(view).not.toHaveTextContent("hasUserApproved");
      expect(view).toHaveTextContent("marketing_consent");
      expect(view).toHaveTextContent("user_confirmed");
      expect(consentNote()).toHaveTextContent(
        "The call set an approval value of its own, which is not shown. Only your decision on this card counts.",
      );
    });

    it("says so when the backend left the server's approval argument out", () => {
      const input = { recordId: "r1", confirmed: true };
      cardFor(input, {
        ...genericLabel({ recordId: "r1" }),
      });

      expect(screen.getByTestId("tool-argument-view")).not.toHaveTextContent(
        "confirmed",
      );
      expect(consentNote()).toBeInTheDocument();
    });

    it("says a gist left a consent flag out of its other arguments", () => {
      const input = { ...emailInput, hasUserApproved: true };
      cardFor(input, { ...emailLabel, arguments: viewOf(input) });

      expect(screen.getByTestId("tool-call-gist")).toBeInTheDocument();
      expect(screen.queryByText("hasUserApproved")).not.toBeInTheDocument();
      expect(consentNote()).toBeInTheDocument();
    });

    it("notes nothing when the card leaves nothing out", () => {
      cardFor(emailInput, emailLabel);

      expect(consentNote()).not.toBeInTheDocument();
      expect(hiddenNote()).not.toBeInTheDocument();
    });

    it("warns about hidden characters the backend removed, on the gist", () => {
      cardFor(emailInput, { ...emailLabel, warnings: ["hidden_characters"] });

      expect(screen.getByTestId("tool-call-gist-line")).toBeInTheDocument();
      expect(hiddenNote()).toHaveTextContent(
        "Some values in this call contain hidden characters, which are removed here. What the call writes may differ from what you see.",
      );
    });

    it("warns about hidden characters it removed from a value it read itself", () => {
      const input = { iban: "DE89\u200B3704\u20600044", note: "ok" };
      cardFor(input, genericLabel(input));

      expect(screen.getByTestId("tool-argument-view")).toHaveTextContent(
        "DE8937040044",
      );
      expect(hiddenNote()).toBeInTheDocument();
      expect(
        hiddenNote()!.compareDocumentPosition(
          screen.getByRole("button", { name: "Allow once" }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("shows emoji text as written without a warning", () => {
      const input = { status: "Sunny \u2600\uFE0F", note: "I \u2764\uFE0F it" };
      cardFor(input, genericLabel(input));

      const view = screen.getByTestId("tool-argument-view");
      expect(view).toHaveTextContent("Sunny \u2600\uFE0F");
      expect(view).toHaveTextContent("I \u2764\uFE0F it");
      expect(hiddenNote()).not.toBeInTheDocument();
    });

    it.each([
      [
        "variation selectors after an emoji",
        "Hi \u{1F600}\uFE01\u{E0110}",
        "Hi \u{1F600}",
      ],
      ["a soft hyphen", "pay\u00ADpal", "paypal"],
      ["a Hangul filler", "pay\u3164pal", "paypal"],
    ])("warns about %s it removed", (_name, note, shown) => {
      const input = { note };
      cardFor(input, genericLabel(input));

      expect(
        screen.getByTestId("tool-argument-view").querySelector("dd")
          ?.textContent,
      ).toBe(shown);
      expect(hiddenNote()).toBeInTheDocument();
    });

    it("warns about member names that differ only by a selector after a letter", () => {
      const input = { status: "open", "status\uFE0F": "closed" };
      cardFor(input, genericLabel(input));

      expect(
        Array.from(
          screen.getByTestId("tool-argument-view").querySelectorAll("dt"),
          (name) => name.textContent,
        ),
      ).toEqual(["status", "status"]);
      expect(hiddenNote()).toBeInTheDocument();
    });

    it("warns about hidden characters in a field name it took from the call", () => {
      const input = { ...emailInput, "prio\u200Brity": "high" };
      cardFor(input, {
        ...emailLabel,
        arguments: viewOf(input),
        items: [
          {
            ...emailLabel.items[0],
            fields: [
              {
                pointer: "/prio\u200Brity",
                values: [{ path: "/prio\u200Brity", text: "high" }],
              },
            ],
          },
        ],
      });

      expect(screen.getByTestId("tool-call-gist-values")).toHaveTextContent(
        "priority",
      );
      expect(hiddenNote()).toBeInTheDocument();
    });
  });

  describe("labels this build cannot read", () => {
    it.each<[string, unknown]>([
      ["a label that is text", "create row"],
      ["a label whose verb is a number", { ...createRowLabel, action: 5 }],
      [
        "a label whose items are not a list",
        { ...createRowLabel, items: "Northwind" },
      ],
      [
        "items of the wrong types",
        {
          ...createRowLabel,
          items: [null, 7, "x", { title: 5, fields: { a: 1 } }],
        },
      ],
      [
        "values of the wrong types",
        {
          ...createRowLabel,
          items: [
            {
              title: {
                pointer: "/pages/*/properties/Name",
                values: [
                  null,
                  { path: 3, text: "x" },
                  { path: "/pages/0/properties/Name", text: { a: 1 } },
                  {
                    path: "/pages/0/properties/Name",
                    text: "Northwind",
                    resolved: { name: "x" },
                  },
                ],
                omitted: "lots",
              },
              fields: [{ pointer: {}, values: "x" }],
            },
          ],
        },
      ],
      [
        "a readable view of the wrong shape",
        {
          ...createRowLabel,
          arguments: {
            path: "",
            kind: "group",
            children: [null, { path: 7 }, { path: "/x", kind: "table" }],
            omitted: -3,
          },
        },
      ],
      [
        "a source from a newer server",
        { ...createRowLabel, source: "adapter" },
      ],
      [
        "a warning from a newer server",
        { ...createRowLabel, warnings: ["lookup_name"] },
      ],
      [
        "warnings that are not a list",
        { ...createRowLabel, warnings: "other" },
      ],
    ])(
      "renders %s without breaking the card or its buttons",
      async (_name, label) => {
        const continueToolApproval = vi.fn().mockResolvedValue(undefined);
        renderCard(
          withChatContext(
            <McpToolApprovalCard
              messageId="message-1"
              resolution={null}
              request={{
                ...gistRequest,
                display: {
                  ...createRowDisplay,
                  label: label as typeof createRowLabel,
                },
              }}
            />,
            "chat-1",
            { continueToolApproval },
          ),
        );

        expect(screen.getByText("Records")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
        await waitFor(() => expect(continueToolApproval).toHaveBeenCalled());
      },
    );

    it("gives a label with a verb or kind this build has no words for the generic card", () => {
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            display: {
              ...createRowDisplay,
              label: {
                ...createRowLabel,
                object_kind: "invoice" as typeof createRowLabel.object_kind,
              },
            },
          }}
        />,
      );

      expect(screen.queryByTestId("tool-call-gist")).not.toBeInTheDocument();
      expect(screen.getByTestId("tool-argument-view")).toHaveTextContent(
        "Northwind",
      );
    });

    it("shows a label that throws when read as a row saved before labels", () => {
      const label = { ...createRowLabel };
      Object.defineProperty(label, "items", {
        get() {
          throw new Error("unreadable");
        },
      });
      renderCard(
        <McpToolApprovalCard
          messageId="message-1"
          resolution={null}
          request={{
            ...gistRequest,
            display: { ...createRowDisplay, label },
          }}
        />,
      );

      expect(screen.getByText("Input Parameters")).toBeInTheDocument();
      expect(screen.queryByTestId("tool-call-gist")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Allow once" }),
      ).toBeInTheDocument();
    });
  });
});
