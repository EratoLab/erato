import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { McpToolApprovalSettings } from "./McpToolApprovalSettings";

import type { ReactNode } from "react";

// The real Alert reads the theme context; render a bare stand-in like the
// UserPreferencesDialog test does.
vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

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
  it("renders an explanatory empty state instead of hiding the section", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ settings: [] }));
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(
      screen.getByTestId("mcp-tool-approval-settings"),
    ).toBeInTheDocument();
    expect(screen.getByText(/No decisions yet/)).toBeInTheDocument();
  });

  it("does not fetch while the tab is inactive", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderSection(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a granted tool as Always allow and keeps the row after flipping to ask", async () => {
    let granted = true;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "DELETE") {
          granted = false;
          expect(String(input)).toBe(
            `/api/v1beta/me/mcp-tool-approval-settings/${approval.id}`,
          );
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          jsonResponse({ settings: granted ? [approval] : [] }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(
      await screen.findByText("publish_approval_probe"),
    ).toBeInTheDocument();
    expect(screen.getByText("mock_mcp_approval")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Always allow/ })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Ask before running/ }));

    // Session-sticky: the grant is gone server-side, but the row stays and
    // now shows the ask decision, so the user can flip back.
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: /Ask before running/ }),
      ).toBeChecked();
    });
    expect(screen.getByText("publish_approval_probe")).toBeInTheDocument();
  });

  it("re-grants via the create endpoint when flipping back to Always allow", async () => {
    let granted = true;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") {
          granted = true;
          expect(String(input)).toBe(
            "/api/v1beta/me/mcp-tool-approval-settings",
          );
          expect(JSON.parse(String(init.body))).toEqual({
            mcp_server_id: approval.mcp_server_id,
            tool_name: approval.tool_name,
          });
          return Promise.resolve(jsonResponse(approval));
        }
        if (init?.method === "DELETE") {
          granted = false;
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          jsonResponse({ settings: granted ? [approval] : [] }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(
      await screen.findByText("publish_approval_probe"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Ask before running/ }));
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: /Ask before running/ }),
      ).toBeChecked();
    });

    fireEvent.click(screen.getByRole("radio", { name: /Always allow/ }));
    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /Always allow/ })).toBeChecked();
    });
  });

  it("surfaces an error when the re-grant is rejected by policy", async () => {
    let granted = true;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (init?.method === "POST") {
          return Promise.resolve(
            new Response("Always allow is disabled by MCP approval policy", {
              status: 400,
            }),
          );
        }
        if (init?.method === "DELETE") {
          granted = false;
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        return Promise.resolve(
          jsonResponse({ settings: granted ? [approval] : [] }),
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(
      await screen.findByText("publish_approval_probe"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Ask before running/ }));
    await waitFor(() => {
      expect(
        screen.getByRole("radio", { name: /Ask before running/ }),
      ).toBeChecked();
    });

    fireEvent.click(screen.getByRole("radio", { name: /Always allow/ }));
    await waitFor(() => {
      expect(
        screen.getByText(/Could not update the decision/),
      ).toBeInTheDocument();
    });
  });
});
