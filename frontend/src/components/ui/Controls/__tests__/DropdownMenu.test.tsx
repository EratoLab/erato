import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DropdownMenu } from "../DropdownMenu";

describe("DropdownMenu", () => {
  it("renders a stable dropdown panel hook when opened", async () => {
    render(
      <DropdownMenu
        items={[
          {
            label: "Rename",
            onClick: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    await waitFor(() => {
      expect(document.querySelector('[data-ui="dropdown-panel"]')).toBeTruthy();
    });

    const menuItem = screen.getByRole("menuitem", { name: "Rename" });

    expect(screen.getByRole("menu")).toHaveAttribute(
      "data-ui",
      "dropdown-panel",
    );
    const panel = screen.getByRole("menu");
    // Surface from the class; only consumer-supplied sizing stays inline.
    expect(panel).toHaveClass("anchored-popover-skin");
    expect(panel).toHaveStyle({
      maxWidth:
        "calc(100vw - (var(--theme-layout-dropdown-viewport-margin) * 2))",
      minWidth: "var(--theme-layout-dropdown-min-width)",
    });
    const inlineStyle = panel.getAttribute("style") ?? "";
    for (const property of [
      "background-color",
      "border-color",
      "border-radius",
      "box-shadow",
    ]) {
      expect(inlineStyle).not.toContain(property);
    }
    // Active row uses the soft light highlight, not the old 2px dark ring.
    expect(menuItem.className).not.toContain("focus-ring-inset");
    expect(menuItem.className).toContain("focus:bg-theme-bg-hover");
    expect(menuItem.className).toContain("focus:ring-1");
    expect(screen.getByRole("menu").firstElementChild).toHaveClass(
      "dropdown-panel-chrome-geometry",
    );
  });

  it("does not autofocus the first item when autoFocusFirstItem is disabled", async () => {
    render(
      <DropdownMenu
        autoFocusFirstItem={false}
        items={[
          {
            label: "Rename",
            onClick: vi.fn(),
          },
          {
            label: "Delete",
            onClick: vi.fn(),
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const firstItem = await screen.findByRole("menuitem", { name: "Rename" });

    await waitFor(() => {
      expect(firstItem).not.toHaveFocus();
    });
  });

  it("positions before reveal and contains its own scroll (ERMAIN-464)", async () => {
    render(<DropdownMenu items={[{ label: "Rename", onClick: vi.fn() }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const menu = await screen.findByRole("menu");

    // Panel is revealed only after the layout-effect positioning ran; the
    // visibility guard is set explicitly (would be "hidden" if unpositioned).
    expect(menu.style.visibility).toBe("visible");
    // updatePosition clamped the panel to a pixel max-height.
    expect(menu.style.maxHeight).toMatch(/^\d+px$/);
    // Panel is a flex column that owns max-height; the inner list scrolls
    // within it instead of overflowing the viewport.
    expect(menu).toHaveClass("flex", "flex-col");
    expect(menu.firstElementChild).toHaveClass(
      "dropdown-panel-chrome-geometry",
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "overscroll-contain",
    );
  });

  it("focuses the panel (no item) on a pointer-open (ERMAIN-467)", async () => {
    render(
      <DropdownMenu
        items={[
          { label: "Rename", onClick: vi.fn() },
          { label: "Delete", onClick: vi.fn() },
        ]}
      />,
    );

    // A real pointer click carries detail >= 1; keyboard-triggered clicks have
    // detail 0. Simulate a pointer click here.
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }), {
      detail: 1,
    });

    const menu = await screen.findByRole("menu");

    await waitFor(() => {
      expect(menu).toHaveFocus();
    });
    expect(screen.getByRole("menuitem", { name: "Rename" })).not.toHaveFocus();
  });

  it("focuses the first item on a keyboard-open (ERMAIN-467)", async () => {
    render(
      <DropdownMenu
        items={[
          { label: "Rename", onClick: vi.fn() },
          { label: "Delete", onClick: vi.fn() },
        ]}
      />,
    );

    // Keyboard activation (Enter/Space) dispatches a synthetic click with
    // detail 0.
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }), {
      detail: 0,
    });

    const firstItem = await screen.findByRole("menuitem", { name: "Rename" });

    await waitFor(() => {
      expect(firstItem).toHaveFocus();
    });
  });

  it("opens and focuses the first item on ArrowDown on the trigger (ERMAIN-467)", async () => {
    render(
      <DropdownMenu
        items={[
          { label: "Rename", onClick: vi.fn() },
          { label: "Delete", onClick: vi.fn() },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const firstItem = await screen.findByRole("menuitem", { name: "Rename" });

    await waitFor(() => {
      expect(firstItem).toHaveFocus();
    });
  });

  it("wraps arrow-key navigation and jumps with Home/End (ERMAIN-467)", async () => {
    render(
      <DropdownMenu
        items={[
          { label: "Rename", onClick: vi.fn() },
          { label: "Share", onClick: vi.fn() },
          { label: "Delete", onClick: vi.fn() },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }), {
      detail: 1,
    });
    const menu = await screen.findByRole("menu");
    const [rename, share, del] = screen.getAllByRole("menuitem");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(rename).toHaveFocus();

    fireEvent.keyDown(rename, { key: "ArrowUp" });
    expect(del).toHaveFocus();

    fireEvent.keyDown(del, { key: "Home" });
    expect(rename).toHaveFocus();

    fireEvent.keyDown(rename, { key: "End" });
    expect(del).toHaveFocus();

    fireEvent.keyDown(del, { key: "ArrowDown" });
    expect(rename).toHaveFocus();

    // sanity: middle item reachable
    fireEvent.keyDown(rename, { key: "ArrowDown" });
    expect(share).toHaveFocus();
  });

  it("skips disabled items during arrow-key navigation (ERMAIN-467)", async () => {
    render(
      <DropdownMenu
        items={[
          { label: "Rename", onClick: vi.fn() },
          { label: "Share", onClick: vi.fn(), disabled: true },
          { label: "Delete", onClick: vi.fn() },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }), {
      detail: 1,
    });
    const menu = await screen.findByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("closes on an outside pointerdown so tap-outside dismisses on touch (ERMAIN-465)", async () => {
    render(<DropdownMenu items={[{ label: "Rename", onClick: vi.fn() }]} />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(trigger);
    await screen.findByRole("menu");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(document.querySelector('[data-ui="dropdown-panel"]')).toBeNull();
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("takes its geometry from the shared control token, not a caller override", () => {
    render(
      <DropdownMenu
        items={[{ label: "Rename", onClick: vi.fn() }]}
        triggerButtonVariant="secondary"
        triggerButtonClassName="min-w-[10rem] justify-between gap-2"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Open menu" });

    // btn-geometry-sm resolves --theme-radius-control, so a theme scoping that
    // token to a surface reaches this trigger like any other button.
    expect(trigger.className).toContain("btn-geometry-sm");
    expect(trigger).toHaveAttribute("data-geometry", "sm");
    // Layout is the caller's business; skin is not.
    expect(trigger.className).toContain("justify-between");
    expect(trigger.className).not.toMatch(/rounded-\[/);
    expect(trigger.className).not.toMatch(/\bshadow-sm\b/);
    expect(trigger.className).not.toMatch(/\bpx-3\b|\bpy-2\b/);
  });
});
