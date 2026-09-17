import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCompleteMcpServerOauth } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import {
  clearMcpAuthorization,
  useMcpAuthorizationStore,
} from "@/lib/mcpAuthorization";
import {
  getMcpOauthServerId,
  storeMcpOauthCallback,
} from "@/lib/mcpOauthCallback";

import { McpOauthCallbackBoundary } from "./McpOauthCallbackBoundary";

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useUserPreferencesFeature: () => ({ mcpServersTabEnabled: true }),
}));
vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchCompleteMcpServerOauth: vi.fn(),
  fetchListMcpServerTools: vi.fn(),
  fetchStartMcpServerOauth: vi.fn(),
  listMcpServersQuery: () => ({ queryKey: ["servers"] }),
  listMcpServerToolsQuery: () => ({ queryKey: ["tools"] }),
}));

function LocationProbe() {
  return <div data-testid="search">{useLocation().search}</div>;
}
function mount(search: string) {
  return render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[`/${search}`]}>
          <McpOauthCallbackBoundary>
            <div>Chat shell</div>
          </McpOauthCallbackBoundary>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}
afterEach(() => {
  cleanup();
  clearMcpAuthorization("sales");
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("MCP callback entry", () => {
  it("shows progress before chat loads, exchanges once under StrictMode, then opens settings", async () => {
    let complete!: () => void;
    vi.mocked(fetchCompleteMcpServerOauth).mockReturnValue(
      new Promise((resolve) => {
        complete = () => resolve({ connection_status: "SUCCESS" });
      }),
    );
    storeMcpOauthCallback(
      "https://provider.test/authorize?state=boundary",
      "sales",
    );
    mount(
      "?code=grant&state=boundary&iss=https%3A%2F%2Fissuer.test&keep=value",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Finishing connection to sales",
    );
    expect(screen.queryByText("Chat shell")).not.toBeInTheDocument();
    expect(fetchCompleteMcpServerOauth).toHaveBeenCalledTimes(1);
    complete();
    await screen.findByText("Chat shell");
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("connected");
    expect(screen.getByTestId("search")).toHaveTextContent(
      "keep=value&preferencesDialog=open&preferencesTab=serversTools&mcpServerId=sales",
    );
    expect(getMcpOauthServerId("boundary")).toBeNull();
  });

  it("recognizes a denied grant and removes provider error details from the URL", async () => {
    storeMcpOauthCallback(
      "https://provider.test/authorize?state=boundary-denied",
      "sales",
    );
    mount(
      "?error=access_denied&error_description=untrusted&state=boundary-denied&keep=value",
    );
    await screen.findByText("Chat shell");
    expect(useMcpAuthorizationStore.getState().phases.sales).toBe("denied");
    expect(fetchCompleteMcpServerOauth).not.toHaveBeenCalled();
    expect(screen.getByTestId("search").textContent).not.toContain("error");
    expect(screen.queryByText("untrusted")).not.toBeInTheDocument();
  });

  it("offers recovery for missing session storage without exchanging an unassociated grant", async () => {
    mount("?code=unknown&state=missing&keep=value");
    expect(screen.getByRole("alert")).toHaveTextContent("could not be matched");
    expect(fetchCompleteMcpServerOauth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent(
        "keep=value&preferencesDialog=open&preferencesTab=serversTools",
      ),
    );
    expect(screen.getByText("Chat shell")).toBeInTheDocument();
  });

  it("continues to handle legacy return URLs", async () => {
    vi.mocked(fetchCompleteMcpServerOauth).mockResolvedValue({
      connection_status: "SUCCESS",
    });
    mount("?code=code&state=boundary-legacy&mcpOauthServerId=sales");
    await screen.findByText("Chat shell");
    expect(fetchCompleteMcpServerOauth).toHaveBeenCalledTimes(1);
  });
});
