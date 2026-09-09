import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RadioCard } from "../RadioCard";

import type { ReactNode } from "react";

const renderCard = (props: {
  checked: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) => {
  const { container } = render(
    <RadioCard
      name="mode"
      value="fast"
      onChange={vi.fn()}
      label="Fast"
      icon={<span />}
      {...props}
    />,
  );
  return {
    card: container.querySelector('[data-ui="option-card"]')!,
    iconTile: container.querySelector('[data-ui="option-card-icon"]')!,
    details: container.querySelector('[data-ui="option-card-details"]'),
    row: container.querySelector("label")!,
  };
};

describe("RadioCard", () => {
  it("reports the selection on the card and its icon tile", () => {
    const { card, iconTile } = renderCard({ checked: true });

    expect(card).toHaveAttribute("data-selected", "true");
    expect(iconTile).toHaveAttribute("data-selected", "true");
  });

  it("drops the attribute entirely while unselected", () => {
    const { card, iconTile } = renderCard({ checked: false });

    expect(card).not.toHaveAttribute("data-selected");
    expect(iconTile).not.toHaveAttribute("data-selected");
  });

  it("leaves the chosen and hovered fills to the card skin", () => {
    const chosen = renderCard({ checked: true });
    const idle = renderCard({ checked: false });

    // jsdom loads no stylesheet, so what is pinned is that nothing paints over
    // the skin: the chosen fill comes from `.card-skin[data-selected]` and the
    // hover tint from a rule that excludes it, so a colour or hover utility on
    // either element would outrank both and re-tint a card already chosen.
    for (const { card, row } of [chosen, idle]) {
      expect(card).toHaveClass("card-skin");
      expect(card.className).not.toContain("bg-theme");
      expect(card.className).not.toContain("hover:");
      expect(row.className).not.toContain("bg-theme");
      expect(row.className).not.toContain("hover:");
    }
  });

  it("clips the label row to the corner", () => {
    expect(renderCard({ checked: false }).card).toHaveClass("overflow-hidden");
  });

  it("keeps the inset on the label so the whole card is one click target", () => {
    const { card, row } = renderCard({ checked: false });

    // The radio is a transparent overlay on the label's own box; an inset on
    // the card's body would leave a rim of card that answers no click.
    expect(card).toHaveClass("card-inset-none");
    expect(row).toHaveClass("p-3");
  });

  it("gives the icon tile the card's corner rather than a derived one", () => {
    const { card, iconTile } = renderCard({ checked: true });

    // Card padding exceeds the card radius for every shipped theme, so a tile
    // derived from the frame's corner would come out square.
    expect(card).toHaveClass("option-card-geometry");
    expect(iconTile).toHaveClass("option-card-geometry");
    expect(iconTile.className).not.toContain("card-nested");
    expect(iconTile.className).not.toContain("rounded");
  });

  it("bands the details under a checked card only", () => {
    const details = <p>Outlook opens the reply in a draft.</p>;

    expect(
      renderCard({ checked: false, children: details }).details,
    ).toBeNull();

    // The section class carries the corner policy, not the divider: it draws
    // no line of its own.
    expect(
      renderCard({ checked: true, children: details }).details,
    ).toHaveClass("card-section", "border-t");
  });
});
