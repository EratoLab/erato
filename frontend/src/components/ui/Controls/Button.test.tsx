import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("defaults to the sm house size", () => {
    render(<Button>Default</Button>);

    const button = screen.getByRole("button", { name: "Default" });

    expect(button).toHaveAttribute("data-geometry", "sm");
    expect(button.className).toContain("btn-geometry-sm");
  });

  it("pins a type scale per size so it cannot inherit from the container", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole("button", { name: "Small" }).className).toContain(
      "text-sm",
    );

    rerender(<Button size="md">Medium</Button>);
    expect(screen.getByRole("button", { name: "Medium" }).className).toContain(
      "text-base",
    );

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole("button", { name: "Large" }).className).toContain(
      "text-lg",
    );
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

  it("keeps a busy button clickable so it can interrupt its own work", () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Stop
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Stop" });

    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // `busy` stands in for a size-4 icon, so it renders the 16px ring.
    expect(
      button.querySelector('[data-ui="spinner"][data-size="md"]'),
    ).not.toBeNull();

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still disables a loading button", () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving" });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      button.querySelector('[data-ui="spinner"][data-size="sm"]'),
    ).not.toBeNull();
  });

  it("shows the busy ring in place of the idle icon", () => {
    const { rerender } = render(
      <Button busy={false} icon={<span>idle</span>}>
        Dictate
      </Button>,
    );

    const button = screen.getByRole("button", { name: /Dictate/ });

    expect(button).toHaveTextContent("idle");
    expect(button.querySelector('[data-ui="spinner"]')).toBeNull();

    rerender(
      <Button busy icon={<span>idle</span>}>
        Dictate
      </Button>,
    );

    expect(button).not.toHaveTextContent("idle");
    expect(button.querySelector('[data-ui="spinner"]')).not.toBeNull();
  });
});
