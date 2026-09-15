import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { McpToolsBrowserModal } from "./McpToolsBrowserModal";

import type { McpToolsBrowserModalProps } from "./McpToolsBrowserModal";
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
  policy: "auto",
  effective: "allow",
  user_decision: "none",
  is_wait_tool: false,
  description_truncated: false,
  ...overrides,
});

const roster = (
  serverId: string,
  tools: McpServerTool[],
): ListMcpServerToolsResponse => ({
  server_id: serverId,
  status: "SUCCESS",
  allow_always: true,
  ask_available: true,
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

const renderModal = (
  servers: McpServerStatus[],
  onClose = vi.fn(),
  switches: Partial<
    Pick<
      McpToolsBrowserModalProps,
      | "disabledToolPatterns"
      | "onToggleTool"
      | "toolSwitchesLocked"
      | "disabledServerIds"
    >
  > = {},
) => {
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
      <McpToolsBrowserModal
        isOpen
        onClose={onClose}
        servers={servers}
        {...switches}
      />
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
          policy: "ask",
          effective: "ask",
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
    // The description waits behind the row's chevron.
    expect(within(tools[1]).queryByText("Files a new issue")).toBeNull();
    fireEvent.click(
      within(tools[1]).getByRole("button", {
        name: "Description of Create issue",
      }),
    );
    expect(within(tools[1]).getByText("Files a new issue")).toBeInTheDocument();
    expect(
      within(tools[2]).getByText("Not declared by the server"),
    ).toBeInTheDocument();
    // Read-only: no decision controls travel with the rows here, and
    // without a switch handed in there is no per-chat switch either.
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The tools each connected server offers in your chats. Decide what may run in Settings.",
      ),
    ).toBeInTheDocument();
  });

  it("badges a tool as asking by what will happen, not by the policy verdict", async () => {
    // With no radios here the badge is the only indicator, so it must follow
    // the user's stored decision where the gate honors it.
    stubToolsFetch({
      linear: roster("linear", [
        tool({
          name: "list_teams",
          title: "List teams",
          policy: "auto",
          user_decision: "ask",
          effective: "ask",
        }),
        tool({
          name: "get_issue",
          title: "Get issue",
          policy: "ask",
          user_decision: "always_allow",
          effective: "allow",
        }),
      ]),
    });
    renderModal([server("linear")]);
    expand(serverRow("linear"));

    const tools = await screen.findAllByTestId("mcp-tools-browser-tool");
    expect(tools.map((item) => item.dataset.toolName)).toEqual([
      "list_teams",
      "get_issue",
    ]);
    expect(
      within(tools[0]).getByText("Asks before running"),
    ).toBeInTheDocument();
    expect(
      within(tools[1]).queryByText("Asks before running"),
    ).not.toBeInTheDocument();
  });

  describe("per-chat tool switches", () => {
    const linearRoster = () =>
      roster("linear", [
        tool({ name: "get_issue", title: "Get issue" }),
        tool({ name: "create_issue", title: "Create issue" }),
      ]);

    const toolSwitch = (toolName: string) => {
      const row = screen
        .getAllByTestId("mcp-tools-browser-tool")
        .find((candidate) => candidate.dataset.toolName === toolName);
      if (!row) {
        throw new Error(`no row for ${toolName}`);
      }
      return within(row).getByRole("checkbox");
    };

    it("puts a switch on every tool row, unticked for a switched-off tool, and flips that one tool", async () => {
      stubToolsFetch({ linear: linearRoster() });
      const onToggleTool = vi.fn();
      renderModal([server("linear")], vi.fn(), {
        disabledToolPatterns: ["linear/create_issue"],
        onToggleTool,
      });

      expect(
        screen.getByText(
          "The tools each connected server offers in this chat. Switch a tool off to keep it out of this chat; decide what may run for you at all in Settings.",
        ),
      ).toBeInTheDocument();
      expand(serverRow("linear"));
      await screen.findAllByTestId("mcp-tools-browser-tool");

      expect(toolSwitch("get_issue")).toBeChecked();
      expect(toolSwitch("get_issue")).toHaveAccessibleName(
        "Use Get issue in this chat",
      );
      expect(toolSwitch("create_issue")).not.toBeChecked();
      // Still a checkbox, never the settings radios: the two decisions
      // must not look alike.
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();

      fireEvent.click(toolSwitch("create_issue"));
      expect(onToggleTool).toHaveBeenCalledWith("linear", "create_issue");
      fireEvent.click(toolSwitch("get_issue"));
      expect(onToggleTool).toHaveBeenCalledWith("linear", "get_issue");
    });

    it("keeps a same-named tool of another server on", async () => {
      stubToolsFetch({
        linear: linearRoster(),
        github: roster("github", [
          tool({ name: "create_issue", title: "Create issue" }),
        ]),
      });
      renderModal([server("linear"), server("github")], vi.fn(), {
        disabledToolPatterns: ["github/create_issue"],
        onToggleTool: vi.fn(),
      });

      expand(serverRow("linear"));
      await screen.findAllByTestId("mcp-tools-browser-tool");

      expect(toolSwitch("create_issue")).toBeChecked();
    });

    // The list's grammar is wider than what the switches write: a wildcard
    // entry keeps a tool off whatever the switch does, so the row shows it
    // off and says why instead of offering a flip that would not help.
    it("shows a tool covered by a wildcard entry as off and locked, with the entry named", async () => {
      stubToolsFetch({ linear: linearRoster() });
      const onToggleTool = vi.fn();
      renderModal([server("linear")], vi.fn(), {
        disabledToolPatterns: ["linear/*"],
        onToggleTool,
      });

      expand(serverRow("linear"));
      await screen.findAllByTestId("mcp-tools-browser-tool");

      expect(toolSwitch("get_issue")).not.toBeChecked();
      expect(toolSwitch("get_issue")).toBeDisabled();
      expect(toolSwitch("create_issue")).not.toBeChecked();
      expect(toolSwitch("create_issue")).toBeDisabled();
      expect(
        screen.getAllByText("Switched off for this chat by the rule linear/*"),
      ).toHaveLength(2);
      expect(screen.queryByText("In this chat")).not.toBeInTheDocument();
    });

    it("locks a tool the wildcard covers even when its exact entry is present too", async () => {
      stubToolsFetch({ linear: linearRoster() });
      renderModal([server("linear")], vi.fn(), {
        disabledToolPatterns: ["linear/create_issue", "linear"],
        onToggleTool: vi.fn(),
      });

      expand(serverRow("linear"));
      await screen.findAllByTestId("mcp-tools-browser-tool");

      expect(toolSwitch("create_issue")).not.toBeChecked();
      expect(toolSwitch("create_issue")).toBeDisabled();
      expect(toolSwitch("get_issue")).toBeDisabled();
    });

    it("locks the switches while the chat's list is not read yet", async () => {
      stubToolsFetch({ linear: linearRoster() });
      renderModal([server("linear")], vi.fn(), {
        disabledToolPatterns: [],
        onToggleTool: vi.fn(),
        toolSwitchesLocked: true,
      });

      expand(serverRow("linear"));
      await screen.findAllByTestId("mcp-tools-browser-tool");

      expect(toolSwitch("get_issue")).toBeDisabled();
      expect(toolSwitch("create_issue")).toBeDisabled();
    });

    // The server switch lives in the composer; here the row only says the
    // server is off and keeps the per-tool switches from pretending.
    it("says a switched-off server is off for the chat and locks its tool switches", async () => {
      stubToolsFetch({
        linear: linearRoster(),
        github: roster("github", [
          tool({ name: "create_issue", title: "Create issue" }),
        ]),
      });
      renderModal([server("linear"), server("github")], vi.fn(), {
        disabledToolPatterns: [],
        onToggleTool: vi.fn(),
        disabledServerIds: ["linear"],
      });

      const linear = serverRow("linear");
      expect(
        within(linear).getByText("Switched off for this chat"),
      ).toBeInTheDocument();
      expect(
        within(serverRow("github")).queryByText("Switched off for this chat"),
      ).not.toBeInTheDocument();

      expand(linear);
      await screen.findAllByTestId("mcp-tools-browser-tool");
      expect(toolSwitch("get_issue")).toBeDisabled();
      expect(toolSwitch("get_issue")).toBeChecked();

      expand(serverRow("github"));
      await waitFor(() =>
        expect(
          screen.getAllByTestId("mcp-tools-browser-tool-switch"),
        ).toHaveLength(3),
      );
      const githubSwitch = within(serverRow("github")).getByRole("checkbox");
      expect(githubSwitch).toBeEnabled();
    });
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
