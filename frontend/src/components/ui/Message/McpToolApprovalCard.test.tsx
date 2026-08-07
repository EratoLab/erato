import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { ChatContext } from "@/providers/ChatProvider";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

import type { ChatContextValue } from "@/providers/ChatProvider";
import type { ReactNode } from "react";

vi.mock("@/auth/tokenStore", () => ({
  getIdToken: () => null,
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

const withChatContext = (ui: ReactNode, chatId = "chat-1") => (
  <ChatContext.Provider
    value={
      {
        currentChatId: chatId,
        refetchMessages: async () => undefined,
      } as unknown as ChatContextValue
    }
  >
    {ui}
  </ChatContext.Provider>
);

afterEach(() => {
  vi.unstubAllGlobals();
  useConfirmationRegistryStore.setState({ pendingIdsByChatId: {} });
});

describe("McpToolApprovalCard", () => {
  it("shows the pending tool call as a visible referent above the consent card", () => {
    render(
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

    render(
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

  it("holds the chat's confirmation registry while the decision is pending", () => {
    const { unmount } = render(
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

    render(
      withChatContext(
        <McpToolApprovalCard
          messageId="message-1"
          request={approvalRequest}
          resolution={null}
        />,
      ),
    );

    fireEvent.click(screen.getByText("Deny"));

    await waitFor(() => {
      expect(useConfirmationRegistryStore.getState().hasPending("chat-1")).toBe(
        false,
      );
    });
  });

  it("greys out Always allow with the policy reason instead of hiding it", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
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

  it("does not register an already-resolved request", () => {
    render(
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
});
