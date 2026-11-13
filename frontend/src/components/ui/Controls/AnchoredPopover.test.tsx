import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnchoredPopover } from "./AnchoredPopover";

describe("AnchoredPopover", () => {
  it("uses the dropdown border token for the popover panel", () => {
    render(
      <AnchoredPopover
        isOpen={true}
        onOpenChange={vi.fn()}
        trigger={(props) => <button {...props}>Open</button>}
      >
        <div>Panel content</div>
      </AnchoredPopover>,
    );

    const panel = screen.getByText("Panel content").parentElement;

    // The surface comes from a class, not an inline style, so a theme.css
    // rule on the panel's data-ui hook can override it.
    expect(panel).toHaveClass("anchored-popover-skin");
    expect(panel?.getAttribute("style") ?? "").not.toContain("border-color");
  });

  it("does not close on the Escape that dismisses an IME candidate", () => {
    const onOpenChange = vi.fn();
    render(
      <AnchoredPopover
        isOpen={true}
        onOpenChange={onOpenChange}
        trigger={(props) => <button {...props}>Open</button>}
      >
        <input aria-label="Filter" />
      </AnchoredPopover>,
    );
    const field = screen.getByRole("textbox", { name: "Filter" });

    fireEvent.keyDown(field, {
      key: "Escape",
      keyCode: 229,
      isComposing: true,
    });
    expect(onOpenChange).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // Marked text has no element to measure, so the owner passes its rectangle.
  describe("anchored to a rectangle", () => {
    const rect = { top: 300, bottom: 320, left: 400, right: 500 };
    const ui = (
      orientation: "top" | "bottom",
      onOpenChange: (open: boolean) => void = vi.fn(),
    ) => (
      <>
        <button type="button">Elsewhere</button>
        <AnchoredPopover
          isOpen
          onOpenChange={onOpenChange}
          anchorRect={rect}
          anchorGap={8}
          width="content"
          widthFloor={false}
          manageFocus={false}
          role="toolbar"
          ariaLabel="Actions"
          preferredOrientation={{ vertical: orientation, horizontal: "center" }}
        >
          <button type="button">Action</button>
        </AnchoredPopover>
      </>
    );
    const panelSize = (width: number, height: number) =>
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
        width,
        height,
        top: 0,
        bottom: height,
        left: 0,
        right: width,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      });

    it("renders only the panel, named by its label and free of the width floor", () => {
      const { container } = render(ui("top"));
      const panel = screen.getByRole("toolbar", { name: "Actions" });

      expect(container.querySelector(".relative.inline-block")).toBeNull();
      expect(panel).toHaveAttribute("data-popover-floor", "none");
      expect(panel).toHaveAttribute("data-popover-width", "content");
      expect(panel).not.toHaveAttribute("aria-labelledby");
      expect(panel).not.toHaveFocus();
    });

    it("sits the gap above the rectangle, centred on it", () => {
      const measure = panelSize(60, 40);
      render(ui("top"));
      const panel = screen.getByRole("toolbar");

      expect(panel.style.bottom).toBe(`${window.innerHeight - 300 + 8}px`);
      expect(panel.style.left).toBe("420px");
      measure.mockRestore();
    });

    it("goes below the rectangle when asked to, or when there is no room above", () => {
      const measure = panelSize(60, 40);
      const { unmount } = render(ui("bottom"));
      expect(screen.getByRole("toolbar").style.top).toBe("328px");
      unmount();
      measure.mockRestore();

      const tall = panelSize(60, 400);
      render(ui("top"));
      expect(screen.getByRole("toolbar").style.top).toBe("328px");
      tall.mockRestore();
    });

    it("closes on a press elsewhere and on Escape", () => {
      const onOpenChange = vi.fn();
      render(ui("top", onOpenChange));

      fireEvent.pointerDown(screen.getByRole("button", { name: "Action" }));
      expect(onOpenChange).not.toHaveBeenCalled();
      fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onOpenChange.mock.calls).toEqual([[false], [false]]);
    });
  });

  // Closing hands focus back to the trigger only when it would otherwise be
  // lost with the panel. An action that put focus somewhere keeps it there.
  describe("focus on close", () => {
    const ui = (isOpen: boolean) => (
      <>
        <textarea aria-label="Composer" />
        <AnchoredPopover
          isOpen={isOpen}
          onOpenChange={vi.fn()}
          trigger={(props) => <button {...props}>Open</button>}
        >
          <button type="button">Inside</button>
        </AnchoredPopover>
      </>
    );

    it("returns focus to the trigger when the panel held it", () => {
      const { rerender } = render(ui(true));
      screen.getByRole("button", { name: "Inside" }).focus();

      rerender(ui(false));

      expect(screen.getByRole("button", { name: "Open" })).toHaveFocus();
    });

    it("leaves focus where an action moved it outside the panel", () => {
      const { rerender } = render(ui(true));
      screen.getByRole("textbox", { name: "Composer" }).focus();

      rerender(ui(false));

      expect(screen.getByRole("textbox", { name: "Composer" })).toHaveFocus();
    });
  });
});
