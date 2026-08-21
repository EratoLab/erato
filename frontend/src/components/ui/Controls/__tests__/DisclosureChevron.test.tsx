import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DisclosureChevron } from "../DisclosureChevron";

const renderChevron = (
  props: Partial<Parameters<typeof DisclosureChevron>[0]> = {},
) => {
  const { container } = render(<DisclosureChevron open={false} {...props} />);
  const icon = container.querySelector("svg");
  expect(icon).not.toBeNull();
  return icon as SVGElement;
};

describe("DisclosureChevron", () => {
  it("rotates 90° while open and rests at 0 while closed", () => {
    expect(renderChevron({ open: true })).toHaveClass("rotate-90");
    expect(renderChevron({ open: false })).toHaveClass("rotate-0");
  });

  it("sizes to its disclosure family", () => {
    expect(renderChevron()).toHaveClass("size-3");
    expect(renderChevron({ size: "md" })).toHaveClass("size-4");
  });

  it("stays decorative and accepts site-specific classes", () => {
    const icon = renderChevron({ className: "opacity-0" });
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveClass("opacity-0");
    expect(icon).toHaveClass("theme-transition");
  });
});
