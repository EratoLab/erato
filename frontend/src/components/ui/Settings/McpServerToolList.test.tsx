import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntityRow } from "./EntityRow";
import { McpServerToolList } from "./McpServerToolList";

import type { ListMcpServerToolsResponse } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// The real Alert reads the theme context; render a bare stand-in like the
// sibling settings tests do.
vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

const TOOLS_URL = "/api/v1beta/me/mcp_servers/linear/tools";

const jsonResponse = (payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const stubTools = (payload: ListMcpServerToolsResponse) => {
  const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    if (String(input) === TOOLS_URL) {
      return Promise.resolve(jsonResponse(payload));
    }
    return Promise.reject(new Error(`Unexpected request: ${String(input)}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const toolsCalls = (fetchMock: ReturnType<typeof stubTools>) =>
  fetchMock.mock.calls.filter(([input]) => String(input) === TOOLS_URL);

const renderList = (isActive = true) =>
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
      <McpServerToolList serverId="linear" isActive={isActive} />
    </QueryClientProvider>,
  );

const renderInRow = () =>
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
      <EntityRow
        icon={<span />}
        name="linear"
        status={{ tone: "success", label: "Connected" }}
      >
        <McpServerToolList serverId="linear" isActive />
      </EntityRow>
    </QueryClientProvider>,
  );

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("McpServerToolList", () => {
  it("fetches once on row expand and not again on a repeat expand", async () => {
    const fetchMock = stubTools({
      server_id: "linear",
      status: "SUCCESS",
      tools: [],
    });

    renderInRow();
    const toggle = screen.getByRole("button", { name: /linear/ });

    // A collapsed row has not asked the server for anything.
    expect(toolsCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(toggle);
    expect(
      await screen.findByText("This server exposes no tools to you."),
    ).toBeInTheDocument();
    expect(toolsCalls(fetchMock)).toHaveLength(1);

    // Collapse unmounts the list; re-expanding inside the stale window is
    // served from the query cache rather than a second enumeration.
    fireEvent.click(toggle);
    expect(screen.queryByTestId("mcp-server-tool-list")).toBeNull();
    fireEvent.click(toggle);
    expect(
      await screen.findByText("This server exposes no tools to you."),
    ).toBeInTheDocument();
    expect(toolsCalls(fetchMock)).toHaveLength(1);
  });

  it("does not fetch while the tab is inactive", () => {
    const fetchMock = stubTools({
      server_id: "linear",
      status: "SUCCESS",
      tools: [],
    });

    renderList(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders every badge straight from the response", async () => {
    // The first row is impossible under protocol defaults (read-only yet
    // unannotated): rendering it as sent is the proof that nothing here
    // re-derives the annotations or the approval verdict.
    stubTools({
      server_id: "linear",
      status: "SUCCESS",
      tools: [
        {
          name: "get_issue",
          title: "Get issue",
          description: "Fetch one issue by id.",
          annotations: {
            read_only_hint: true,
            destructive_hint: false,
            idempotent_hint: true,
            open_world_hint: true,
            annotated: false,
          },
          approval: "ask",
          user_decision: "ask",
          is_wait_tool: false,
        },
        {
          name: "update_issue",
          title: "update_issue",
          description: null,
          annotations: {
            read_only_hint: false,
            destructive_hint: true,
            idempotent_hint: false,
            open_world_hint: false,
            annotated: true,
          },
          approval: "auto",
          user_decision: "always",
          is_wait_tool: false,
        },
      ],
    });

    renderList();

    const rows = await screen.findAllByTestId("mcp-server-tool-row");
    expect(rows.map((row) => row.dataset.toolName)).toEqual([
      "get_issue",
      "update_issue",
    ]);

    const [getIssue, updateIssue] = rows;
    expect(getIssue).toHaveTextContent("Get issue");
    expect(getIssue).toHaveTextContent("get_issue");
    expect(getIssue).toHaveTextContent("Fetch one issue by id.");
    const getIssueBadges = within(getIssue).getByRole("list", {
      name: "Get issue",
    });
    expect(
      within(getIssueBadges)
        .getAllByRole("listitem")
        .map((badge) => badge.textContent),
    ).toEqual([
      "Reads only",
      "Reaches other systems",
      "Not declared by the server",
      "Asks before running",
    ]);

    const updateIssueBadges = within(updateIssue).getByRole("list", {
      name: "update_issue",
    });
    expect(
      within(updateIssueBadges)
        .getAllByRole("listitem")
        .map((badge) => badge.textContent),
    ).toEqual(["Can modify"]);
    // A title equal to the name is shown once, not echoed as a subtitle.
    expect(within(updateIssue).getAllByText("update_issue")).toHaveLength(1);
  });

  it("asks the user to connect instead of listing tools when unauthenticated", async () => {
    stubTools({
      server_id: "linear",
      status: "NEEDS_AUTHENTICATION",
      tools: [],
    });

    renderList();

    expect(
      await screen.findByText("Connect to see tools."),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("mcp-server-tool-row")).toHaveLength(0);
  });

  it("surfaces a load error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("boom", { status: 500 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderList();

    expect(
      await screen.findByText(/Could not load the tools of this server/),
    ).toBeInTheDocument();
  });
});
