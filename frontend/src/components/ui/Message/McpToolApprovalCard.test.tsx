import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpToolApprovalCard } from "./McpToolApprovalCard";

vi.mock("@/auth/tokenStore", () => ({
  getIdToken: () => null,
}));

const approvalRequest = {
  tool_call_id: "tool-call-1",
  tool_name: "publish_approval_probe",
  mcp_server_id: "mock_mcp_approval",
  input: { channel: "release", message: "Ready to publish" },
  annotations: { openWorldHint: true },
  allow_always: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpToolApprovalCard", () => {
  it("keeps the tool input preview collapsed until the user asks to view it", () => {
    render(
      <McpToolApprovalCard
        messageId="message-1"
        request={approvalRequest}
        resolution={null}
      />,
    );

    const preview = screen
      .getByText("View input parameters")
      .closest("details");
    expect(preview).not.toHaveAttribute("open");
    expect(preview).toHaveTextContent('"channel": "release"');
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
});
