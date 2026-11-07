import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { darkTheme, defaultTheme } from "@/config/theme";

import { RadioCard } from "../RadioCard";

import type { ReactNode } from "react";

// WCAG 2 relative luminance of a #rrggbb colour.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((start) => {
    const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrastRatio = (foreground: string, background: string) => {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
};

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

  it("steps the helper text up a tone on the chosen card", () => {
    const helperOf = (checked: boolean) =>
      within(
        render(
          <RadioCard
            name="channel"
            value={String(checked)}
            checked={checked}
            onChange={vi.fn()}
            label="Teams chat"
            helper="Your chat with Erato in Microsoft Teams"
          />,
        ).container,
      ).getByText("Your chat with Erato in Microsoft Teams");

    const chosen = helperOf(true);
    expect(chosen).toHaveClass("text-theme-fg-secondary");
    expect(chosen).not.toHaveClass("text-theme-fg-muted");
    expect(helperOf(false)).toHaveClass("text-theme-fg-muted");
  });

  it.each([
    ["light", defaultTheme],
    ["dark", darkTheme],
  ])(
    "keeps the chosen card's helper at 4.5:1 in the stock %s theme",
    (_, theme) => {
      const { background, foreground } = theme.colors;

      expect(
        contrastRatio(foreground.secondary, background.selected),
      ).toBeGreaterThanOrEqual(4.5);
      // The reason for the step: the muted token falls short on this fill.
      expect(contrastRatio(foreground.muted, background.selected)).toBeLessThan(
        4.5,
      );
    },
  );

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
