import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { FacetSelector } from "../FacetSelector";
import { buildAssistantMentionSection } from "../assistantMentionSection";
import { buildMcpToolsSection } from "../mcpToolsSection";

import type {
  FacetInfo,
  McpServerStatus,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const WEB_SEARCH: FacetInfo = {
  id: "facet-1",
  display_name: "Web search",
  default_enabled: false,
};

const RESEARCHER = { id: "assistant-research", name: "Researcher" };

function renderSelector({
  facets = [] as FacetInfo[],
  toolsDisabled = false,
  keepOpenOnSelect = false,
  onSelect = vi.fn(),
  onBrowse = vi.fn(),
  onSelectionChange = vi.fn(),
  withAssistants = true,
  withConnectors = false,
  writeToolsEnabled = true,
  onToggleWriteTools = vi.fn(),
  servers = [] as McpServerStatus[],
  disabledServerIds = [] as string[],
  onToggleServer = vi.fn(),
} = {}) {
  render(
    <FacetSelector
      facets={facets}
      selectedFacetIds={[]}
      onSelectionChange={onSelectionChange}
      onlySingleFacet={false}
      showFacetIndicatorWithDisplayName={false}
      toolsDisabled={toolsDisabled}
      keepOpenOnSelect={keepOpenOnSelect}
      assistantSection={
        withAssistants
          ? buildAssistantMentionSection({
              assistants: [RESEARCHER],
              onSelect,
              onBrowse,
            })
          : undefined
      }
      mcpToolsSection={
        withConnectors
          ? buildMcpToolsSection({
              writeToolsEnabled,
              onToggleWriteTools,
              onBrowse: vi.fn(),
              servers,
              disabledServerIds,
              onToggleServer,
            })
          : undefined
      }
    />,
  );
  return {
    onSelect,
    onBrowse,
    onSelectionChange,
    onToggleWriteTools,
    onToggleServer,
  };
}

describe("FacetSelector", () => {
  it("closes after selecting a facet by default", async () => {
    const { onSelectionChange } = renderSelector({ facets: [WEB_SEARCH] });
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Web search" }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith([WEB_SEARCH.id]);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it.each([false, true])(
    "keeps facet toggles open while respecting single selection = %s",
    async (onlySingleFacet) => {
      const secondFacet = {
        ...WEB_SEARCH,
        id: "facet-2",
        display_name: "Research",
      };
      function Selector() {
        const [selectedFacetIds, setSelectedFacetIds] = useState<string[]>([]);
        return (
          <FacetSelector
            facets={[WEB_SEARCH, secondFacet]}
            selectedFacetIds={selectedFacetIds}
            onSelectionChange={setSelectedFacetIds}
            onlySingleFacet={onlySingleFacet}
            showFacetIndicatorWithDisplayName={false}
            keepOpenOnSelect
          />
        );
      }
      render(<Selector />);
      const trigger = screen.getByRole("button", { name: "Open menu" });
      fireEvent.click(trigger);
      const webSearch = await screen.findByRole("menuitem", {
        name: "Web search",
      });
      vi.useFakeTimers();
      try {
        fireEvent.click(webSearch);
        act(() => vi.advanceTimersByTime(200));
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(
          screen.getByTestId(`selected-facet-${WEB_SEARCH.id}`),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole("menuitem", { name: "Research" }));
        act(() => vi.advanceTimersByTime(200));
        expect(
          screen.getByTestId(`selected-facet-${secondFacet.id}`),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId(`selected-facet-${WEB_SEARCH.id}`) !== null,
        ).toBe(!onlySingleFacet);
        fireEvent.click(screen.getByRole("menuitem", { name: "Research" }));
        act(() => vi.advanceTimersByTime(200));
        expect(
          screen.queryByTestId(`selected-facet-${secondFacet.id}`),
        ).not.toBeInTheDocument();
        expect(screen.getByRole("menu")).toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
        expect(trigger).toHaveAttribute("aria-expanded", "false");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each([
    { global: false, own: true, labelled: true },
    { global: true, own: false, labelled: false },
    { global: true, own: undefined, labelled: true },
    { global: false, own: undefined, labelled: false },
  ])(
    "labels a selected facet's chip by its own setting before the global one: %o",
    ({ global, own, labelled }) => {
      const facet: FacetInfo = {
        ...WEB_SEARCH,
        show_indicator_with_display_name: own,
      };
      render(
        <FacetSelector
          facets={[facet]}
          selectedFacetIds={[facet.id]}
          onSelectionChange={vi.fn()}
          onlySingleFacet={false}
          showFacetIndicatorWithDisplayName={global}
        />,
      );

      const chip = screen.getByTestId(`selected-facet-${facet.id}`);
      expect(chip.textContent?.includes("Web search")).toBe(labelled);
    },
  );

  it("renders nothing without facets or assistants", () => {
    const { container } = render(
      <FacetSelector
        facets={[]}
        selectedFacetIds={[]}
        onSelectionChange={vi.fn()}
        onlySingleFacet={false}
        showFacetIndicatorWithDisplayName={false}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  // A deployment without facets must still reach delegation from the composer.
  it("carries the assistants alone when no facet is configured", async () => {
    const { onSelect } = renderSelector();

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveTextContent("Assistants");

    fireEvent.click(trigger);

    expect(
      await screen.findByRole("menuitem", { name: "Browse assistants…" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Researcher" }));
    expect(onSelect).toHaveBeenCalledWith(RESEARCHER);
  });

  // The dialog focuses itself; the dropdown's usual delayed close would hand
  // focus back to the trigger behind the overlay.
  it("closes without the select delay when browse opens the dialog", async () => {
    const { onBrowse } = renderSelector({ keepOpenOnSelect: true });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Browse assistants…" }),
    );

    expect(onBrowse).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("labels the assistants as their own group below the tools", async () => {
    renderSelector({ facets: [WEB_SEARCH] });

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger).toHaveTextContent("Tools");
    fireEvent.click(trigger);

    const group = await screen.findByRole("group", { name: "Assistants" });
    expect(
      within(group)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Researcher", "Browse assistants…"]);
  });

  // Enforced facet settings lock the tools, not delegation to other assistants.
  it("keeps the assistants selectable while the facet rows are locked", async () => {
    const { onSelect, onSelectionChange } = renderSelector({
      facets: [WEB_SEARCH],
      toolsDisabled: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const facetRow = await screen.findByRole("menuitem", {
      name: "Web search",
    });
    expect(facetRow).toBeDisabled();
    fireEvent.click(facetRow);
    expect(onSelectionChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Researcher" }));
    expect(onSelect).toHaveBeenCalledWith(RESEARCHER);
  });

  // Without delegation there is nothing left to pick, so enforcement keeps the
  // whole control inert rather than opening a menu of dead rows.
  it("locks the trigger when the tools are locked and no assistant is offered", () => {
    renderSelector({
      facets: [WEB_SEARCH],
      toolsDisabled: true,
      withAssistants: false,
    });

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger.closest(".pointer-events-none")).not.toBeNull();
  });

  it("renders the connectors write switch as a ticked row below the tools", async () => {
    const { onToggleWriteTools } = renderSelector({
      facets: [WEB_SEARCH],
      withAssistants: false,
      withConnectors: true,
      writeToolsEnabled: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(await screen.findByText("Connectors")).toBeInTheDocument();
    const toggle = screen.getByRole("menuitem", {
      name: /Allow write operations/,
    });
    expect(
      within(toggle).getByText(
        "Off, only tools the server marks read-only are offered.",
      ),
    ).toBeInTheDocument();
    // Section rows carry no leading icon, so the only SVG in the row is the
    // tick — present exactly while the switch is on.
    expect(toggle.querySelector("svg")).not.toBeNull();

    fireEvent.click(toggle);
    expect(onToggleWriteTools).toHaveBeenCalledTimes(1);
  });

  it("renders the connectors write switch unticked while writes are off", async () => {
    renderSelector({
      facets: [WEB_SEARCH],
      withAssistants: false,
      withConnectors: true,
      writeToolsEnabled: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(await screen.findByText("Connectors")).toBeInTheDocument();
    const toggle = screen.getByRole("menuitem", {
      name: /Allow write operations/,
    });
    expect(toggle.querySelector("svg")).toBeNull();
  });

  // Connectors are tools, so a facet-less deployment with a connector keeps
  // the Tools trigger rather than the assistants-only one.
  it("keeps the Tools trigger when only connectors are offered", () => {
    renderSelector({ withAssistants: false, withConnectors: true });

    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.queryByText("Assistants")).not.toBeInTheDocument();
  });

  it("keeps the connectors live while the facet rows are locked", async () => {
    const { onToggleWriteTools } = renderSelector({
      facets: [WEB_SEARCH],
      toolsDisabled: true,
      withAssistants: false,
      withConnectors: true,
    });

    const trigger = screen.getByRole("button", { name: "Open menu" });
    expect(trigger.closest(".pointer-events-none")).toBeNull();
    fireEvent.click(trigger);

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Allow write operations/ }),
    );
    expect(onToggleWriteTools).toHaveBeenCalledTimes(1);
  });

  it("renders a switched-off server as an unticked row above the write switch and flips it", async () => {
    const { onToggleServer } = renderSelector({
      facets: [WEB_SEARCH],
      withAssistants: false,
      withConnectors: true,
      servers: [
        {
          id: "linear",
          display_name: "linear",
          connection_status: "SUCCESS",
          authentication_mode: "oauth2",
        },
      ],
      disabledServerIds: ["linear"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    expect(await screen.findByText("Connectors")).toBeInTheDocument();
    const items = screen
      .getAllByRole("menuitem")
      .map((item) => item.textContent ?? "");
    expect(items.findIndex((text) => text.startsWith("linear"))).toBeLessThan(
      items.findIndex((text) => text.includes("Allow write operations")),
    );

    const row = screen.getByRole("menuitem", { name: /^linear/ });
    // The tick is the only SVG in a section row, so its absence is the
    // switched-off state itself.
    expect(row.querySelector("svg")).toBeNull();
    fireEvent.click(row);
    expect(onToggleServer).toHaveBeenCalledWith("linear");
  });

  it("renders a server that is on as a ticked row", async () => {
    renderSelector({
      facets: [WEB_SEARCH],
      withAssistants: false,
      withConnectors: true,
      servers: [
        {
          id: "linear",
          display_name: "linear",
          connection_status: "SUCCESS",
          authentication_mode: "oauth2",
        },
      ],
      disabledServerIds: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const row = await screen.findByRole("menuitem", { name: /^linear/ });
    expect(row.querySelector("svg")).not.toBeNull();
  });
});
