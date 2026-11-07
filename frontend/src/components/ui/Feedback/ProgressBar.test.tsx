import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "./ProgressBar";

const fill = (bar: HTMLElement) =>
  bar.querySelector<HTMLElement>('[data-ui="progress-fill"]');

describe("ProgressBar", () => {
  it("exposes a named determinate progressbar", () => {
    render(
      <ProgressBar
        value={1}
        max={2}
        label="Policy check"
        valueText="1 of 2 items checked"
      />,
    );

    const bar = screen.getByRole("progressbar", { name: "Policy check" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "2");
    expect(bar).toHaveAttribute("aria-valuenow", "1");
    expect(bar).toHaveAttribute("aria-valuetext", "1 of 2 items checked");
    expect(bar).toHaveAttribute("data-ui", "progress");
    expect(bar).toHaveAttribute("data-size", "md");
    expect(bar).not.toHaveAttribute("data-tone");
    expect(bar).toHaveClass("progress-geometry", "progress-skin");
    expect(fill(bar)?.style.inlineSize).toBe("50%");
  });

  it.each([
    [-3, 10, "0", "0%"],
    [15, 10, "10", "100%"],
    [Number.NaN, 10, "0", "0%"],
    [5, 0, "0", "0%"],
  ])("clamps value %s of max %s", (value, max, now, width) => {
    render(<ProgressBar value={value} max={max} label="Upload" />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", now);
    expect(fill(bar)?.style.inlineSize).toBe(width);
  });

  it("defaults max to 100 and omits valuetext", () => {
    render(<ProgressBar value={25} label="Upload" />);

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).not.toHaveAttribute("aria-valuetext");
    expect(fill(bar)?.style.inlineSize).toBe("25%");
  });

  it("emits tone and size, and takes a caller hook", () => {
    render(
      <ProgressBar
        value={1}
        label="Upload"
        tone="warning"
        size="sm"
        data-ui="review-progress"
      />,
    );

    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("data-tone", "warning");
    expect(bar).toHaveAttribute("data-size", "sm");
    expect(bar).toHaveAttribute("data-ui", "review-progress");
  });
});
