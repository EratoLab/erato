import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { useMcpBrowserAuthorization } from "@/hooks/ui/useMcpBrowserAuthorization";
import {
  fetchListMcpServerTools,
  listMcpServersQuery,
  listMcpServerToolsQuery,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  clearMcpAuthorization,
  useMcpAuthorizationStore,
  watchMcpAuthorization,
} from "@/lib/mcpAuthorization";

import { ServersToolsPane } from "./ServersToolsPane";
import { McpAuthorizationToasts } from "./mcpAuthorizationToasts";
import { toast, Toaster } from "../Toast";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const { mockServers } = vi.hoisted(() => ({ mockServers: vi.fn() }));
vi.mock(
  "@/lib/generated/v1betaApi/v1betaApiComponents",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/lib/generated/v1betaApi/v1betaApiComponents")
    >()),
    useListMcpServers: mockServers,
    fetchListMcpServerTools: vi.fn(),
  }),
);
vi.mock("./McpToolApprovalSettings", () => ({
  McpToolApprovalSettings: () => null,
}));
vi.mock("./DesktopSidecarTabContent", () => ({
  DesktopSidecarRow: () => null,
}));

const sales: McpServerStatus = {
  id: "sales",
  authentication_mode: "oauth2",
  connection_status: "NEEDS_AUTHENTICATION",
};
// Auto-dismiss plus the exit animation the item plays before it is removed.
const TOAST_LIFETIME_MS = 5_000 + 150;
let client: QueryClient;
function servers(rows: McpServerStatus[], isFetching = false) {
  mockServers.mockReturnValue({
    data: { servers: rows },
    isLoading: false,
    isFetching,
  });
}
function Pane() {
  const onAuthorize = useMcpBrowserAuthorization();
  return (
    <ServersToolsPane isActive mcp={{ onAuthorize, onDisconnect: vi.fn() }} />
  );
}
function tree() {
  return (
    <ThemeProvider persistThemeMode={false} enableCustomTheme={false}>
      <QueryClientProvider client={client}>
        <Pane />
        {/* Both live at the app root in every host: outcomes are ordinary
            toasts, announced from outside the pane so that closing settings
            mid-flow cannot strand them. */}
        <Toaster />
        <McpAuthorizationToasts />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  servers([sales]);
  vi.mocked(fetchListMcpServerTools).mockResolvedValue({
    status: "NEEDS_AUTHENTICATION",
    server_id: "sales",
    tools: [],
    allow_always: false,
    ask_available: false,
  });
});
afterEach(() => {
  cleanup();
  for (const id of Object.keys(useMcpAuthorizationStore.getState().phases))
    clearMcpAuthorization(id);
  useMcpAuthorizationStore.setState({ phases: {}, browserUrls: {} });
  toast.clear();
  client.clear();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("MCP authorization feedback in server settings", () => {
  it("offers a real recovery link when opening the browser returns null, without restarting the wait", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    render(tree());
    fireEvent.click(screen.getByRole("button", { name: "Authorize" }));
    expect(open).toHaveBeenCalledTimes(1);
    // The button keeps its own label and reports the wait as a busy control.
    const authorize = screen.getByRole("button", { name: "Authorize" });
    expect(authorize).toBeDisabled();
    expect(authorize).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("servers-tools-mcp-row")).toHaveTextContent(
      "Connection in progress",
    );
    const link = screen.getByRole("link", {
      name: "Open authorization page again",
    });
    expect(link).toHaveAttribute("href", open.mock.calls[0][0]);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // jsdom cannot open a native link; exercise the click without navigating.
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("waiting");
    // Leaving to authorize must not retract the toast the user comes back to.
    expect(
      screen.getByRole("link", { name: "Open authorization page again" }),
    ).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Stop waiting" }));
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchListMcpServerTools).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a server it cannot show, and removes its runtime state", () => {
    useMcpAuthorizationStore.setState({
      phases: { "not-a-real-server": "connected" },
    });
    render(tree());
    expect(screen.getAllByTestId("servers-tools-mcp-row")).toHaveLength(1);
    expect(screen.queryByText("not-a-real-server")).not.toBeInTheDocument();
    expect(screen.queryByText(/ready to use/)).not.toBeInTheDocument();
    expect(
      useMcpAuthorizationStore.getState().phases["not-a-real-server"],
    ).toBeUndefined();
  });

  it("withdraws a success confirmation when newer server data contradicts it", () => {
    servers([{ ...sales, connection_status: "SUCCESS" }]);
    useMcpAuthorizationStore.setState({ phases: { sales: "connected" } });
    const view = render(tree());
    expect(screen.getByText("Authorization complete")).toBeInTheDocument();
    servers([{ ...sales, connection_status: "FAILURE" }]);
    view.rerender(tree());
    expect(
      screen.queryByText("Authorization complete"),
    ).not.toBeInTheDocument();
    expect(useMcpAuthorizationStore.getState().phases.sales).toBeUndefined();
  });

  it("clears the transient success confirmation while keeping the server row", async () => {
    servers([{ ...sales, connection_status: "SUCCESS" }]);
    useMcpAuthorizationStore.setState({ phases: { sales: "connected" } });
    render(tree());
    expect(screen.getByText("The server is ready to use.")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(TOAST_LIFETIME_MS));
    expect(screen.queryByText(/ready to use/)).not.toBeInTheDocument();
    expect(screen.getByTestId("servers-tools-mcp-row")).toHaveTextContent(
      "Connected",
    );
    expect(useMcpAuthorizationStore.getState().phases.sales).toBeUndefined();
  });

  it("keeps a pending operation until the authoritative server list finishes refreshing", async () => {
    watchMcpAuthorization(client, "sales", () => {});
    servers([], true);
    const view = render(tree());
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("waiting");
    servers([]);
    view.rerender(tree());
    expect(useMcpAuthorizationStore.getState().phases.sales).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(fetchListMcpServerTools).not.toHaveBeenCalled();
  });

  it("does not let a dismissed confirmation cancel a subsequent authorization", async () => {
    servers([{ ...sales, connection_status: "SUCCESS" }]);
    useMcpAuthorizationStore.setState({ phases: { sales: "connected" } });
    render(tree());
    act(() => watchMcpAuthorization(client, "sales", () => {}));
    await act(() => vi.advanceTimersByTimeAsync(TOAST_LIFETIME_MS));
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("waiting");
  });

  it("uses the same generated cache keys with and without host auth headers", () => {
    expect(
      listMcpServersQuery({ headers: { Authorization: "Bearer example" } })
        .queryKey,
    ).toEqual(listMcpServersQuery({}).queryKey);
    expect(
      listMcpServerToolsQuery({
        headers: { Authorization: "Bearer example" },
        pathParams: { serverId: "sales" },
      }).queryKey,
    ).toEqual(
      listMcpServerToolsQuery({ pathParams: { serverId: "sales" } }).queryKey,
    );
  });
});
