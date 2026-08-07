import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpToolApprovalSettings } from "./McpToolApprovalSettings";

const approval = {
  id: "11111111-1111-4111-8111-111111111111",
  mcp_server_id: "mock_mcp_approval",
  tool_name: "publish_approval_probe",
};

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const renderSection = (isActive = true) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, refetchOnWindowFocus: false },
          },
        })
      }
    >
      <McpToolApprovalSettings isActive={isActive} />
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpToolApprovalSettings", () => {
  it("stays hidden while the user has no persisted approvals", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ settings: [] }));
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId("mcp-tool-approval-settings"),
    ).not.toBeInTheDocument();
  });

  it("does not fetch while the tab is inactive", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderSection(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists persisted approvals and removes one on request", async () => {
    let removed = false;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (init?.method === "DELETE") {
          removed = true;
          expect(url).toBe(
            `/api/v1beta/me/mcp-tool-approval-settings/${approval.id}`,
          );
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          jsonResponse({ settings: removed ? [] : [approval] }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(
      await screen.findByText("publish_approval_probe"),
    ).toBeInTheDocument();
    expect(screen.getByText("mock_mcp_approval")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    // Row removal doubles as the success feedback; the section hides once
    // the refetched list is empty.
    await waitFor(() => {
      expect(
        screen.queryByTestId("mcp-tool-approval-settings"),
      ).not.toBeInTheDocument();
    });
    expect(removed).toBe(true);
  });
});
