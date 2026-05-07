import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoadingIndicator } from "./LoadingIndicator";

vi.mock("@/components/ui/icons", () => ({
  ToolsIcon: () => <svg aria-hidden="true" />,
  TimerIcon: () => <svg aria-hidden="true" />,
  BrainIcon: () => <svg aria-hidden="true" />,
}));

describe("LoadingIndicator", () => {
  it("keeps the default loading indicator layout and copy intact", () => {
    const { container } = render(
      <LoadingIndicator state="reasoning" context="Gathering context" />,
    );

    const indicator = container.firstElementChild;

    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("Gathering context")).toBeInTheDocument();
    expect(indicator?.className).toContain("flex");
    expect(indicator?.className).toContain("items-center");
    expect(indicator?.className).toContain("gap-2");
    expect(indicator?.className).toContain("text-theme-fg-secondary");
    expect(indicator?.className).toContain("animate-pulse");
  });

  it("only pulses for active loading states", () => {
    const { container, rerender } = render(
      <LoadingIndicator state="thinking" />,
    );

    expect(container.firstElementChild?.className).toContain("animate-pulse");

    rerender(<LoadingIndicator state="error" />);
    expect(container.firstElementChild?.className).not.toContain(
      "animate-pulse",
    );

    rerender(<LoadingIndicator state="done" />);
    expect(container.firstElementChild?.className).not.toContain(
      "animate-pulse",
    );
  });
});
