import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMcpAuthorization,
  useMcpAuthorizationStore,
} from "@/lib/mcpAuthorization";

import { McpAuthorizationToasts } from "./mcpAuthorizationToasts";
import { toast, Toaster } from "../Toast";

let client: QueryClient;

/** The app shell without any settings surface mounted. */
function shell() {
  return (
    <QueryClientProvider client={client}>
      <Toaster />
      <McpAuthorizationToasts />
    </QueryClientProvider>
  );
}

const setPhase = (phase: string, browserUrl?: string) =>
  act(() => {
    useMcpAuthorizationStore.setState({
      phases: { sales: phase as never },
      browserUrls: { sales: browserUrl },
    });
  });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  for (const id of Object.keys(useMcpAuthorizationStore.getState().phases))
    clearMcpAuthorization(id);
  useMcpAuthorizationStore.setState({ phases: {}, browserUrls: {} });
  toast.clear();
  client.clear();
  vi.restoreAllMocks();
});

describe("MCP authorization toasts", () => {
  it("answers a wait that outlives the settings surface it started in", () => {
    render(shell());
    setPhase("waiting", "https://example.test/authorize");
    expect(screen.getByText("Waiting for authorization")).toBeInTheDocument();

    // No pane is mounted — the browser finished the grant while the user was
    // somewhere else entirely, and the outcome still has to reach them.
    setPhase("connected");
    expect(
      screen.queryByText("Waiting for authorization"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Authorization complete")).toBeInTheDocument();
  });

  it("keeps one slot per server rather than stacking a history", () => {
    render(shell());
    setPhase("waiting", "https://example.test/authorize");
    setPhase("timeout");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(
      screen.getByText("The connection has not been confirmed yet"),
    ).toBeInTheDocument();
  });

  it("says nothing for phases the row already carries", () => {
    render(shell());
    setPhase("starting");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    setPhase("finishing");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("withholds the reopen link where no browser handoff happened", () => {
    render(shell());
    // A full-page redirect has already left this document; there is nothing to
    // reopen and nobody left here to read it.
    setPhase("waiting");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("retracts a phase the app clears from under it", () => {
    render(shell());
    setPhase("denied");
    expect(
      screen.getByText("Authorization was not granted"),
    ).toBeInTheDocument();
    act(() => clearMcpAuthorization("sales"));
    expect(
      screen.queryByText("Authorization was not granted"),
    ).not.toBeInTheDocument();
  });

  it("does not let a replaced notice abort the operation that replaced it", () => {
    render(shell());
    setPhase("timeout");
    // Taking over the slot retires the previous descriptor, which runs its
    // onDismiss. Unfenced, that would cancel the retry now in flight.
    setPhase("waiting", "https://example.test/authorize");
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("waiting");
    expect(screen.getByText("Waiting for authorization")).toBeInTheDocument();
  });

  it("clears the runtime state when the user dismisses the notice itself", async () => {
    render(shell());
    setPhase("timeout");
    await act(async () => {
      screen.getByRole("button", { name: /Dismiss/i }).click();
      // The item plays out before it leaves the store.
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(useMcpAuthorizationStore.getState().phases.sales).toBeUndefined();
  });
});
