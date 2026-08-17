import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FacetSelector } from "../FacetSelector";
import { buildAssistantMentionSection } from "../assistantMentionSection";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const WEB_SEARCH: FacetInfo = {
  id: "facet-1",
  display_name: "Web search",
  default_enabled: false,
};

const RESEARCHER = { id: "assistant-research", name: "Researcher" };

function renderSelector({
  facets = [] as FacetInfo[],
  toolsDisabled = false,
  onSelect = vi.fn(),
  onBrowse = vi.fn(),
  onSelectionChange = vi.fn(),
  withAssistants = true,
} = {}) {
  render(
    <FacetSelector
      facets={facets}
      selectedFacetIds={[]}
      onSelectionChange={onSelectionChange}
      onlySingleFacet={false}
      showFacetIndicatorWithDisplayName={false}
      toolsDisabled={toolsDisabled}
      assistantSection={
        withAssistants
          ? buildAssistantMentionSection({
              assistants: [RESEARCHER],
              onSelect,
              onBrowse,
            })
          : undefined
      }
    />,
  );
  return { onSelect, onBrowse, onSelectionChange };
}

describe("FacetSelector", () => {
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
    const { onBrowse } = renderSelector();

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
});
