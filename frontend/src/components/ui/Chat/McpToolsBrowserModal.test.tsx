import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpToolsBrowserModal } from "./McpToolsBrowserModal";

import type {
  ListMcpServerToolsResponse,
  McpServerStatus,
  McpServerTool,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// The real Alert reads the theme context; render a bare stand-in like the
// settings tests do.
vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

const mockOpenMcpServersSettings = vi.fn();
let openSettings: (() => void) | null = null;
vi.mock("@/hooks/ui/useOpenMcpServersSettings", () => ({
  useOpenMcpServersSettings: () => openSettings,
}));

const server = (
  id: string,
  connectionStatus: McpServerStatus["connection_status"] = "SUCCESS",
): McpServerStatus => ({
  id,
  connection_status: connectionStatus,
  authentication_mode: "oauth2",
});

const tool = (overrides: Partial<McpServerTool>): McpServerTool => ({
  name: "get_issue",
  title: "Get issue",
  description: null,
  annotations: {
    read_only_hint: true,
    destructive_hint: false,
    idempotent_hint: true,
    open_world_hint: false,
    annotated: true,
  },
  approval: "auto",
  user_decision: "ask",
  is_wait_tool: false,
  ...overrides,
});

const roster = (
  serverId: string,
  tools: McpServerTool[],
): ListMcpServerToolsResponse => ({
  server_id: serverId,
  status: "SUCCESS",
  allow_always: true,
  tools,
});

const stubToolsFetch = (
  rosters: Partial<Record<string, ListMcpServerToolsResponse>>,
) => {
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const match = /\/api\/v1beta\/me\/mcp_servers\/([^/]+)\/tools$/.exec(url);
      if (match && (init?.method ?? "GET") === "GET") {
        const body = rosters[match[1]];
        if (body) {
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const renderModal = (servers: McpServerStatus[], onClose = vi.fn()) => {
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
      <McpToolsBrowserModal isOpen onClose={onClose} servers={servers} />
    </QueryClientProvider>,
  );
  return { onClose };
};

const serverRow = (id: string) => {
  const rows = screen.getAllByTestId("mcp-tools-browser-server");
  const row = rows.find((candidate) => within(candidate).queryByText(id));
  if (!row) {
    throw new Error(`no row for ${id}`);
  }
  return row;
};

const expand = (row: HTMLElement) => {
  const disclosure = within(row)
    .getAllByRole("button")
    .find((button) => button.hasAttribute("aria-expanded"));
  if (!disclosure) {
    throw new Error("no disclosure button");
  }
  fireEvent.click(disclosure);
};

describe("McpToolsBrowserModal", () => {
  beforeEach(() => {
    openSettings = mockOpenMcpServersSettings;
    mockOpenMcpServersSettings.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a connected server's tools with the settings badges on expand", async () => {
    const fetchMock = stubToolsFetch({
      linear: roster("linear", [
        tool({ name: "get_issue", title: "Get issue" }),
        tool({
          name: "create_issue",
          title: "Create issue",
          description: "Files a new issue",
          approval: "ask",
          annotations: {
            read_only_hint: false,
            destructive_hint: false,
            idempotent_hint: false,
            open_world_hint: true,
            annotated: true,
          },
        }),
        tool({
          name: "mystery",
          title: "Mystery",
          annotations: {
            read_only_hint: false,
            destructive_hint: true,
            idempotent_hint: false,
            open_world_hint: true,
            annotated: false,
          },
        }),
      ]),
    });
    renderModal([server("linear")]);

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Connected tools");
    const row = serverRow("linear");
    expect(within(row).getByText("Connected")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    expand(row);

    const tools = await screen.findAllByTestId("mcp-tools-browser-tool");
    expect(tools.map((item) => item.dataset.toolName)).toEqual([
      "get_issue",
      "create_issue",
      "mystery",
    ]);
    expect(within(tools[0]).getByText("Reads only")).toBeInTheDocument();
    expect(within(tools[1]).getByText("Can modify")).toBeInTheDocument();
    expect(
      within(tools[1]).getByText("Reaches other systems"),
    ).toBeInTheDocument();
    expect(
      within(tools[1]).getByText("Asks before running"),
    ).toBeInTheDocument();
    expect(within(tools[1]).getByText("Files a new issue")).toBeInTheDocument();
    expect(
      within(tools[2]).getByText("Not declared by the server"),
    ).toBeInTheDocument();
    // Read-only: no decision controls travel with the rows here.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("offers Authorize instead of tools for a server awaiting the user's connection", () => {
    const fetchMock = stubToolsFetch({});
    const { onClose } = renderModal([server("jira", "NEEDS_AUTHENTICATION")]);

    const row = serverRow("jira");
    expect(within(row).getByText("Needs authentication")).toBeInTheDocument();
    expand(row);
    expect(
      within(row).getByText(
        "Authorization is required before this server can be used.",
      ),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("mcp-tools-browser-tools"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mcp-tools-browser-authorize"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockOpenMcpServersSettings).toHaveBeenCalledTimes(1);
  });

  it("links into Settings, where decisions live", () => {
    stubToolsFetch({});
    const { onClose } = renderModal([server("linear")]);

    fireEvent.click(screen.getByTestId("mcp-tools-browser-manage"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockOpenMcpServersSettings).toHaveBeenCalledTimes(1);
  });

  // Without a settings dialog to open (component-kit and add-in hosts) both
  // affordances would be dead buttons, so they go rather than misfire.
  it("drops the settings affordances where no settings dialog answers them", () => {
    openSettings = null;
    stubToolsFetch({});
    renderModal([server("jira", "NEEDS_AUTHENTICATION")]);

    expect(
      screen.queryByTestId("mcp-tools-browser-authorize"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mcp-tools-browser-manage"),
    ).not.toBeInTheDocument();
    expect(
      within(serverRow("jira")).getByText("Needs authentication"),
    ).toBeInTheDocument();
  });

  it("says so when no server is available", () => {
    stubToolsFetch({});
    renderModal([]);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "No MCP servers are currently available to you.",
    );
  });
});
