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
