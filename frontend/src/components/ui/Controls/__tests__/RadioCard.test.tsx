import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RadioCard } from "../RadioCard";

const renderCard = (checked: boolean) => {
  const { container } = render(
    <RadioCard
      name="mode"
      value="fast"
      checked={checked}
      onChange={vi.fn()}
      label="Fast"
      icon={<span />}
    />,
  );
  return {
    card: container.querySelector('[data-ui="option-card"]'),
    iconTile: container.querySelector('[data-ui="option-card-icon"]'),
  };
};

describe("RadioCard", () => {
  it("reports the selection on the card and its icon tile", () => {
    const { card, iconTile } = renderCard(true);

    expect(card).toHaveAttribute("data-selected", "true");
    expect(iconTile).toHaveAttribute("data-selected", "true");
  });

  it("drops the attribute entirely while unselected", () => {
    const { card, iconTile } = renderCard(false);

    expect(card).not.toHaveAttribute("data-selected");
    expect(iconTile).not.toHaveAttribute("data-selected");
  });
});
