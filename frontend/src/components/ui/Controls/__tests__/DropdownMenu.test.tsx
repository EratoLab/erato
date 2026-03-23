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
    expect(screen.getByRole("menu")).toHaveStyle({
      backgroundColor: "var(--theme-shell-dropdown)",
      borderColor: "var(--theme-border-divider)",
      borderRadius: "var(--theme-radius-base)",
      boxShadow: "var(--theme-elevation-dropdown)",
      maxWidth:
        "calc(100vw - (var(--theme-layout-dropdown-viewport-margin) * 2))",
      minWidth: "var(--theme-layout-dropdown-min-width)",
    });
    expect(menuItem.className).toContain("focus-ring-inset");
    expect(menuItem.className).not.toContain("focus:bg-theme-bg-accent");
    expect(screen.getByRole("menu").firstElementChild).toHaveClass(
      "dropdown-panel-chrome-geometry",
    );
  });
});
