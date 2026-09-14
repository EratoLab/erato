import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EntityRow } from "./EntityRow";
import {
  decisionOfSetting,
  McpToolApprovalSettings,
  shownDecision,
} from "./McpToolApprovalSettings";

import type {
  ListMcpServerToolsResponse,
  McpServerTool,
  UserToolApprovalSetting,
  UserToolDecision,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

// The real Alert reads the theme context; render a bare stand-in like the
// sibling settings tests do.
vi.mock("../Feedback/Alert", () => ({
  Alert: ({ children }: { children: ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

const SERVER_ID = "linear";
const TOOLS_URL = `/api/v1beta/me/mcp_servers/${SERVER_ID}/tools`;
const SETTINGS_URL = "/api/v1beta/me/mcp-tool-approval-settings";

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
  approval: "ask",
  user_decision: "ask",
  is_wait_tool: false,
  ...overrides,
});

const roster = (
  tools: McpServerTool[],
  allowAlways = true,
): ListMcpServerToolsResponse => ({
  server_id: SERVER_ID,
  status: "SUCCESS",
  allow_always: allowAlways,
  tools,
});

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * A fetch stand-in that serves the roster and keeps a tiny settings store:
 * POST upserts one row per tool (a decision flip rewrites it in place, as
 * the backend does) and DELETE deactivates it.
 */
const stubServer = ({
  tools,
  settings = [],
  createStatus = 200,
}: {
  tools: ListMcpServerToolsResponse;
  settings?: UserToolApprovalSetting[];
  createStatus?: number;
}) => {
  const store = new Map(
    settings.map((setting) => [setting.tool_name, setting]),
  );
  let nextId = 1;
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === TOOLS_URL && method === "GET") {
        return Promise.resolve(jsonResponse(tools));
      }
      if (url === SETTINGS_URL && method === "GET") {
        return Promise.resolve(jsonResponse({ settings: [...store.values()] }));
      }
      if (url === SETTINGS_URL && method === "POST") {
        if (createStatus !== 200) {
          return Promise.resolve(
            new Response("Always allow is disabled by MCP approval policy", {
              status: createStatus,
            }),
          );
        }
        const body = JSON.parse(String(init?.body)) as {
          mcp_server_id: string;
          tool_name: string;
          decision: UserToolDecision;
        };
        const existing = store.get(body.tool_name);
        const setting: UserToolApprovalSetting = {
          id:
            existing?.id ??
            `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          mcp_server_id: body.mcp_server_id,
          tool_name: body.tool_name,
          decision: body.decision,
        };
        store.set(body.tool_name, setting);
        return Promise.resolve(jsonResponse(setting));
      }
      if (url.startsWith(`${SETTINGS_URL}/`) && method === "DELETE") {
        const id = url.slice(SETTINGS_URL.length + 1);
        for (const [name, setting] of store) {
          if (setting.id === id) {
            store.delete(name);
          }
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, store };
};

const callsTo = (
  fetchMock: ReturnType<typeof stubServer>["fetchMock"],
  url: string,
  method = "GET",
) =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input) === url && (init?.method ?? "GET") === method,
  );

const queryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
    },
  });

const renderSection = (isActive = true) =>
  render(
    <QueryClientProvider client={queryClient()}>
      <McpToolApprovalSettings serverId={SERVER_ID} isActive={isActive} />
    </QueryClientProvider>,
  );

const renderInRow = () =>
  render(
    <QueryClientProvider client={queryClient()}>
      <EntityRow
        icon={<span />}
        name={SERVER_ID}
        status={{ tone: "success", label: "Connected" }}
      >
        <McpToolApprovalSettings serverId={SERVER_ID} isActive />
      </EntityRow>
    </QueryClientProvider>,
  );

const rowFor = async (name: string) => {
  const rows = await screen.findAllByTestId("mcp-tool-approval-row");
  const row = rows.find((candidate) => candidate.dataset.toolName === name);
  if (!row) {
    throw new Error(`No row for ${name}`);
  }
  return row;
};

/**
 * The roster and the stored decisions load independently; a denied sentinel
 * tool flipping to "Never allow" proves the decisions have been applied.
 */
const settingsApplied = async (deniedToolName: string) => {
  const row = await rowFor(deniedToolName);
  await waitFor(() => {
    expect(
      within(row).getByRole("radio", { name: /Never allow/ }),
    ).toBeChecked();
  });
};

const radioLabels = (row: HTMLElement) =>
  within(row)
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("value"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decisionOfSetting", () => {
  it("maps the stored decision, never the row's presence", () => {
    const base = {
      id: "00000000-0000-4000-8000-000000000001",
      mcp_server_id: SERVER_ID,
      tool_name: "get_issue",
    };
    expect(decisionOfSetting(undefined)).toBe("ask");
    expect(decisionOfSetting({ ...base, decision: "always_allow" })).toBe(
      "always",
    );
    expect(decisionOfSetting({ ...base, decision: "denied" })).toBe("never");
  });
});

describe("shownDecision", () => {
  it("folds a grant the gate would not honor into the default state", () => {
    expect(shownDecision("always", true)).toBe("always");
    expect(shownDecision("always", false)).toBe("ask");
    expect(shownDecision("never", false)).toBe("never");
    expect(shownDecision("ask", false)).toBe("ask");
  });
});

describe("McpToolApprovalSettings", () => {
  it("lists the roster once on row expand and not again on a repeat expand", async () => {
    const { fetchMock } = stubServer({ tools: roster([]) });

    renderInRow();
    const toggle = screen.getByRole("button", { name: /linear/ });

    // A collapsed row has not asked the server for anything.
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(0);

    fireEvent.click(toggle);
    expect(
      await screen.findByText("This server exposes no tools to you."),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);

    // Collapse unmounts the section; re-expanding inside the stale window is
    // served from the query cache rather than a second enumeration.
    fireEvent.click(toggle);
    expect(screen.queryByTestId("mcp-tool-approval-settings")).toBeNull();
    fireEvent.click(toggle);
    expect(
      await screen.findByText("This server exposes no tools to you."),
    ).toBeInTheDocument();
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);
  });

  it("does not fetch while the tab is inactive", () => {
    const { fetchMock } = stubServer({ tools: roster([]) });

    renderSection(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders every badge straight from the response", async () => {
    // The first row is impossible under protocol defaults (read-only yet
    // unannotated): rendering it as sent is the proof that nothing here
    // re-derives the annotations or the approval verdict.
    stubServer({
      tools: roster([
        tool({
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
        }),
        tool({
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
        }),
      ]),
    });

    renderSection();

    const rows = await screen.findAllByTestId("mcp-tool-approval-row");
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

  it("offers three states to a tool that asks and two to one that runs unprompted", async () => {
    stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", approval: "ask" }),
        tool({ name: "list_teams", title: "List teams", approval: "auto" }),
      ]),
    });

    renderSection();

    const asking = await rowFor("get_issue");
    expect(radioLabels(asking)).toEqual(["ask", "always", "never"]);
    expect(
      within(asking).getByRole("radio", { name: /Ask each time/ }),
    ).toBeChecked();

    // A persistent grant changes nothing for a tool the policy never stops,
    // so it is not offered; the default reads as plain "Allow".
    const unprompted = await rowFor("list_teams");
    expect(radioLabels(unprompted)).toEqual(["ask", "never"]);
    expect(
      within(unprompted).getByRole("radio", { name: /^Allow/ }),
    ).toBeChecked();
  });

  it("maps stored decisions to the radio state and lists undecided tools too", async () => {
    stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue" }),
        tool({ name: "update_issue", title: "Update issue" }),
        tool({ name: "list_teams", title: "List teams" }),
      ]),
      settings: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          mcp_server_id: SERVER_ID,
          tool_name: "get_issue",
          decision: "always_allow",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          mcp_server_id: SERVER_ID,
          tool_name: "update_issue",
          decision: "denied",
        },
        // Another server's row and a row for a tool the server no longer
        // lists: neither may leak into this roster.
        {
          id: "00000000-0000-4000-8000-000000000003",
          mcp_server_id: "notion",
          tool_name: "list_teams",
          decision: "denied",
        },
        {
          id: "00000000-0000-4000-8000-000000000004",
          mcp_server_id: SERVER_ID,
          tool_name: "retired_tool",
          decision: "always_allow",
        },
      ],
    });

    renderSection();

    const granted = await rowFor("get_issue");
    await waitFor(() => {
      expect(
        within(granted).getByRole("radio", { name: /Always allow/ }),
      ).toBeChecked();
    });
    // A denied row is a decision of its own, never read as a grant.
    const denied = await rowFor("update_issue");
    expect(
      within(denied).getByRole("radio", { name: /Never allow/ }),
    ).toBeChecked();
    expect(
      within(denied).getByRole("radio", { name: /Always allow/ }),
    ).not.toBeChecked();
    // Present without ever having been decided on: the roster, not the
    // stored decisions, drives what is listed.
    const undecided = await rowFor("list_teams");
    expect(
      within(undecided).getByRole("radio", { name: /Ask each time/ }),
    ).toBeChecked();
    expect(screen.queryByText("retired_tool")).not.toBeInTheDocument();
  });

  it("round-trips ask, never and always through the settings endpoints", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([tool({ name: "get_issue", title: "Get issue" })]),
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(within(row).getByRole("radio", { name: /Never allow/ }));
    await waitFor(() => {
      expect(
        within(row).getByRole("radio", { name: /Never allow/ }),
      ).toBeChecked();
    });
    const [denyCall] = callsTo(fetchMock, SETTINGS_URL, "POST");
    expect(JSON.parse(String(denyCall[1]?.body))).toEqual({
      mcp_server_id: SERVER_ID,
      tool_name: "get_issue",
      decision: "denied",
    });
    expect(store.get("get_issue")?.decision).toBe("denied");

    // A flip between the two stored decisions rewrites the row in place.
    fireEvent.click(within(row).getByRole("radio", { name: /Always allow/ }));
    await waitFor(() => {
      expect(
        within(row).getByRole("radio", { name: /Always allow/ }),
      ).toBeChecked();
    });
    const [, grantCall] = callsTo(fetchMock, SETTINGS_URL, "POST");
    expect(JSON.parse(String(grantCall[1]?.body))).toEqual({
      mcp_server_id: SERVER_ID,
      tool_name: "get_issue",
      decision: "always_allow",
    });
    expect(store.get("get_issue")?.decision).toBe("always_allow");
    const grantId = store.get("get_issue")?.id;

    // Back to asking deactivates the row; the tool stays listed.
    fireEvent.click(within(row).getByRole("radio", { name: /Ask each time/ }));
    await waitFor(() => {
      expect(
        within(row).getByRole("radio", { name: /Ask each time/ }),
      ).toBeChecked();
    });
    expect(
      callsTo(fetchMock, `${SETTINGS_URL}/${grantId}`, "DELETE"),
    ).toHaveLength(1);
    expect(store.has("get_issue")).toBe(false);
    expect(await rowFor("get_issue")).toBeInTheDocument();
  });

  it("does not offer Always allow when the policy does not honor grants", async () => {
    const { store } = stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue" }),
          tool({ name: "update_issue", title: "Update issue" }),
        ],
        false,
      ),
      // A grant stored while the policy still honored it: the gate ignores
      // it now, so the row must not read it as "always" either.
      settings: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          mcp_server_id: SERVER_ID,
          tool_name: "get_issue",
          decision: "always_allow",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          mcp_server_id: SERVER_ID,
          tool_name: "update_issue",
          decision: "denied",
        },
      ],
    });

    renderSection();
    const row = await rowFor("get_issue");
    await settingsApplied("update_issue");

    expect(radioLabels(row)).toEqual(["ask", "never"]);
    expect(
      within(row).getByRole("radio", { name: /Ask each time/ }),
    ).toBeChecked();
    // Denying is strictly more restrictive and stays available, and a flip
    // through it rewrites the stale row instead of stacking a second one.
    fireEvent.click(within(row).getByRole("radio", { name: /Never allow/ }));
    await waitFor(() => {
      expect(store.get("get_issue")?.decision).toBe("denied");
    });
    expect(store.get("get_issue")?.id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("shows a stale grant on a tool that runs unprompted as plain Allow", async () => {
    stubServer({
      tools: roster([
        tool({ name: "list_teams", title: "List teams", approval: "auto" }),
        tool({ name: "update_issue", title: "Update issue" }),
      ]),
      settings: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          mcp_server_id: SERVER_ID,
          tool_name: "list_teams",
          decision: "always_allow",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          mcp_server_id: SERVER_ID,
          tool_name: "update_issue",
          decision: "denied",
        },
      ],
    });

    renderSection();
    const row = await rowFor("list_teams");
    await settingsApplied("update_issue");

    expect(radioLabels(row)).toEqual(["ask", "never"]);
    expect(within(row).getByRole("radio", { name: /^Allow/ })).toBeChecked();
  });

  it("reports an unreachable server instead of an empty roster", async () => {
    stubServer({
      tools: {
        server_id: SERVER_ID,
        status: "FAILURE",
        allow_always: true,
        tools: [],
      },
    });

    renderSection();

    expect(
      await screen.findByText(/could not be listed because the server/),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("mcp-tool-approval-row")).toHaveLength(0);
  });

  it("asks the user to connect instead of listing tools when unauthenticated", async () => {
    stubServer({
      tools: {
        server_id: SERVER_ID,
        status: "NEEDS_AUTHENTICATION",
        allow_always: true,
        tools: [],
      },
    });

    renderSection();

    expect(
      await screen.findByText("Connect to see tools."),
    ).toBeInTheDocument();
    expect(screen.queryAllByTestId("mcp-tool-approval-row")).toHaveLength(0);
  });

  it("surfaces an error when a decision is rejected", async () => {
    stubServer({
      tools: roster([tool({ name: "get_issue", title: "Get issue" })]),
      createStatus: 400,
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(within(row).getByRole("radio", { name: /Always allow/ }));

    expect(
      await screen.findByText(/Could not update the decision/),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("radio", { name: /Ask each time/ }),
    ).toBeChecked();
  });

  it("surfaces a roster load error", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("boom", { status: 500 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderSection();

    expect(
      await screen.findByText(/Could not load the tools of this server/),
    ).toBeInTheDocument();
  });
});
