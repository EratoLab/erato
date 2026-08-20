import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { McpServerSelector } from "./McpServerSelector";

import type { McpServerStatus } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const servers: McpServerStatus[] = [
  {
    id: "search-server",
    authentication_mode: "none",
    connection_status: "SUCCESS",
  },
  {
    id: "oauth-server",
    authentication_mode: "oauth2",
    connection_status: "NEEDS_AUTHENTICATION",
  },
  {
    id: "broken-server",
    authentication_mode: "none",
    connection_status: "FAILURE",
  },
];

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
};

function renderSelector(
  props: Partial<React.ComponentProps<typeof McpServerSelector>> = {},
) {
  const onSelectionChange = vi.fn();
  const result = render(
    <MemoryRouter>
      <McpServerSelector
        servers={servers}
        selectedServerIds={[]}
        onSelectionChange={onSelectionChange}
        {...props}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { onSelectionChange, ...result };
}

describe("McpServerSelector", () => {
  it("renders each server with its per-user connection status", () => {
    renderSelector();

    expect(
      screen.getByRole("checkbox", { name: "search-server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "oauth-server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "broken-server" }),
    ).toBeInTheDocument();

    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Requires connection")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("communicates that an empty selection means all servers", () => {
    renderSelector();

    expect(screen.getByTestId("mcp-server-selector-summary")).toHaveTextContent(
      "No servers selected — this assistant can use every server available to the person chatting with it.",
    );
  });

  it("switches to the restricted summary once a server is selected", () => {
    renderSelector({ selectedServerIds: ["search-server"] });

    expect(screen.getByTestId("mcp-server-selector-summary")).toHaveTextContent(
      "This assistant can only use the selected servers.",
    );
  });

  it("keeps selection output in backend listing order", () => {
    const { onSelectionChange } = renderSelector({
      selectedServerIds: ["oauth-server"],
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "search-server" }));

    expect(onSelectionChange).toHaveBeenCalledWith([
      "search-server",
      "oauth-server",
    ]);
  });

  it("deselects a selected server on toggle", () => {
    const { onSelectionChange } = renderSelector({
      selectedServerIds: ["search-server", "oauth-server"],
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "search-server" }));

    expect(onSelectionChange).toHaveBeenCalledWith(["oauth-server"]);
  });

  it("keeps a needs-authentication server selectable", () => {
    const { onSelectionChange } = renderSelector();

    const checkbox = screen.getByRole("checkbox", { name: "oauth-server" });
    expect(checkbox).toBeEnabled();

    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalledWith(["oauth-server"]);
  });

  it("opens the settings dialog on the servers tab from the connect affordance", () => {
    renderSelector();

    fireEvent.click(screen.getByTestId("mcp-server-connect-oauth-server"));

    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "?preferencesDialog=open&preferencesTab=serversTools",
    );
  });

  it("disables an unavailable server that is not selected", () => {
    renderSelector();

    expect(
      screen.getByRole("checkbox", { name: "broken-server" }),
    ).toBeDisabled();
  });

  it("keeps an already-attached unavailable server deselectable", () => {
    const { onSelectionChange } = renderSelector({
      selectedServerIds: ["broken-server"],
    });

    const checkbox = screen.getByRole("checkbox", { name: "broken-server" });
    expect(checkbox).toBeEnabled();

    fireEvent.click(checkbox);
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});
