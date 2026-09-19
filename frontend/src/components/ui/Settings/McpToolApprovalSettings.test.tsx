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

import { EntityRow } from "./EntityRow";
import { McpToolApprovalSettings } from "./McpToolApprovalSettings";

import type {
  ApplyUserToolApprovalSettingsBatchRequest,
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
const BATCH_URL = `${SETTINGS_URL}/batch`;

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
  description_truncated: false,
  ...overrides,
});

const writeTool = (overrides: Partial<McpServerTool>): McpServerTool =>
  tool({
    annotations: {
      read_only_hint: false,
      destructive_hint: true,
      idempotent_hint: false,
      open_world_hint: false,
      annotated: true,
    },
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

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Lets a test hold a request open and settle it by hand. */
const deferred = () => {
  let resolve: (response: Response) => void = () => {};
  let reject: (reason: Error) => void = () => {};
  const promise = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * A fetch stand-in that keeps a tiny settings store and, like the backend,
 * projects it onto the roster: every listing carries the stored decision and
 * the effective state the gate would apply. The batch endpoint writes every
 * entry in one go — a null decision drops the row — and answers with the
 * rows it holds, never with the roster.
 */
const stubServer = ({
  tools,
  settings = [],
  batchStatus = 200,
  holdBatch = false,
}: {
  tools: ListMcpServerToolsResponse;
  settings?: [string, UserToolDecision][];
  batchStatus?: number;
  holdBatch?: boolean;
}) => {
  const store = new Map<string, UserToolDecision>(settings);
  const held = deferred();
  const project = (listed: McpServerTool): McpServerTool => {
    const decision = store.get(listed.name);
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
  const rows = (): UserToolApprovalSetting[] =>
    [...store.entries()].map(([toolName, decision], index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      mcp_server_id: SERVER_ID,
      tool_name: toolName,
      decision,
    }));
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
        return Promise.resolve(jsonResponse({ settings: rows() }));
      }
      if (url === BATCH_URL && method === "PUT") {
        if (batchStatus !== 200) {
          return Promise.resolve(
            new Response("Always allow is disabled by MCP approval policy", {
              status: batchStatus,
            }),
          );
        }
        const body = JSON.parse(
          String(init?.body),
        ) as ApplyUserToolApprovalSettingsBatchRequest;
        for (const entry of body.decisions) {
          if (entry.decision === null || entry.decision === undefined) {
            store.delete(entry.tool_name);
          } else {
            store.set(entry.tool_name, entry.decision);
          }
        }
        const response = jsonResponse({ settings: rows() });
        if (holdBatch) {
          return held.promise.then(() => response);
        }
        return Promise.resolve(response);
      }
      return Promise.reject(new Error(`Unexpected request: ${method} ${url}`));
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, store, releaseBatch: () => held.resolve(new Response()) };
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

const batchBodies = (fetchMock: ReturnType<typeof stubServer>["fetchMock"]) =>
  callsTo(fetchMock, BATCH_URL, "PUT").map(
    ([, init]) =>
      JSON.parse(
        String(init?.body),
      ) as ApplyUserToolApprovalSettingsBatchRequest,
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

const radioByValue = (row: HTMLElement, value: string) => {
  const radio = within(row)
    .getAllByRole("radio")
    .find((candidate) => candidate.dataset.decision === value);
  if (!radio) {
    throw new Error(`No ${value} radio in the row`);
  }
  return radio;
};

const checkedRadio = (row: HTMLElement) =>
  within(row)
    .getAllByRole("radio")
    .find((radio) => radio.getAttribute("aria-checked") === "true")?.dataset
    .decision;

const expectChecked = async (row: HTMLElement, value: string) => {
  await waitFor(() => {
    expect(checkedRadio(row)).toBe(value);
  });
};

const groupFor = (key: string) => {
  const group = screen
    .getAllByTestId("mcp-tool-group")
    .find((candidate) => candidate.dataset.toolGroup === key);
  if (!group) {
    throw new Error(`No ${key} group`);
  }
  return group;
};

/** The group's decision menu trigger, named after the group and its state. */
const groupTrigger = (key: string) =>
  within(groupFor(key)).getByRole("button", { name: /:/ });

const chooseForGroup = async (key: string, itemName: RegExp) => {
  // A previous choice may still be closing its menu and settling its batch;
  // the items are locked until then.
  await waitFor(() => {
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("radiogroup", { busy: true })).toBeNull();
  });
  fireEvent.click(groupTrigger(key));
  fireEvent.click(await screen.findByRole("menuitem", { name: itemName }));
};

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("groups the roster by the annotation class the backend reports, with counts", async () => {
    // The unannotated tool is a write tool under protocol defaults and keeps
    // its pill; the badge list is rendered straight from the response.
    stubServer({
      tools: roster([
        writeTool({ name: "copy_file", title: "Copy file", policy: "ask" }),
        tool({
          name: "get_issue",
          title: "Get issue",
          description: "Fetch one issue by id.",
          policy: "auto",
        }),
        writeTool({
          name: "mystery",
          title: "mystery",
          annotations: {
            read_only_hint: false,
            destructive_hint: false,
            idempotent_hint: false,
            open_world_hint: true,
            annotated: false,
          },
          policy: "ask",
        }),
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
    });

    renderSection();
    await rowFor("get_issue");

    expect(
      screen.getByRole("heading", { name: "Tool permissions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Choose when the assistant may use these tools."),
    ).toBeInTheDocument();

    const groups = screen.getAllByTestId("mcp-tool-group");
    expect(groups.map((group) => group.dataset.toolGroup)).toEqual([
      "readOnly",
      "write",
    ]);
    const readOnlyToggle = within(groups[0]).getByRole("button", {
      name: "Read-only tools 2",
    });
    expect(readOnlyToggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(groups[1]).getByRole("button", { name: "Write/delete tools 2" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(groups[0])
        .getAllByTestId("mcp-tool-approval-row")
        .map((row) => row.dataset.toolName),
    ).toEqual(["get_issue", "list_teams"]);
    expect(
      within(groups[1])
        .getAllByTestId("mcp-tool-approval-row")
        .map((row) => row.dataset.toolName),
    ).toEqual(["copy_file", "mystery"]);

    const mystery = await rowFor("mystery");
    expect(
      within(mystery)
        .getAllByRole("listitem")
        .map((badge) => badge.textContent),
    ).toEqual([
      "Can modify",
      "Reaches other systems",
      "Not declared by the server",
      "Asks before running",
    ]);

    // Closing a group takes its rows out; the other group stays.
    fireEvent.click(readOnlyToggle);
    expect(readOnlyToggle).toHaveAttribute("aria-expanded", "false");
    expect(
      screen
        .getAllByTestId("mcp-tool-approval-row")
        .map((row) => row.dataset.toolName),
    ).toEqual(["copy_file", "mystery"]);
  });

  it("checks the effective state the backend reports and disables what the deployment does not store", async () => {
    stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
          tool({ name: "update_issue", title: "Update issue", policy: "ask" }),
          tool({ name: "list_teams", title: "List teams", policy: "auto" }),
        ],
        { allowAlways: false, askAvailable: true },
      ),
      settings: [
        // A grant stored while the policy still honored it: the gate ignores
        // it now, so the row shows the policy default instead.
        ["get_issue", "always_allow"],
        ["update_issue", "denied"],
        // An ask on a tool the policy would run unprompted escalates it.
        ["list_teams", "ask"],
      ],
    });

    renderSection();

    const getIssue = await rowFor("get_issue");
    await expectChecked(getIssue, "ask");
    expect(radioByValue(getIssue, "allow")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(radioByValue(getIssue, "ask")).toHaveAccessibleName(
      "Ask each time (policy default)",
    );
    await expectChecked(await rowFor("update_issue"), "never");
    const listTeams = await rowFor("list_teams");
    await expectChecked(listTeams, "ask");
    expect(radioByValue(listTeams, "allow")).toHaveAccessibleName(
      "Always allow (policy default)",
    );
    expect(radioByValue(listTeams, "allow")).not.toHaveAttribute(
      "aria-disabled",
    );
  });

  it("stores a row decision through the batch endpoint, shows it at once and reads the roster back", async () => {
    const { fetchMock, store, releaseBatch } = stubServer({
      tools: roster([
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
      holdBatch: true,
    });

    renderSection();
    const row = await rowFor("list_teams");
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);

    fireEvent.click(radioByValue(row, "ask"));

    // Optimistic: checked before the server has answered, controls locked.
    await expectChecked(row, "ask");
    expect(within(row).getByRole("radiogroup")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(batchBodies(fetchMock)).toEqual([
      {
        mcp_server_id: SERVER_ID,
        decisions: [{ tool_name: "list_teams", decision: "ask" }],
      },
    ]);
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);

    releaseBatch();

    await waitFor(() => {
      expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(within(row).getByRole("radiogroup")).not.toHaveAttribute(
        "aria-busy",
      );
    });
    expect(store.get("list_teams")).toBe("ask");
    expect(checkedRadio(row)).toBe("ask");
  });

  it("round-trips never, allow and the policy default; the default clears the row", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
      ]),
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(radioByValue(row, "never"));
    await expectChecked(row, "never");
    await waitFor(() => {
      expect(store.get("get_issue")).toBe("denied");
    });

    fireEvent.click(radioByValue(row, "allow"));
    await expectChecked(row, "allow");
    await waitFor(() => {
      expect(store.get("get_issue")).toBe("always_allow");
    });

    fireEvent.click(radioByValue(row, "ask"));
    await expectChecked(row, "ask");
    await waitFor(() => {
      expect(store.has("get_issue")).toBe(false);
    });

    expect(batchBodies(fetchMock).map((body) => body.decisions)).toEqual([
      [{ tool_name: "get_issue", decision: "denied" }],
      [{ tool_name: "get_issue", decision: "always_allow" }],
      [{ tool_name: "get_issue", decision: null }],
    ]);
    expect(await rowFor("get_issue")).toBeInTheDocument();
  });

  it("applies a group decision in one batch and shows the group as Mixed or common", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
        writeTool({ name: "copy_file", title: "Copy file", policy: "ask" }),
      ]),
    });

    renderSection();
    await rowFor("get_issue");

    // One asks, one allows: no common state yet.
    expect(
      within(groupFor("readOnly")).getByRole("button", {
        name: "Read-only tools: Mixed",
      }),
    ).toBeInTheDocument();
    expect(
      within(groupFor("write")).getByRole("button", {
        name: "Write/delete tools: Ask each time",
      }),
    ).toBeInTheDocument();

    await chooseForGroup("readOnly", /^Never allow/);

    await expectChecked(await rowFor("get_issue"), "never");
    await expectChecked(await rowFor("list_teams"), "never");
    expect(checkedRadio(await rowFor("copy_file"))).toBe("ask");
    expect(batchBodies(fetchMock)).toEqual([
      {
        mcp_server_id: SERVER_ID,
        decisions: [
          { tool_name: "get_issue", decision: "denied" },
          { tool_name: "list_teams", decision: "denied" },
        ],
      },
    ]);
    await waitFor(() => {
      expect(store.get("list_teams")).toBe("denied");
    });
    expect(
      await within(groupFor("readOnly")).findByRole("button", {
        name: "Read-only tools: Never allow",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("maps a group state to each tool's own row and clears rows on the policy default", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
      settings: [
        ["get_issue", "denied"],
        ["list_teams", "denied"],
      ],
    });

    renderSection();
    await expectChecked(await rowFor("get_issue"), "never");

    // Allow is the policy default for one tool and a grant for the other.
    await chooseForGroup("readOnly", /^Always allow/);
    await expectChecked(await rowFor("get_issue"), "allow");
    await expectChecked(await rowFor("list_teams"), "allow");
    await waitFor(() => {
      expect(store.get("get_issue")).toBe("always_allow");
    });
    expect(store.has("list_teams")).toBe(false);

    await chooseForGroup("readOnly", /^Policy default/);
    await expectChecked(await rowFor("get_issue"), "ask");
    await waitFor(() => {
      expect(store.has("get_issue")).toBe(false);
    });

    expect(batchBodies(fetchMock).map((body) => body.decisions)).toEqual([
      [
        { tool_name: "get_issue", decision: "always_allow" },
        { tool_name: "list_teams", decision: null },
      ],
      [{ tool_name: "get_issue", decision: null }],
    ]);
  });

  it("forgets a stored grant the policy no longer honors on the group's policy default", async () => {
    const { fetchMock, store } = stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
          tool({ name: "list_teams", title: "List teams", policy: "auto" }),
        ],
        { allowAlways: false, askAvailable: true },
      ),
      // The row reads as the policy default already, so only the batch can
      // show the grant is gone rather than waiting to come back live.
      settings: [["get_issue", "always_allow"]],
    });

    renderSection();
    const getIssue = await rowFor("get_issue");
    await expectChecked(getIssue, "ask");
    expect(
      within(groupFor("readOnly")).getByRole("button", {
        name: "Read-only tools: Mixed",
      }),
    ).toBeInTheDocument();

    await chooseForGroup("readOnly", /^Policy default/);

    await waitFor(() => {
      expect(store.has("get_issue")).toBe(false);
    });
    expect(batchBodies(fetchMock)).toEqual([
      {
        mcp_server_id: SERVER_ID,
        decisions: [{ tool_name: "get_issue", decision: null }],
      },
    ]);
    await expectChecked(await rowFor("get_issue"), "ask");
    expect(checkedRadio(await rowFor("list_teams"))).toBe("allow");
  });

  it("skips the tools a group state is unavailable for and says so for a while", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { fetchMock } = stubServer({
        tools: roster(
          [
            tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
            tool({ name: "list_teams", title: "List teams", policy: "auto" }),
            tool({ name: "list_users", title: "List users", policy: "auto" }),
          ],
          { allowAlways: false, askAvailable: true },
        ),
        settings: [["list_teams", "ask"]],
      });

      renderSection();
      await rowFor("get_issue");

      await chooseForGroup("readOnly", /^Always allow/);

      // The asking tool cannot be granted; the others go back to allowing.
      await expectChecked(await rowFor("list_teams"), "allow");
      expect(checkedRadio(await rowFor("get_issue"))).toBe("ask");
      expect(batchBodies(fetchMock)).toEqual([
        {
          mcp_server_id: SERVER_ID,
          decisions: [{ tool_name: "list_teams", decision: null }],
        },
      ]);
      const note = await screen.findByRole("status");
      expect(note).toHaveTextContent(
        "1 tool skipped: Always allow is switched off by the approval policy.",
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6500);
      });
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers a group state as unavailable when no tool in the group can take it", async () => {
    stubServer({
      tools: roster(
        [
          tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
          tool({ name: "update_issue", title: "Update issue", policy: "ask" }),
        ],
        { allowAlways: false, askAvailable: true },
      ),
    });

    renderSection();
    await rowFor("get_issue");

    fireEvent.click(groupTrigger("readOnly"));
    const allow = await screen.findByRole("menuitem", {
      name: /^Always allow/,
    });
    expect(allow).toBeDisabled();
    expect(allow).toHaveTextContent(
      "Always allow is switched off by the approval policy.",
    );
    expect(
      screen.getByRole("menuitem", { name: /^Never allow/ }),
    ).toBeEnabled();
  });

  it("rolls the roster back and reports when the batch is rejected", async () => {
    const { fetchMock } = stubServer({
      tools: roster([
        tool({ name: "get_issue", title: "Get issue", policy: "ask" }),
        tool({ name: "list_teams", title: "List teams", policy: "auto" }),
      ]),
      batchStatus: 400,
    });

    renderSection();
    const row = await rowFor("get_issue");

    fireEvent.click(radioByValue(row, "allow"));

    expect(
      await screen.findByText(/Could not update the decision/),
    ).toBeInTheDocument();
    await expectChecked(row, "ask");
    expect(callsTo(fetchMock, BATCH_URL, "PUT")).toHaveLength(1);
    // Nothing was read back: the previous listing is what came back.
    expect(callsTo(fetchMock, TOOLS_URL)).toHaveLength(1);

    // A group decision rolls back the same way.
    await chooseForGroup("readOnly", /^Never allow/);
    await waitFor(() => {
      expect(callsTo(fetchMock, BATCH_URL, "PUT")).toHaveLength(2);
    });
    await expectChecked(await rowFor("get_issue"), "ask");
    await expectChecked(await rowFor("list_teams"), "allow");
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
