import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Row, ROW_ITEM_SELECTOR } from "../Row";

describe("Row", () => {
  it("carries the ERMAIN-467 focus recipe on the menu variant", () => {
    render(
      <Row variant="menu" role="menuitem">
        Rename
      </Row>,
    );

    const { className } = screen.getByRole("menuitem");

    // The soft light highlight, keyed to :focus so an arrowed-to row lights up
    // the way a hovered one does. DropdownMenu.test.tsx is the only other
    // guard; without this one a later "unify the focus rings" edit puts the
    // heavy pre-selected ring back with nothing failing.
    expect(className).toContain("focus:outline-none");
    expect(className).toContain("focus:ring-1");
    expect(className).toContain("focus:ring-inset");
    expect(className).toContain("focus:bg-theme-bg-hover");
    expect(className).toContain("focus:text-theme-fg-primary");
    expect(className).toContain("focus:ring-theme-border-dropdown");
    expect(className).not.toContain("focus-visible");
    expect(className).not.toContain("focus-ring-inset");
    expect(className).not.toContain("focus-ring-tight");
  });

  it("emits the menu geometry, hover recipe and family hook", () => {
    render(
      <Row variant="menu" role="menuitem">
        Rename
      </Row>,
    );

    const row = screen.getByRole("menuitem");

    expect(row).toHaveClass(
      "dropdown-item-geometry",
      "flex",
      "items-center",
      "gap-2",
      "text-sm",
      "text-theme-fg-secondary",
      "theme-transition",
      "cursor-pointer",
      "hover:bg-theme-bg-hover",
      "hover:text-theme-fg-primary",
    );
    // The submenu row's highlight, now unconditional: two attribute variants
    // outrank the one-class hover rule without a call-site workaround.
    expect(row).toHaveClass(
      "aria-expanded:bg-theme-bg-hover",
      "aria-expanded:text-theme-fg-primary",
    );
    // The shared container's button reset is off: its `p-0` is a utility and
    // the geometry class is in @layer components, so the reset would win the
    // cascade and zero the row's padding.
    expect(row).not.toHaveClass("p-0");
    expect(row).not.toHaveClass("text-inherit");
    expect(row).toHaveAttribute("type", "button");
    expect(row).toHaveAttribute("data-ui", "menu-item");
    expect(row).toHaveAttribute("data-row-item");
  });

  it("suppresses the interactive dialect when interactive is false", () => {
    const { container } = render(
      <Row variant="menu" as="div" interactive={false} tone="muted">
        Loading email thread...
      </Row>,
    );

    const row = screen.getByText("Loading email thread...");

    // The add-in's static info lines: item geometry and a tone colour, and
    // nothing that reacts to a pointer or to focus.
    expect(row).toHaveClass("dropdown-item-geometry", "text-theme-fg-muted");
    expect(row.className).not.toContain("hover:");
    expect(row.className).not.toContain("focus:");
    expect(row.className).not.toContain("cursor-pointer");
    expect(row.className).not.toContain("theme-transition");
    expect(row).not.toHaveAttribute("role");
    expect(row).not.toHaveAttribute("tabindex");
    // With no role and no tab stop the line cannot take focus, so it must not
    // claim a place in the roving walk: `.focus()` on it is a no-op and the
    // walk would target it again on every key. It states nothing either, so it
    // takes no `menu-item` hook.
    expect(row).not.toHaveAttribute("data-row-item");
    expect(row).not.toHaveAttribute("data-ui");
    expect(container.querySelectorAll(ROW_ITEM_SELECTOR)).toHaveLength(0);
  });

  it("keeps a caller's data-ui on a non-interactive row", () => {
    render(
      <Row variant="menu" as="div" interactive={false} data-ui="status-line">
        Loading attachments...
      </Row>,
    );

    // Only the family default is withheld; a hook the caller asks for is its
    // own decision and still reaches the element.
    expect(screen.getByText("Loading attachments...")).toHaveAttribute(
      "data-ui",
      "status-line",
    );
  });

  it("keeps a role the caller passes and forces none of its own", () => {
    render(
      <Row variant="menu" role="menuitemradio" checked={false} tabIndex={-1}>
        Newest first
      </Row>,
    );

    const row = screen.getByRole("menuitemradio");

    expect(row).toHaveAttribute("tabindex", "-1");
    // aria-checked stays a tri-state: "false" is a meaningful value on a radio
    // row, so it is emitted whenever `checked` is given at all.
    expect(row).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("omits aria-checked entirely when checked is not given", () => {
    render(
      <Row variant="menu" role="menuitem">
        Rename
      </Row>,
    );

    expect(screen.getByRole("menuitem")).not.toHaveAttribute("aria-checked");
  });

  it("emits the danger recipe and the tone hook for tone error", () => {
    render(
      <Row variant="menu" role="menuitem" tone="error">
        Delete
      </Row>,
    );

    const row = screen.getByRole("menuitem");

    expect(row).toHaveClass(
      "text-theme-error-fg",
      "hover:bg-theme-error-bg",
      "focus:bg-theme-error-bg",
      "focus:ring-theme-error-border",
    );
    expect(row).not.toHaveClass("text-theme-fg-secondary");
    expect(row).toHaveAttribute("data-tone", "error");
  });

  it("emits no tone hook for the neutral default", () => {
    render(
      <Row variant="menu" role="menuitem">
        Rename
      </Row>,
    );

    expect(screen.getByRole("menuitem")).not.toHaveAttribute("data-tone");
  });

  it("sets nothing on the cross axis in the sidebar variant", () => {
    render(
      <Row variant="sidebar" as="div" align="center" data-testid="nav-row">
        New Chat
      </Row>,
    );

    const row = screen.getByTestId("nav-row");

    // The two sidebar families disagree about the cross axis — the history row
    // is a column, the nav row a centred line — so the site keeps it.
    expect(row).toHaveClass("sidebar-row-geometry", "flex");
    expect(row.className).not.toContain("items-");
    expect(row.className).not.toContain("justify-");
    expect(row.className).not.toContain("px-");
    expect(row.className).not.toContain("gap-");
  });

  it("emits the list geometry, its own hook and a focus-visible ring", () => {
    render(
      <Row variant="list" data-testid="list-row">
        Pirate
      </Row>,
    );

    const row = screen.getByTestId("list-row");

    expect(row).toHaveClass("list-row-geometry", "flex", "focus-ring-inset");
    expect(row).toHaveAttribute("data-ui", "list-row");
    // A plain list has no roving walk, so the menu's `:focus` recipe would put
    // an active surface on a row the user merely tabbed past.
    expect(row.className).not.toContain("focus:ring-1");
    expect(row.className).toContain("hover:bg-theme-bg-hover");
    // Cross axis belongs to the site: these rows stack their lines.
    expect(row.className).not.toContain("items-");
    expect(row.className).not.toContain("px-");
  });

  it("keeps the list row out of the roving walk", () => {
    render(
      <>
        <Row variant="list" data-testid="list-row">
          Pirate
        </Row>
        <Row variant="menu" role="menuitem">
          Rename
        </Row>
      </>,
    );

    // `data-row-item` is how the menus find their navigable rows. A list row
    // shares the primitive but not the menu, and must never be walked into.
    expect(document.querySelectorAll(`[data-row-item]`)).toHaveLength(1);
    expect(screen.getByTestId("list-row")).not.toHaveAttribute("data-row-item");
  });

  it("never writes an inline style", () => {
    render(
      <>
        <Row variant="sidebar" as="div" selected data-testid="sidebar-row">
          Yesterday&apos;s chat
        </Row>
        <Row variant="menu" role="menuitem">
          Rename
        </Row>
      </>,
    );

    // The row height and radius are reachable from a customer theme only for
    // as long as they come from the class and not from a style attribute.
    expect(screen.getByTestId("sidebar-row")).not.toHaveAttribute("style");
    expect(screen.getByRole("menuitem")).not.toHaveAttribute("style");
  });

  it("emits data-selected as a presence boolean", () => {
    render(
      <>
        <Row variant="sidebar" as="div" data-testid="idle-row">
          Yesterday&apos;s chat
        </Row>
        <Row variant="sidebar" as="div" selected data-testid="active-row">
          Today&apos;s chat
        </Row>
      </>,
    );

    const idle = screen.getByTestId("idle-row");
    const active = screen.getByTestId("active-row");

    expect(idle).not.toHaveAttribute("data-selected");
    expect(idle).not.toHaveClass("sidebar-row-selected");
    expect(idle).toHaveClass("hover:bg-[var(--theme-shell-sidebar-hover)]");

    expect(active).toHaveAttribute("data-selected", "true");
    expect(active).toHaveClass("sidebar-row-selected");
    // A selected row paints its own surface; the hover tint would fight it.
    expect(active).not.toHaveClass(
      "hover:bg-[var(--theme-shell-sidebar-hover)]",
    );
  });

  it("rings the sidebar row only where the row itself takes focus", () => {
    render(
      <>
        <Row variant="sidebar" as="div" data-testid="linked-row">
          Inside a link
        </Row>
        <Row
          variant="sidebar"
          as="div"
          onClick={vi.fn()}
          data-testid="clickable-row"
        >
          Its own control
        </Row>
      </>,
    );

    const linked = screen.getByTestId("linked-row");
    const clickable = screen.getByTestId("clickable-row");

    expect(linked).not.toHaveClass("focus-ring-inset");
    expect(linked).not.toHaveAttribute("role");
    expect(linked).not.toHaveAttribute("tabindex");

    expect(clickable).toHaveClass("focus-ring-inset");
    expect(clickable).toHaveAttribute("role", "button");
    expect(clickable).toHaveAttribute("tabindex", "0");
  });

  it("gives the sidebar variant no family hook and honours an override", () => {
    render(
      <>
        <Row variant="sidebar" as="div" data-testid="unhooked-row">
          New Chat
        </Row>
        <Row
          variant="sidebar"
          as="div"
          data-ui="chat-history-item"
          data-testid="hooked-row"
        >
          Today&apos;s chat
        </Row>
        <Row variant="menu" role="menuitem" data-ui="delegation-run-mode-item">
          Wait for the result
        </Row>
      </>,
    );

    expect(screen.getByTestId("unhooked-row")).not.toHaveAttribute("data-ui");
    expect(screen.getByTestId("hooked-row")).toHaveAttribute(
      "data-ui",
      "chat-history-item",
    );
    expect(screen.getByRole("menuitem")).toHaveAttribute(
      "data-ui",
      "delegation-run-mode-item",
    );
  });

  it("keeps aria-disabled rows in the roving list and native ones out", () => {
    const { container } = render(
      <div role="menu">
        <Row variant="menu" role="menuitem">
          Reachable
        </Row>
        <Row variant="menu" role="menuitem" disabled>
          Skipped
        </Row>
        <Row
          variant="menu"
          role="menuitemcheckbox"
          checked={false}
          disabled
          disabledMode="aria"
        >
          Reachable but unavailable
        </Row>
      </div>,
    );

    const navigable = Array.from(
      container.querySelectorAll<HTMLElement>(ROW_ITEM_SELECTOR),
    );

    expect(navigable.map((row) => row.textContent)).toEqual([
      "Reachable",
      "Reachable but unavailable",
    ]);
    expect(screen.getByText("Skipped")).toHaveAttribute("disabled");
    expect(screen.getByText("Skipped")).not.toHaveAttribute("aria-disabled");

    const ariaRow = screen.getByText("Reachable but unavailable");
    expect(ariaRow).toHaveAttribute("aria-disabled", "true");
    expect(ariaRow).not.toHaveAttribute("disabled");
    expect(ariaRow).toHaveClass(
      "aria-disabled:cursor-not-allowed",
      "aria-disabled:opacity-50",
    );
  });

  it("renders the leading, description and trailing slots around the body", () => {
    render(
      <Row
        variant="menu"
        role="menuitem"
        align="start"
        leading={<span data-testid="row-icon" />}
        description="thread.eml"
        trailing={<span data-testid="row-size">12 KB</span>}
      >
        Email thread
      </Row>,
    );

    const row = screen.getByRole("menuitem");

    expect(row).toHaveClass("items-start");
    expect(row).not.toHaveClass("items-center");
    expect(row.firstElementChild).toBe(screen.getByTestId("row-icon"));
    // The trailing node is pushed right by its own margin rather than by a
    // justify-between on the row, which would fight the row's gap and break
    // under items-start.
    expect(screen.getByTestId("row-size").parentElement).toHaveClass("ml-auto");
    expect(screen.getByText("thread.eml")).toHaveClass("truncate", "text-xs");
    expect(screen.getByText("Email thread")).toHaveClass("truncate");
  });

  it("renders children bare when no description is given", () => {
    render(
      <Row variant="sidebar" as="div" data-testid="bare-row">
        <span data-testid="row-body">Today&apos;s chat</span>
      </Row>,
    );

    expect(screen.getByTestId("bare-row").firstElementChild).toBe(
      screen.getByTestId("row-body"),
    );
  });

  it("emits aria-current and aria-expanded from their props", () => {
    render(
      <>
        <Row variant="sidebar" as="div" current selected data-testid="page-row">
          Assistants
        </Row>
        <Row variant="menu" role="menuitem" expanded aria-haspopup="menu">
          Sort
        </Row>
      </>,
    );

    expect(screen.getByTestId("page-row")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("menuitem")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders the anchor and label tags and forwards a ref", () => {
    const buttonRef = createRef<HTMLElement>();
    render(
      <>
        <Row variant="menu" as="a" href="/chat/1" role="menuitem">
          Open chat
        </Row>
        <Row variant="menu" as="label" htmlFor="tool-toggle">
          Web search
        </Row>
        <Row variant="menu" ref={buttonRef} role="menuitem">
          Rename
        </Row>
      </>,
    );

    expect(screen.getByRole("menuitem", { name: "Open chat" }).tagName).toBe(
      "A",
    );
    expect(screen.getByText("Web search").tagName).toBe("LABEL");
    expect(buttonRef.current).toBe(
      screen.getByRole("menuitem", { name: "Rename" }),
    );
  });

  it("appends the caller's layout classes after its own", () => {
    render(
      <Row
        variant="sidebar"
        as="div"
        className="sidebar-content-col-geometry flex-col gap-1 py-1.5"
        data-testid="history-row"
      >
        Today&apos;s chat
      </Row>,
    );

    const row = screen.getByTestId("history-row");

    expect(row).toHaveClass(
      "sidebar-row-geometry",
      "sidebar-content-col-geometry",
      "flex-col",
      "gap-1",
      "py-1.5",
    );
  });
});
