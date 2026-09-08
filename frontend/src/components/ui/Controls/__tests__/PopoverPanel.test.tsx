import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  PopoverChrome,
  PopoverPanel,
  PopoverSectionHeader,
  PopoverSeparator,
} from "../PopoverPanel";

describe("PopoverPanel", () => {
  it("carries the family hooks and the shape attributes", () => {
    render(
      <PopoverPanel positioned="fixed" dataUi="test-panel">
        <span>Panel content</span>
      </PopoverPanel>,
    );

    const panel = screen.getByText("Panel content").parentElement;

    expect(panel).toHaveAttribute("data-ui", "test-panel");
    expect(panel).toHaveClass(
      "anchored-popover-skin",
      "popover-panel-geometry",
    );
    expect(panel).toHaveAttribute("data-popover-position", "fixed");
    // The width dialect defaults to the token floor.
    expect(panel).toHaveAttribute("data-popover-width", "min");
    // Every panel nests a chrome that carries this class legitimately, so a
    // flipped `padded` default would double the inset unnoticed.
    expect(panel).not.toHaveClass("dropdown-panel-chrome-geometry");
  });

  it.each(["min", "content", "wide"] as const)(
    "renders the %s width as a shape attribute",
    (width) => {
      render(
        <PopoverPanel positioned="absolute" width={width} dataUi="test-panel">
          <span>Panel content</span>
        </PopoverPanel>,
      );

      expect(screen.getByText("Panel content").parentElement).toHaveAttribute(
        "data-popover-width",
        width,
      );
      expect(screen.getByText("Panel content").parentElement).toHaveAttribute(
        "data-popover-position",
        "absolute",
      );
    },
  );

  it("keeps padded panels a single element around their children", () => {
    render(
      <PopoverPanel positioned="absolute" padded dataUi="test-panel">
        <span>Panel content</span>
      </PopoverPanel>,
    );

    // Callers measure the panel through the child's parentElement and read its
    // padding off it, so `padded` must not introduce a wrapper.
    const panel = screen.getByText("Panel content").parentElement;

    expect(panel).toHaveClass("dropdown-panel-chrome-geometry");
    expect(panel).toHaveAttribute("data-ui", "test-panel");
  });

  it("forwards a ref, arbitrary attributes and handlers to the panel element", () => {
    const ref = { current: null as HTMLDivElement | null };
    const onPointerEnter = vi.fn();

    render(
      <PopoverPanel
        ref={ref}
        positioned="absolute"
        dataUi="test-panel"
        role="menu"
        aria-label="Filters"
        data-testid="test-panel-node"
        onPointerEnter={onPointerEnter}
        data-ui="hijacked"
        data-popover-width="wide"
      >
        <span>Panel content</span>
      </PopoverPanel>,
    );

    const panel = screen.getByTestId("test-panel-node");

    expect(ref.current).toBe(panel);
    expect(panel).toHaveAttribute("role", "menu");
    expect(panel).toHaveAccessibleName("Filters");

    // The hooks the stylesheet and the themes key on are written after the
    // rest-spread, so a caller cannot overwrite them by passing them raw.
    expect(panel).toHaveAttribute("data-ui", "test-panel");
    expect(panel).toHaveAttribute("data-popover-width", "min");

    fireEvent.pointerEnter(panel);
    expect(onPointerEnter).toHaveBeenCalledTimes(1);
  });
});

describe("PopoverChrome", () => {
  it("scrolls in a column by default", () => {
    render(
      <PopoverChrome dataUi="test-chrome">
        <span>Rows</span>
      </PopoverChrome>,
    );

    const chrome = screen.getByText("Rows").parentElement;

    expect(chrome).toHaveClass(
      "dropdown-panel-chrome-geometry",
      "flex",
      "flex-col",
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "overscroll-contain",
    );
    expect(chrome).toHaveAttribute("data-ui", "test-chrome");
    expect(chrome).toHaveAttribute("role", "none");
  });

  it("drops the column and the scroll container when they are turned off", () => {
    render(
      <PopoverChrome scroll={false} column={false}>
        <span>Rows</span>
      </PopoverChrome>,
    );

    const chrome = screen.getByText("Rows").parentElement;

    expect(chrome).toHaveClass("dropdown-panel-chrome-geometry");
    expect(chrome?.className).toBe("dropdown-panel-chrome-geometry");
    expect(chrome).not.toHaveAttribute("data-ui");
  });

  it("forwards a test id and keyboard handling to the chrome element", () => {
    const onKeyDown = vi.fn();

    render(
      <PopoverChrome data-testid="test-chrome-node" onKeyDown={onKeyDown}>
        <span>Rows</span>
      </PopoverChrome>,
    );

    fireEvent.keyDown(screen.getByTestId("test-chrome-node"), {
      key: "ArrowDown",
    });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("PopoverSectionHeader and PopoverSeparator", () => {
  it("labels a run of rows without joining the item list", () => {
    render(
      <PopoverSectionHeader id="header-id">Assistants</PopoverSectionHeader>,
    );

    const header = screen.getByText("Assistants");

    expect(header).toHaveAttribute("id", "header-id");
    expect(header).toHaveAttribute("role", "presentation");
    expect(header).toHaveAttribute("data-ui", "popover-section-header");
  });

  it("renders a separator role", () => {
    render(<PopoverSeparator />);

    const separator = screen.getByRole("separator");

    expect(separator).toHaveAttribute("data-ui", "popover-separator");
    expect(separator).toHaveClass("my-1", "h-px", "bg-theme-border");
  });
});
