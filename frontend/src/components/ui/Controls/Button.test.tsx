import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("uses theme action classes for the primary variant", () => {
    render(<Button variant="primary">Primary Action</Button>);

    const button = screen.getByRole("button", { name: "Primary Action" });

    expect(button.className).toContain("bg-theme-action-primary-bg");
    expect(button.className).toContain("text-theme-action-primary-fg");
    expect(button.className).toContain("hover:bg-theme-action-primary-hover");
    expect(button.className).not.toContain("bg-neutral-800");
    expect(button.className).not.toContain("text-white");
    expect(button.className).not.toContain("hover:bg-neutral-700");
  });

  it("uses square icon geometry for the icon-only variant", () => {
    render(
      <Button
        variant="icon-only"
        size="sm"
        icon={<span>+</span>}
        aria-label="Add"
      />,
    );

    const button = screen.getByRole("button", { name: "Add" });

    expect(button.className).toContain("btn-geometry-icon-sm");
    expect(button.className).toContain("justify-center");
    expect(button.className).not.toContain("btn-geometry-sm");
  });

  it("takes icon geometry from `geometry` while keeping the variant's fill", () => {
    render(
      <Button
        variant="secondary"
        size="sm"
        geometry="icon"
        icon={<span>+</span>}
        aria-label="Send"
      />,
    );

    const button = screen.getByRole("button", { name: "Send" });

    expect(button.className).toContain("btn-geometry-icon-sm");
    expect(button.className).not.toContain("btn-geometry-sm");
    // The colour axis is untouched — this is the whole point of the prop.
    expect(button.className).toContain("bg-theme-bg-secondary");
    expect(button.className).toContain("border-theme-border");
  });

  it("exposes resolved geometry and variant as styling hooks", () => {
    const { rerender } = render(
      <Button variant="secondary" size="sm">
        Text
      </Button>,
    );

    let button = screen.getByRole("button", { name: "Text" });
    expect(button.getAttribute("data-geometry")).toBe("sm");
    expect(button.getAttribute("data-variant")).toBe("secondary");

    rerender(
      <Button
        variant="secondary"
        size="sm"
        geometry="icon"
        icon={<span>+</span>}
        aria-label="Send"
      />,
    );

    button = screen.getByRole("button", { name: "Send" });
    expect(button.getAttribute("data-geometry")).toBe("icon-sm");
    expect(button.getAttribute("data-variant")).toBe("secondary");
  });

  it("reads the pill radius from the theme token, not a hardcoded value", () => {
    render(
      <Button variant="secondary" shape="pill">
        Pill
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Pill" });

    expect(button.className).toContain("rounded-[var(--theme-radius-pill)]");
    expect(button.className).not.toContain("rounded-full");
  });
});
