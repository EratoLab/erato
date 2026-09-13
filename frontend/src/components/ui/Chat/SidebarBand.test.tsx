import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarBand } from "./SidebarBand";

import type { SidebarBandProps } from "./SidebarBand";

const renderBand = (props: Partial<SidebarBandProps> = {}) => {
  const { container } = render(
    <SidebarBand edge="header" {...props}>
      <span>content</span>
    </SidebarBand>,
  );

  return container.firstElementChild as HTMLElement;
};

describe("SidebarBand", () => {
  // Exact strings, not toHaveClass: the header band's class list is what the
  // host emitted before the primitive existed, and an e2e spec pins the two
  // bands' heights to within half a pixel of each other through
  // .sidebar-band-geometry.
  it("emits the shipped header and footer class strings", () => {
    expect(renderBand({ edge: "header" })).toHaveAttribute(
      "class",
      "sidebar-section-skin sidebar-band-geometry flex border-b",
    );
    expect(renderBand({ edge: "footer" })).toHaveAttribute(
      "class",
      "sidebar-section-skin sidebar-band-geometry flex border-t",
    );
  });

  // Flush is a layout mode: padding, flex and the height formula all go, so
  // the lone child keeps its own width and row height.
  it("drops padding, flex and the band geometry when flush", () => {
    const band = renderBand({ edge: "footer", flush: true });

    expect(band).toHaveAttribute(
      "class",
      "sidebar-section-skin sidebar-band-flush border-t",
    );
    expect(band).not.toHaveClass("flex");
    expect(band).not.toHaveClass("sidebar-band-geometry");
  });

  // Everything paintable stays in classes so a customer theme can reach it.
  it("keeps the style attribute empty", () => {
    expect(renderBand().getAttribute("style")).toBeNull();
    expect(renderBand({ flush: true }).getAttribute("style")).toBeNull();
  });

  it("defaults the theme hook per edge and lets a caller override it", () => {
    expect(renderBand({ edge: "header" })).toHaveAttribute(
      "data-ui",
      "sidebar-header",
    );
    expect(renderBand({ edge: "footer" })).toHaveAttribute(
      "data-ui",
      "sidebar-footer",
    );
    expect(renderBand({ dataUi: "addin-drawer-header" })).toHaveAttribute(
      "data-ui",
      "addin-drawer-header",
    );
  });

  it("merges the caller's classes last", () => {
    expect(renderBand({ className: "items-center" })).toHaveAttribute(
      "class",
      "sidebar-section-skin sidebar-band-geometry flex border-b items-center",
    );
  });

  it("passes a ref through to the band element", () => {
    let element: HTMLDivElement | null = null;

    render(
      <SidebarBand
        edge="header"
        ref={(node) => {
          element = node;
        }}
      />,
    );

    expect(element).toBeInstanceOf(HTMLDivElement);
  });
});
