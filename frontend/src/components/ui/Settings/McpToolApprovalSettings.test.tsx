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
  McpToolApprovalSettings,
  offeredDecisions,
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

/** A tool as the server lists it, before any stored decision is laid over. */
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
  policy: "ask",
  user_decision: "none",
  effective: "ask",
  is_wait_tool: false,
  ...overrides,
});

const roster = (
  tools: McpServerTool[],
  {
    allowAlways = true,
    askAvailable = true,
  }: { allowAlways?: boolean; askAvailable?: boolean } = {},
): ListMcpServerToolsResponse => ({
  server_id: SERVER_ID,
  status: "SUCCESS",
  allow_always: allowAlways,
  ask_available: askAvailable,
  tools,
});

const setting = (
  toolName: string,
  decision: UserToolDecision,
  id = "00000000-0000-4000-8000-000000000001",
  serverId = SERVER_ID,
): UserToolApprovalSetting => ({
  id,
  mcp_server_id: serverId,
  tool_name: toolName,
  decision,
});

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * A fetch stand-in that keeps a tiny settings store and, like the backend,
 * projects it onto the roster: every listing carries the stored decision and
 * the effective state the gate would apply. POST upserts one row per tool
 * (a decision flip rewrites it in place) and DELETE deactivates it.
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
  const project = (listed: McpServerTool): McpServerTool => {
    const stored = store.get(listed.name);
    const decision =
      stored?.mcp_server_id === SERVER_ID ? stored.decision : undefined;
    let effective: McpServerTool["effective"];
    if (decision === "denied") {
      effective = "denied";
    } else if (decision === "always_allow" && tools.allow_always) {
      effective = "allow";
    } else if (decision === "ask" && tools.ask_available) {
      effective = "ask";
    } else {
      effective = listed.policy === "ask" ? "ask" : "allow";
    }
    return { ...listed, user_decision: decision ?? "none", effective };
  };
  const fetchMock = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === TOOLS_URL && method === "GET") {
        return Promise.resolve(
          jsonResponse({ ...tools, tools: tools.tools.map(project) }),
        );
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
        const row: UserToolApprovalSetting = {
          id:
            existing?.id ??
            `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          mcp_server_id: body.mcp_server_id,
          tool_name: body.tool_name,
          decision: body.decision,
        };
        store.set(body.tool_name, row);
        return Promise.resolve(jsonResponse(row));
      }
      if (url.startsWith(`${SETTINGS_URL}/`) && method === "DELETE") {
        const id = url.slice(SETTINGS_URL.length + 1);
        for (const [name, row] of store) {
          if (row.id === id) {
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

const radioLabels = (row: HTMLElement) =>
  within(row)
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("value"));

/** The radio's accessible name carries its helper too, so pick by value. */
const radioByValue = (row: HTMLElement, value: string) => {
  const radio = within(row)
    .getAllByRole("radio")
    .find((candidate) => candidate.getAttribute("value") === value);
  if (!radio) {
    throw new Error(`No ${value} radio in the row`);
  }
  return radio;
};

const checkedRadio = (row: HTMLElement) =>
  within(row)
    .getAllByRole("radio")
    .find((radio) => (radio as HTMLInputElement).checked)
    ?.getAttribute("value");

const expectChecked = async (row: HTMLElement, value: string) => {
  await waitFor(() => {
    expect(checkedRadio(row)).toBe(value);
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("offeredDecisions", () => {
  it("always offers the policy default and Never, the rest by availability", () => {
    const all = { allowAlways: true, askAvailable: true };
    const none = { allowAlways: false, askAvailable: false };
    expect(offeredDecisions("ask", all)).toEqual(["allow", "ask", "never"]);
    expect(offeredDecisions("ask", none)).toEqual(["ask", "never"]);
    expect(offeredDecisions("auto", all)).toEqual(["allow", "ask", "never"]);
    expect(offeredDecisions("auto", none)).toEqual(["allow", "never"]);
    // Each flag only unlocks the option it stands for.
    expect(
      offeredDecisions("ask", { allowAlways: false, askAvailable: true }),
    ).toEqual(["ask", "never"]);
    expect(
      offeredDecisions("auto", { allowAlways: true, askAvailable: false }),
    ).toEqual(["allow", "never"]);
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
    // re-derives the annotations or the policy verdict.
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
          policy: "ask",
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
          policy: "auto",
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

  it("offers Allow, Ask and Never with the policy default marked as such", async () => {
    stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
    });

    renderSection();

    const asking = await rowFor("get_issue");
    expect(radioLabels(asking)).toEqual(["allow", "ask", "never"]);
    expect(radioByValue(asking, "allow")).toHaveAccessibleName(/^Allow /);
    expect(radioByValue(asking, "ask")).toHaveAccessibleName(
      /^Ask each time \(policy default\)/,
    );
    expect(radioByValue(asking, "ask")).toBeChecked();

    const unprompted = await rowFor("list_teams");
    expect(radioLabels(unprompted)).toEqual(["allow", "ask", "never"]);
    expect(radioByValue(unprompted, "allow")).toHaveAccessibleName(
      /^Allow \(policy default\)/,
    );
    expect(radioByValue(unprompted, "allow")).toBeChecked();
    expect(radioByValue(unprompted, "ask")).toHaveAccessibleName(
      /^Ask each time Asks you before every run, even where the policy would not\./,
    );
  });

  it("hides the options the deployment does not honor", async () => {
    stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
          tool({ name: "list_teams", title: "List teams", policy: "auto" }),
        ],
        { allowAlways: false, askAvailable: false },
      ),
    });

    renderSection();

    // A persistent grant is not honored, so a tool that asks cannot be
    // relaxed; an ask is not honored either, so a tool that runs unprompted
    // cannot be escalated. Denying stays available on both.
    const asking = await rowFor("get_issue");
    expect(radioLabels(asking)).toEqual(["ask", "never"]);
    const unprompted = await rowFor("list_teams");
    expect(radioLabels(unprompted)).toEqual(["allow", "never"]);
  });

  it("checks the effective state the backend reports, never the stored row", async () => {
    stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
          tool({ name: "update_issue", title: "Update issue", policy: "ask" }),
          tool({ name: "list_teams", title: "List teams", policy: "auto" }),
          tool({ name: "list_users", title: "List users", policy: "auto" }),
        ],
        { allowAlways: false, askAvailable: true },
      ),
      settings: [
        // A grant stored while the policy still honored it: the gate ignores
        // it now, so the row shows the policy default instead.
        setting(
          "get_issue",
          "always_allow",
          "00000000-0000-4000-8000-000000000001",
        ),
        setting(
          "update_issue",
          "denied",
          "00000000-0000-4000-8000-000000000002",
        ),
        // An ask on a tool the policy would run unprompted escalates it.
        setting("list_teams", "ask", "00000000-0000-4000-8000-000000000003"),
        // Another server's row must not leak into this roster.
        setting(
          "list_users",
          "denied",
          "00000000-0000-4000-8000-000000000004",
          "notion",
        ),
      ],
    });

    renderSection();

    await expectChecked(await rowFor("get_issue"), "ask");
    await expectChecked(await rowFor("update_issue"), "never");
    await expectChecked(await rowFor("list_teams"), "ask");
    await expectChecked(await rowFor("list_users"), "allow");
  });

  it("stores an ask on a tool the policy runs unprompted and reads the roster back", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
    });

    renderSection();
    const row = await rowFor("list_teams");
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);

    fireEvent.click(radioByValue(row, "ask"));

    await expectChecked(row, "ask");
    const [askCall] = callsTo(fetchMock, SETTINGS_URL, "POST");
    expect(JSON.parse(String(askCall[1]?.body))).toEqual({
      mcp_server_id: SERVER_ID,
      tool_name: "list_teams",
      decision: "ask",
    });
    expect(store.get("list_teams")?.decision).toBe("ask");
    // The checked state came from a fresh listing, not a local guess.
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(2);
  });

  it("round-trips never, allow and the policy default through the settings endpoints", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
      ]),
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(radioByValue(row, "never"));
    await expectChecked(row, "never");
    const [denyCall] = callsTo(fetchMock, SETTINGS_URL, "POST");
    expect(JSON.parse(String(denyCall[1]?.body))).toEqual({
      mcp_server_id: SERVER_ID,
      tool_name: "get_issue",
      decision: "denied",
    });
    expect(store.get("get_issue")?.decision).toBe("denied");

    // A flip between two stored decisions rewrites the row in place.
    fireEvent.click(radioByValue(row, "allow"));
    await expectChecked(row, "allow");
    const [, grantCall] = callsTo(fetchMock, SETTINGS_URL, "POST");
    expect(JSON.parse(String(grantCall[1]?.body))).toEqual({
      mcp_server_id: SERVER_ID,
      tool_name: "get_issue",
      decision: "always_allow",
    });
    expect(store.get("get_issue")?.decision).toBe("always_allow");
    const grantId = store.get("get_issue")?.id;

    // Back to the policy default deletes the row; the tool stays listed.
    fireEvent.click(radioByValue(row, "ask"));
    await expectChecked(row, "ask");
    expect(
      callsTo(fetchMock, `${SETTINGS_URL}/${grantId}`, "DELETE"),
    ).toHaveLength(1);
    expect(store.has("get_issue")).toBe(false);
    expect(await rowFor("get_issue")).toBeInTheDocument();
  });

  it("deletes the row when a tool that runs unprompted goes back to Allow", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
      settings: [
        setting("list_teams", "ask", "00000000-0000-4000-8000-000000000007"),
      ],
    });

    renderSection();
    const row = await rowFor("list_teams");
    await expectChecked(row, "ask");

    fireEvent.click(radioByValue(row, "allow"));

    await expectChecked(row, "allow");
    expect(
      callsTo(
        fetchMock,
        `${SETTINGS_URL}/00000000-0000-4000-8000-000000000007`,
        "DELETE",
      ),
    ).toHaveLength(1);
    expect(callsTo(fetchMock, SETTINGS_URL, "POST")).toHaveLength(0);
    expect(store.has("list_teams")).toBe(false);
  });

  it("denies over a stale grant instead of stacking a second row", async () => {
    const { store } = stubServer({
      tools: roster(
        [tool({ name: "get_issue", title: "Get issue", policy: "ask" })],
        { allowAlways: false },
      ),
      settings: [
        setting(
          "get_issue",
          "always_allow",
          "00000000-0000-4000-8000-000000000001",
        ),
      ],
    });

    renderSection();
    const row = await rowFor("get_issue");
    expect(radioLabels(row)).toEqual(["ask", "never"]);

    fireEvent.click(radioByValue(row, "never"));

    await expectChecked(row, "never");
    expect(store.get("get_issue")?.decision).toBe("denied");
    expect(store.get("get_issue")?.id).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
  });

  it("reports an unreachable server instead of an empty roster", async () => {
    stubServer({
      tools: {
        server_id: SERVER_ID,
        status: "FAILURE",
        allow_always: true,
        ask_available: true,
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
        ask_available: true,
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
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
      ]),
      createStatus: 400,
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(radioByValue(row, "allow"));

    expect(
      await screen.findByText(/Could not update the decision/),
    ).toBeInTheDocument();
    expect(checkedRadio(row)).toBe("ask");
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
