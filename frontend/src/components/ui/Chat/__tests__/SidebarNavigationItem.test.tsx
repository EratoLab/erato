import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SidebarNavigationItem } from "../SidebarNavigationItem";

const renderItem = (
  props: Partial<Parameters<typeof SidebarNavigationItem>[0]> = {},
) => {
  const { container } = render(
    <SidebarNavigationItem
      label="Search"
      icon={<span />}
      data-ui="sidebar-nav-item"
      {...props}
    />,
  );
  const row = container.querySelector('[data-ui="sidebar-nav-item"]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
};

describe("SidebarNavigationItem", () => {
  // The active row renders no link, so the row element is the only thing that
  // can carry the current-page semantics.
  it("announces the active row as the current page", () => {
    const row = renderItem({ active: true, href: "/search" });

    expect(screen.queryByRole("link")).toBeNull();
    expect(row).toHaveAttribute("aria-current", "page");
    expect(row).toHaveAttribute("data-selected");
  });

  it("leaves the state channels off an inactive link row", () => {
    const row = renderItem({ href: "/search", onClick: vi.fn() });

    expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
    expect(row).not.toHaveAttribute("aria-current");
    expect(row).not.toHaveAttribute("data-selected");
  });

  it("leaves the state channels off an inactive button row", () => {
    const row = renderItem({ onClick: vi.fn() });

    expect(row).not.toHaveAttribute("aria-current");
    expect(row).not.toHaveAttribute("data-selected");
  });
});
