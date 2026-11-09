import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { ActionBar } from "../ActionBar";
import { DetailPane, DetailPaneSection } from "../DetailPane";
import { ListGroupHeading } from "../ListGroupHeading";
import { ListToolbar } from "../ListToolbar";
import { MasterDetailLayout } from "../MasterDetailLayout";
import { PageHeader } from "../PageHeader";

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "page-container",
    textAlignment: "page-align",
    horizontalPadding: "page-padding",
  }),
}));

describe("window layout pieces", () => {
  it("ListToolbar passes its attributes and takes a theme hook", () => {
    const { rerender } = render(
      <ListToolbar role="group" aria-label="Selection">
        controls
      </ListToolbar>,
    );
    const toolbar = screen.getByRole("group", { name: "Selection" });
    expect(toolbar.dataset.ui).toBe("list-toolbar");
    rerender(<ListToolbar data-ui="other">controls</ListToolbar>);
    expect(screen.getByText("controls").dataset.ui).toBe("other");
  });

  it("ActionBar separates the status from the decisions", () => {
    render(
      <ActionBar status={<span>checking</span>} data-status="busy">
        <button type="button">Share</button>
      </ActionBar>,
    );
    expect(
      screen.getByText("checking").closest('[data-ui="action-bar-status"]'),
    ).not.toBeNull();
    const actions = screen
      .getByRole("button", { name: "Share" })
      .closest('[data-ui="action-bar-actions"]');
    expect(actions).not.toBeNull();
    expect(
      actions?.closest<HTMLElement>('[data-ui="action-bar"]')?.dataset.status,
    ).toBe("busy");
  });

  it("MasterDetailLayout reports whether the detail is open", () => {
    const listRef = createRef<HTMLDivElement>();
    const { container, rerender } = render(
      <MasterDetailLayout list="items" listRef={listRef} />,
    );
    const root = () => container.firstElementChild as HTMLElement;
    expect(root().dataset.detailOpen).toBeUndefined();
    expect(listRef.current?.dataset.ui).toBe("master-detail-list");
    expect(
      container.querySelector('[data-ui="master-detail-detail"]'),
    ).toBeNull();
    rerender(<MasterDetailLayout list="items" detail="one item" />);
    expect(root().dataset.detailOpen).toBe("true");
    expect(
      container.querySelector('[data-ui="master-detail-detail"]')?.textContent,
    ).toBe("one item");
  });

  it.each([[false], [true], [""], [[]], [null]])(
    "MasterDetailLayout keeps the pane closed for %j",
    (detail) => {
      const { container } = render(
        <MasterDetailLayout list="items" detail={detail} />,
      );
      expect(
        (container.firstElementChild as HTMLElement).dataset.detailOpen,
      ).toBeUndefined();
      expect(
        container.querySelector('[data-ui="master-detail-detail"]'),
      ).toBeNull();
    },
  );

  it("MasterDetailLayout treats zero as content", () => {
    const { container } = render(
      <MasterDetailLayout list="items" detail={0} />,
    );
    expect(
      container.querySelector('[data-ui="master-detail-detail"]')?.textContent,
    ).toBe("0");
  });

  it("DetailPane is labelled by its title and closes only when it can", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <DetailPane title="An item" titleId="pane-title">
        <DetailPaneSection title="Body" hint="view only">
          text
        </DetailPaneSection>
      </DetailPane>,
    );
    expect(screen.getByRole("region", { name: "An item" })).toBeDefined();
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(
      "Body view only",
    );
    expect(screen.queryByRole("button")).toBeNull();
    rerender(
      <DetailPane
        title="An item"
        titleId="pane-title"
        onClose={onClose}
        closeLabel="Close"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("DetailPane names its close button by default", () => {
    render(<DetailPane title="An item" titleId="t" onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Close" })).toBeDefined();
  });

  it("DetailPane scrolls its sections and keeps its heading in place", () => {
    const { container } = render(
      <DetailPane title="An item" titleId="t">
        <p>text</p>
      </DetailPane>,
    );
    const body = container.querySelector('[data-ui="detail-pane-body"]');
    expect(body?.className).toContain("overflow-auto");
    expect(body?.textContent).toBe("text");
    expect(body?.querySelector('[data-ui="detail-pane-head"]')).toBeNull();
  });

  it("DetailPaneSection keeps a caller's theme hook", () => {
    const { container } = render(
      <DetailPaneSection title="Body" data-ui="custom">
        text
      </DetailPaneSection>,
    );
    expect((container.firstElementChild as HTMLElement).dataset.ui).toBe(
      "custom",
    );
  });

  it("ListGroupHeading is a heading with a theme hook", () => {
    render(<ListGroupHeading>Search</ListGroupHeading>);
    expect(screen.getByRole("heading", { level: 2 }).dataset.ui).toBe(
      "list-group-heading",
    );
  });

  it("ListGroupHeading keeps a caller's theme hook", () => {
    render(<ListGroupHeading data-ui="custom">Search</ListGroupHeading>);
    expect(screen.getByRole("heading", { level: 2 }).dataset.ui).toBe("custom");
  });

  it("ListGroupHeading has a small-capitals label for page lists", () => {
    render(<ListGroupHeading variant="overline">Today</ListGroupHeading>);
    expect(screen.getByRole("heading", { level: 2 }).className).toContain(
      "uppercase",
    );
  });
});

describe("PageHeader", () => {
  it("leaves the heading out of focus unless a caller asks", () => {
    render(<PageHeader title="Title" />);
    expect(screen.getByRole("heading").hasAttribute("tabindex")).toBe(false);
  });

  it("takes a rich subtitle and focuses its title without a ring", () => {
    const titleRef = createRef<HTMLHeadingElement>();
    render(
      <PageHeader
        title="Title"
        titleId="t"
        subtitle={<strong>Bold</strong>}
        subtitleId="s"
        titleRef={titleRef}
        density="window"
      />,
    );
    expect(titleRef.current?.tabIndex).toBe(-1);
    expect(titleRef.current?.className).toContain("outline-none");
    expect(titleRef.current?.id).toBe("t");
    expect(screen.getByText("Bold").closest("p")?.id).toBe("s");
  });

  it("drops the page rule and alignment in a window", () => {
    const { container } = render(<PageHeader title="Title" density="window" />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.className).not.toContain("border-b");
    expect(header.className).not.toContain("page-padding");
    expect(screen.getByRole("heading").className).not.toContain("page-align");
  });

  it("is a header without a fill of its own, in the theme's heading font", () => {
    const { container } = render(<PageHeader title="Title" density="window" />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.tagName).toBe("HEADER");
    expect(header.className).not.toContain("bg-theme-bg-primary");
    expect(screen.getByRole("heading").className).toContain("font-heading");
  });

  it("keeps the page fill outside a window", () => {
    const { container } = render(<PageHeader title="Title" />);
    const header = container.firstElementChild as HTMLElement;
    expect(header.tagName).toBe("DIV");
    expect(header.className).toContain("bg-theme-bg-primary");
  });
});
