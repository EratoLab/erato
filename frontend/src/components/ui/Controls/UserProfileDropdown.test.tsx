import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { disclaimersSettingsHref } from "@/lib/disclaimersSettingsLink";

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

function DisclaimerLink() {
  const location = useLocation();
  return (
    <>
      <Link to={disclaimersSettingsHref(location)}>Read disclaimers</Link>
      <output>{`${location.pathname}${location.search}${location.hash}`}</output>
    </>
  );
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

describe("Disclaimers settings handoff", () => {
  it("selects Disclaimers on a direct load", async () => {
    renderCallback("?preferencesDialog=open&preferencesTab=disclaimers");
    expect(await screen.findByText("disclaimers")).toBeInTheDocument();
  });

  it("opens from an in-app link and preserves the page URL on close", async () => {
    render(
      <MemoryRouter initialEntries={["/chat?keep=value#footer"]}>
        <UserProfileDropdown onSignOut={vi.fn()} />
        <DisclaimerLink />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Read disclaimers" }));
    expect(await screen.findByText("disclaimers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      await screen.findByText("/chat?keep=value#footer"),
    ).toBeInTheDocument();
    expect(screen.queryByText("disclaimers")).toBeNull();
  });
});
