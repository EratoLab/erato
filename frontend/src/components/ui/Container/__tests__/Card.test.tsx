import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Card } from "../Card";

describe("Card", () => {
  it("emits the family classes, hook and variant on the frame", () => {
    render(
      <Card variant="surface" data-testid="card">
        Assistant
      </Card>,
    );

    const card = screen.getByTestId("card");

    expect(card).toHaveClass(
      "card-geometry",
      "card-skin",
      "border",
      "card-inset-md",
    );
    expect(card).toHaveAttribute("data-ui", "card");
    expect(card).toHaveAttribute("data-variant", "surface");
    // The corner comes from the geometry class alone: a rounding utility here
    // would sit outside every token and no theme could reach it.
    expect(card.className).not.toContain("rounded");
    // A plain surface answers nothing, so it carries none of the transition
    // machinery the reactive variants need.
    expect(card.className).not.toContain("theme-transition");
    expect(card.className).not.toContain("cursor-pointer");
    expect(card.className).not.toContain("focus-ring");
  });

  it("renders the tag it is given and never one inferred from the variant", () => {
    render(
      <>
        <Card variant="surface" as="article" data-testid="article-card">
          In a list
        </Card>
        <Card variant="interactive" as="a" href="/chat/1">
          A search result
        </Card>
        <Card variant="selectable" as="label" htmlFor="mode-fast">
          Fast
        </Card>
        <Card variant="expandable" as="section" data-testid="section-card">
          A settings panel
        </Card>
      </>,
    );

    expect(screen.getByTestId("article-card").tagName).toBe("ARTICLE");
    expect(screen.getByRole("link", { name: "A search result" }).tagName).toBe(
      "A",
    );
    expect(screen.getByText("Fast").closest("label")).not.toBeNull();
    expect(screen.getByTestId("section-card").tagName).toBe("SECTION");
  });

  it("gives a tag that is inline by default a display of its own", () => {
    render(
      <>
        <Card variant="selectable" as="label" data-testid="label-frame">
          Fast
        </Card>
        <Card variant="interactive" as="a" href="/chat/1" data-testid="a-frame">
          A search result
        </Card>
        <Card variant="surface" as="section" data-testid="block-frame">
          A settings panel
        </Card>
      </>,
    );

    expect(screen.getByTestId("label-frame")).toHaveClass("block");
    expect(screen.getByTestId("a-frame")).toHaveClass("block");
    expect(screen.getByTestId("block-frame")).not.toHaveClass("block");
  });

  it("spreads unknown props and forwards a ref onto the frame", () => {
    const ref = createRef<HTMLElement>();
    const onDrop = vi.fn();

    render(
      <Card
        variant="interactive"
        ref={ref}
        // The shape react-dropzone's getRootProps() hands over: a ref, a role
        // it names itself, a tabIndex and drag handlers, none of which Card
        // knows about.
        role="presentation"
        tabIndex={0}
        onDrop={onDrop}
        data-testid="drop-zone"
      >
        Drop files here
      </Card>,
    );

    const frame = screen.getByTestId("drop-zone");

    expect(ref.current).toBe(frame);
    expect(frame).toHaveAttribute("role", "presentation");
    expect(frame).toHaveAttribute("tabindex", "0");
  });

  it("puts the body inside a wrapper of its own", () => {
    const { container } = render(
      <Card variant="surface" bodyId="panel" bodyClassName="space-y-3">
        <span data-testid="body-content">Details</span>
      </Card>,
    );

    const body = container.querySelector('[data-ui="card-body"]');

    // The body is a separate element on purpose: it is what publishes the
    // corner a nested card derives from, and a frame that both declared and
    // read that value would be a custom-property cycle.
    expect(body).toHaveClass("card-body-geometry", "space-y-3");
    expect(body).toHaveAttribute("id", "panel");
    expect(body).toContainElement(screen.getByTestId("body-content"));
    expect(body?.parentElement).toHaveClass("card-geometry");
  });

  it("orders the bands around the body and marks each one a section", () => {
    const { container } = render(
      <Card
        variant="surface"
        media={<span data-testid="thumb" />}
        header={<h3>OneDrive</h3>}
        action={<button type="button">Disconnect</button>}
        footer={<a href="/open">Open</a>}
      >
        Three files
      </Card>,
    );

    const frame = container.firstElementChild!;

    expect(
      Array.from(frame.children).map((child) => child.getAttribute("data-ui")),
    ).toEqual(["card-media", "card-header", "card-body", "card-footer"]);
    // No clipping anywhere on the frame: the bands round themselves to it, so
    // an offset focus ring drawn by a control inside one survives.
    expect(frame.className).not.toContain("overflow-hidden");
    for (const child of Array.from(frame.children)) {
      expect(child).toHaveClass("card-section");
    }
  });

  it("drops the corner policy off a body Collapse has moved a level down", () => {
    const { container } = render(
      <Card variant="expandable" expanded header={<span>MCP server</span>}>
        Tools
      </Card>,
    );

    const body = container.querySelector('[data-ui="card-body"]');

    // :first-child and :last-child would resolve against Collapse's own
    // wrapper here and round a body that sits under a header.
    expect(body?.parentElement).not.toHaveClass("card-geometry");
    expect(body).not.toHaveClass("card-section");
  });

  it("pushes the action to the end of the header band", () => {
    const { container } = render(
      <Card
        variant="expandable"
        header={<span>Local sidecar</span>}
        action={<button type="button">Retry</button>}
      >
        Connected
      </Card>,
    );

    const header = container.querySelector('[data-ui="card-header"]');

    expect(header).toHaveClass("flex", "items-center");
    expect(
      screen.getByRole("button", { name: "Retry" }).parentElement,
    ).toHaveClass("ml-auto", "shrink-0");
  });

  it("sticks the header band only when asked", () => {
    const { container } = render(
      <>
        <Card
          variant="surface"
          header={<span>Current email</span>}
          stickyHeader
        >
          One attachment
        </Card>
        <Card variant="surface" header={<span>Earlier</span>}>
          Two attachments
        </Card>
      </>,
    );

    const [sticky, plain] = Array.from(
      container.querySelectorAll('[data-ui="card-header"]'),
    );

    expect(sticky).toHaveClass("sticky", "top-0", "z-10");
    expect(plain.className).not.toContain("sticky");
  });

  it("emits the state attributes as presence booleans", () => {
    render(
      <>
        <Card variant="selectable" data-testid="idle">
          Balanced
        </Card>
        <Card variant="selectable" selected data-testid="chosen">
          Fast
        </Card>
        <Card variant="expandable" data-testid="closed">
          Hidden
        </Card>
        <Card variant="expandable" expanded data-testid="open">
          Shown
        </Card>
      </>,
    );

    expect(screen.getByTestId("idle")).not.toHaveAttribute("data-selected");
    expect(screen.getByTestId("chosen")).toHaveAttribute(
      "data-selected",
      "true",
    );

    // The frame states that it is open; the disclosure control in the header
    // is the one that carries aria-expanded.
    expect(screen.getByTestId("closed")).not.toHaveAttribute("data-expanded");
    expect(screen.getByTestId("open")).toHaveAttribute("data-expanded", "true");
    expect(screen.getByTestId("open")).not.toHaveAttribute("aria-expanded");
  });

  it("leaves the ARIA to the native control a selectable card frames", () => {
    render(
      <Card variant="selectable" as="label" control="radio" selected>
        <input type="radio" name="mode" value="fast" defaultChecked />
        Fast
      </Card>,
    );

    const frame = screen.getByText("Fast").closest("label")!;

    // The input inside is the widget; the frame only reports the choice for
    // the stylesheet and draws the ring the hidden input cannot show itself.
    expect(frame).not.toHaveAttribute("aria-pressed");
    expect(frame).not.toHaveAttribute("aria-checked");
    expect(frame).toHaveAttribute("data-selected", "true");
    expect(frame.className).toContain("[&:has(input:focus-visible)]:ring-2");
  });

  it("makes the frame itself the toggle when no native control carries it", () => {
    render(
      <>
        <Card variant="selectable" as="button" control="none" data-testid="off">
          Windows
        </Card>
        <Card
          variant="selectable"
          as="button"
          control="none"
          selected
          data-testid="on"
        >
          macOS
        </Card>
      </>,
    );

    // aria-pressed stays a real two-state on a toggle: "false" is what says
    // the button is a toggle that is currently off.
    expect(screen.getByTestId("off")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("on")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("off")).toHaveAttribute("type", "button");
  });

  it("keeps the closed body mounted unless asked to drop it", () => {
    const { container, rerender } = render(
      <Card variant="expandable">Server details</Card>,
    );

    // The default keeps the body so the close animation has something to
    // collapse; the tab stops inside it are the caller's problem to weigh.
    expect(container.querySelector('[data-ui="card-body"]')).not.toBeNull();

    rerender(
      <Card variant="expandable" unmountOnCollapse>
        Server details
      </Card>,
    );

    expect(container.querySelector('[data-ui="card-body"]')).toBeNull();

    rerender(
      <Card variant="expandable" expanded unmountOnCollapse>
        Server details
      </Card>,
    );

    expect(container.querySelector('[data-ui="card-body"]')).not.toBeNull();
  });

  it("keeps Collapse mounted while the body is dropped", () => {
    const { container } = render(
      <Card variant="expandable" unmountOnCollapse>
        Server details
      </Card>,
    );

    // The guard goes inside Collapse, not around it. Unmounting Collapse
    // itself would take the height transition with it and the card would snap
    // open and shut.
    const collapse = container.querySelector('[style*="grid-template-rows"]');

    expect(collapse).not.toBeNull();
    expect(collapse).toHaveStyle({ gridTemplateRows: "0fr" });
  });

  it("derives the nested inset only while the caller names none", () => {
    render(
      <>
        <Card variant="surface" nested data-testid="derived">
          Inherited step
        </Card>
        <Card variant="surface" nested size="lg" data-testid="pinned">
          Its own step
        </Card>
        <Card variant="surface" size="none" data-testid="flush">
          Flush
        </Card>
      </>,
    );

    const derived = screen.getByTestId("derived");

    expect(derived).toHaveClass("card-nested");
    expect(derived.className).not.toContain("card-inset-");

    expect(screen.getByTestId("pinned")).toHaveClass(
      "card-nested",
      "card-inset-lg",
    );
    expect(screen.getByTestId("flush")).toHaveClass("card-inset-none");
  });

  it("rings the frame only where the frame itself takes focus", () => {
    render(
      <>
        <Card variant="surface" data-testid="plain">
          Static
        </Card>
        <Card variant="interactive" as="button" data-testid="button-card">
          A category
        </Card>
        <Card
          variant="interactive"
          onClick={vi.fn()}
          role="button"
          data-testid="clickable-card"
        >
          A drop target
        </Card>
      </>,
    );

    expect(screen.getByTestId("plain").className).not.toContain("focus-ring");
    expect(screen.getByTestId("button-card")).toHaveClass("focus-ring");
    expect(screen.getByTestId("clickable-card")).toHaveClass("focus-ring");
  });

  it("states its tone on the shared enum and omits the neutral default", () => {
    render(
      <>
        <Card variant="surface" data-testid="neutral">
          Plain
        </Card>
        <Card variant="surface" tone="info" data-testid="info">
          Nothing here yet
        </Card>
      </>,
    );

    expect(screen.getByTestId("neutral")).not.toHaveAttribute("data-tone");
    expect(screen.getByTestId("info")).toHaveAttribute("data-tone", "info");
    // The tone paints through the skin's variables, so no colour utility comes
    // with it and a theme keeps one place to retune.
    expect(screen.getByTestId("info").className).not.toContain("bg-theme");
    expect(screen.getByTestId("info").className).not.toContain("border-theme");
  });

  it("says a card is unavailable where the tag cannot say it natively", () => {
    render(
      <>
        <Card variant="selectable" as="label" disabled data-testid="label-card">
          Locked by policy
        </Card>
        <Card
          variant="interactive"
          as="button"
          disabled
          data-testid="button-card"
        >
          Unavailable
        </Card>
      </>,
    );

    const label = screen.getByTestId("label-card");
    const button = screen.getByTestId("button-card");

    expect(label).toHaveAttribute("data-disabled", "true");
    expect(label).toHaveClass("opacity-60");

    // A native button already says it, so a second attribute would be a
    // duplicate the state contract does not mint.
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("data-disabled");
    expect(button.className).not.toContain("cursor-pointer");
  });

  it("drops the border when the card separates itself by fill alone", () => {
    render(
      <Card variant="interactive" bordered={false} data-testid="past-chat">
        Yesterday&apos;s chat
      </Card>,
    );

    const card = screen.getByTestId("past-chat");

    expect(card.className).not.toContain("border");
    expect(card).toHaveClass("card-skin", "theme-transition", "cursor-pointer");
  });

  it("honours a per-instance hook over the family default", () => {
    render(
      <Card variant="surface" data-ui="assistant-list-card" data-testid="card">
        Assistant
      </Card>,
    );

    expect(screen.getByTestId("card")).toHaveAttribute(
      "data-ui",
      "assistant-list-card",
    );
  });

  it("never writes an inline style", () => {
    render(
      <Card variant="selectable" selected size="xl" data-testid="card">
        Fast
      </Card>,
    );

    // Corner, inset and surface are reachable from a customer theme only for
    // as long as none of them comes from a style attribute.
    expect(screen.getByTestId("card")).not.toHaveAttribute("style");
  });
});
