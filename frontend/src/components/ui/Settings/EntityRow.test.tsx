import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntityRow } from "./EntityRow";

import type { EntityRowProps } from "./EntityRow";

const renderRow = (props: Partial<EntityRowProps> = {}) => {
  render(
    <EntityRow
      icon={<span />}
      name="Local sidecar"
      status={{ tone: "success", label: "Connected" }}
      data-testid="entity-row"
      {...props}
    >
      <button type="button">Retry connection</button>
    </EntityRow>,
  );

  return {
    row: screen.getByTestId("entity-row"),
    toggle: screen.getByRole("button", { name: /Local sidecar/ }),
  };
};

describe("EntityRow", () => {
  it("frames the entity in an article a theme can reach", () => {
    const { row } = renderRow();

    // Found by its test id, so the id reaches the frame rather than stopping
    // at the card that renders it — two panes and an e2e run address the rows
    // that way.
    expect(row.tagName).toBe("ARTICLE");
    expect(row).toHaveAttribute("data-ui", "entity-row");
    // The rows are the secondary fill on a primary pane, and the card's own
    // default is the primary one, so the tone is what keeps the row from
    // lightening.
    expect(row).toHaveAttribute("data-tone", "muted");
    expect(row.className).not.toContain("bg-theme");
  });

  it("leads the toggle with the house disclosure chevron", () => {
    const { toggle } = renderRow();
    const chevron = toggle.firstElementChild;

    expect(chevron?.tagName).toBe("svg");
    expect(chevron).toHaveAttribute("aria-hidden", "true");
    expect(chevron).toHaveClass("rotate-0");

    fireEvent.click(toggle);

    expect(chevron).toHaveClass("rotate-90");
  });

  it("names the panel it opens", () => {
    const { row, toggle } = renderRow();

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(row).not.toHaveAttribute("data-expanded");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The frame states that it is open; the disclosure keeps the ARIA.
    expect(row).toHaveAttribute("data-expanded", "true");

    const body = document.getElementById(toggle.getAttribute("aria-controls")!);

    expect(body).toHaveClass("card-body-geometry", "border-t");
    expect(body).toContainElement(
      screen.getByRole("button", { name: "Retry connection" }),
    );
  });

  it("keeps the trailing action out of the toggle", () => {
    const { toggle } = renderRow({
      action: <button type="button">Authorize</button>,
    });
    const action = screen.getByRole("button", { name: "Authorize" });

    // Beside the toggle, not inside it: an action nested in the disclosure
    // would open the row on its way to running.
    expect(toggle).not.toContainElement(action);
    expect(toggle.parentElement).toContainElement(action);
  });

  it("drops the closed details out of the accessibility tree", () => {
    const { toggle } = renderRow();

    // Collapse hides the details by height alone, so without the unmount the
    // buttons in a closed row keep their tab stops and their place in the
    // tree.
    expect(
      screen.queryByRole("button", { name: "Retry connection" }),
    ).toBeNull();

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Retry connection" }),
    ).toBeInTheDocument();
  });

  it("opens on the row that asks to start open", () => {
    renderRow({ defaultExpanded: true });

    expect(
      screen.getByRole("button", { name: "Retry connection" }),
    ).toBeInTheDocument();
  });
});
