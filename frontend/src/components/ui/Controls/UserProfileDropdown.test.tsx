import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
        <span>{props.selectedMcpServerId}</span>
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

describe("MCP settings handoff", () => {
  it("opens the selected server and cleans only settings parameters on close", async () => {
    renderCallback(
      "?preferencesDialog=open&preferencesTab=serversTools&mcpServerId=sales&keep=value",
    );
    expect(await screen.findByText("serversTools")).toBeInTheDocument();
    expect(screen.getByText("sales")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Close"));
    await waitFor(() =>
      expect(screen.getByTestId("search")).toHaveTextContent("?keep=value"),
    );
    expect(screen.queryByText("serversTools")).not.toBeInTheDocument();
  });
  it("still opens the legacy MCP settings tab", async () => {
    renderCallback("?preferencesDialog=open&preferencesTab=mcpServers");
    expect(await screen.findByText("serversTools")).toBeInTheDocument();
  });
});
