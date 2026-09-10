import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  storeMcpOauthCallback,
  getMcpOauthServerId,
} from "@/lib/mcpOauthCallback";

import { UserProfileDropdown } from "./UserProfileDropdown";

import type { UserPreferencesDialog } from "../Settings/UserPreferencesDialog";
import type { ComponentProps } from "react";

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAuthFeature: () => ({ showLogout: false }),
  useUserPreferencesFeature: () => ({ mcpServersTabEnabled: true }),
}));
vi.mock("./DropdownMenu", () => ({ DropdownMenu: () => null }));
vi.mock("../Settings/UserPreferencesDialog", () => ({
  UserPreferencesDialog: (
    props: ComponentProps<typeof UserPreferencesDialog>,
  ) =>
    props.isOpen ? (
      <div>
        <span>{props.initialTab}</span>
        <span>{props.pendingMcpOauthCallback?.serverId}</span>
        <button onClick={props.onMcpOauthCallbackHandled}>Complete</button>
        <button onClick={props.onClose}>Close</button>
      </div>
    ) : null,
}));

function LocationProbe() {
  return <div data-testid="search">{useLocation().search}</div>;
}

function renderCallback(search: string) {
  render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <UserProfileDropdown onSignOut={vi.fn()} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("MCP OAuth settings callback", () => {
  beforeEach(() => sessionStorage.clear());

  it.each(["Complete", "Close"])(
    "opens the server tab from state and clears on %s",
    async (action) => {
      storeMcpOauthCallback(
        "https://auth.example/authorize?state=flow",
        "sales",
      );
      renderCallback("?code=code&state=flow&iss=issuer&keep=value");
      expect(await screen.findByText("serversTools")).toBeInTheDocument();
      expect(screen.getByText("sales")).toBeInTheDocument();
      fireEvent.click(screen.getByText(action));
      await waitFor(() =>
        expect(screen.getByTestId("search")).toHaveTextContent("?keep=value"),
      );
      expect(getMcpOauthServerId("flow")).toBeNull();
      if (action === "Complete") {
        expect(screen.getByText("serversTools")).toBeInTheDocument();
      } else {
        expect(screen.queryByText("serversTools")).not.toBeInTheDocument();
      }
    },
  );

  it("ignores callbacks with an unknown state", () => {
    renderCallback("?code=code&state=unknown");
    expect(screen.queryByText("serversTools")).not.toBeInTheDocument();
  });

  it("still handles legacy callbacks", async () => {
    renderCallback(
      "?preferencesDialog=open&preferencesTab=mcpServers&mcpOauthServerId=sales&code=code&state=legacy",
    );
    expect(await screen.findByText("serversTools")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
  });
});
