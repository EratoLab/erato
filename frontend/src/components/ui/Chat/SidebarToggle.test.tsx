import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarToggle } from "./SidebarToggle";

import type { SidebarToggleProps } from "./SidebarToggle";

// Container-scoped: some cases render two toggles to compare them.
const renderToggle = (props: Partial<SidebarToggleProps> = {}) => {
  const { container } = render(
    <SidebarToggle
      surface="flush"
      expanded={false}
      label="expand sidebar"
      {...props}
    />,
  );

  return container.querySelector("button") as HTMLButtonElement;
};

describe("SidebarToggle", () => {
  // Button writes data-variant before spreading props, so a data-variant here
  // would erase the "sidebar-icon" both customer themes key their rules on.
  it("keeps the sidebar-icon variant channel and reports its shape separately", () => {
    for (const surface of ["floating", "flush", "framed"] as const) {
      const toggle = renderToggle({ surface });

      expect(toggle).toHaveAttribute("data-variant", "sidebar-icon");
      expect(toggle).toHaveAttribute("data-surface", surface);
      expect(toggle).toHaveAttribute("data-ui", "sidebar-toggle");
    }
  });

  // The skin sets border-color only; without a width the frame disappears.
  it("paints only the standalone surfaces", () => {
    expect(renderToggle({ surface: "floating" })).toHaveClass(
      "floating-control-skin",
      "border",
    );
    expect(renderToggle({ surface: "framed" })).toHaveClass(
      "floating-control-skin",
      "border",
    );

    const flush = renderToggle({ surface: "flush" });
    expect(flush).not.toHaveClass("floating-control-skin");
    expect(flush).not.toHaveClass("border");
  });

  it("announces the caller's label and expanded state verbatim", () => {
    const toggle = renderToggle({
      expanded: true,
      label: "collapse sidebar, 3 chats need attention",
    });

    expect(toggle).toHaveAccessibleName(
      "collapse sidebar, 3 chats need attention",
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  // Rotating the button would turn its badge upside down and corner to corner.
  it("rotates the glyph, never the button", () => {
    const toggle = renderToggle({
      expanded: true,
      attentionCount: 2,
      badgeTestId: "sidebar-generation-badge",
    });
    const glyph = toggle.querySelector('[aria-hidden="true"]');
    const badge = within(toggle).getByTestId("sidebar-generation-badge");

    expect(toggle).not.toHaveClass("rotate-180");
    expect(glyph).toHaveClass("rotate-180");
    expect(glyph?.contains(badge)).toBe(false);
  });

  it("leaves the glyph upright while collapsed", () => {
    const toggle = renderToggle({ expanded: false });

    expect(toggle.querySelector('[aria-hidden="true"]')).not.toHaveClass(
      "rotate-180",
    );
  });

  // The add-in's drawer trigger sits behind the open drawer, so it stays still.
  it("can report expanded without turning the glyph", () => {
    const toggle = renderToggle({ expanded: true, flipOnExpand: false });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle.querySelector('[aria-hidden="true"]')).not.toHaveClass(
      "rotate-180",
    );
  });

  // The geometry probe measures the button's first aria-hidden node, and
  // CountBadge is aria-hidden too.
  it("renders the badge after the icon, under the caller's test id", () => {
    const toggle = renderToggle({
      attentionCount: 3,
      badgeTestId: "addin-history-drawer-attention-badge",
    });
    const firstHidden = toggle.querySelector('[aria-hidden="true"]');
    const badge = within(toggle).getByTestId(
      "addin-history-drawer-attention-badge",
    );

    expect(firstHidden).not.toBeNull();
    expect(firstHidden).not.toBe(badge);
    expect(firstHidden?.querySelector("svg")).not.toBeNull();
    expect(badge).toHaveTextContent("3");
    expect(
      (firstHidden?.compareDocumentPosition(badge) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stays bare while nothing wants attention", () => {
    const toggle = renderToggle({ attentionCount: 0, badgeTestId: "badge" });

    expect(within(toggle).queryByTestId("badge")).toBeNull();
    expect(toggle).not.toHaveClass("relative");
  });

  // Tailwind emits .relative after .absolute, so an unconditional one would
  // outrank a caller that positions the control itself.
  it("anchors the badge itself only when the caller has not positioned it", () => {
    expect(
      renderToggle({ attentionCount: 1, badgeTestId: "in-flow" }),
    ).toHaveClass("relative");

    expect(
      renderToggle({
        surface: "floating",
        attentionCount: 1,
        badgeTestId: "positioned",
        className: "absolute left-2 top-2 z-20",
      }),
    ).not.toHaveClass("relative");
  });

  // A second glyph would give the geometry probe another node to measure.
  it("lets a custom face replace the default glyph", () => {
    const toggle = renderToggle({
      children: <img alt="Logo" src="/logo.svg" />,
    });

    expect(toggle.querySelector("img")).not.toBeNull();
    expect(toggle.querySelector("svg")).toBeNull();
  });

  it("passes the popover and test hooks through to the button", () => {
    const toggle = renderToggle({
      "aria-haspopup": "dialog",
      "aria-controls": "history-drawer",
      tabIndex: -1,
      "data-testid": "addin-history-drawer-trigger",
      className: "sidebar-icon-col-geometry",
    });

    expect(toggle).toHaveAttribute("aria-haspopup", "dialog");
    expect(toggle).toHaveAttribute("aria-controls", "history-drawer");
    expect(toggle).toHaveAttribute("tabindex", "-1");
    expect(toggle).toHaveAttribute(
      "data-testid",
      "addin-history-drawer-trigger",
    );
    expect(toggle).toHaveClass("sidebar-icon-col-geometry");
  });

  it("passes a ref through to the button element", () => {
    let element: HTMLButtonElement | null = null;

    render(
      <SidebarToggle
        surface="flush"
        expanded={false}
        label="expand sidebar"
        ref={(node) => {
          element = node;
        }}
      />,
    );

    expect(element).toBeInstanceOf(HTMLButtonElement);
  });
});
