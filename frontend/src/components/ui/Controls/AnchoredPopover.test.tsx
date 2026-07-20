import { render, screen } from "@testing-library/react";
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
    // rule on [data-ui="dropdown-panel"] can override it.
    expect(panel).toHaveClass("anchored-popover-skin");
    expect(panel?.getAttribute("style") ?? "").not.toContain("border-color");
  });
});
