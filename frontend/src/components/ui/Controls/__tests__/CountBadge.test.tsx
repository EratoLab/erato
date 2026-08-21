import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CountBadge } from "../CountBadge";

describe("CountBadge", () => {
  it("tones an attention badge with the action-primary pair", () => {
    render(
      <CountBadge variant="attention" data-testid="badge">
        3
      </CountBadge>,
    );

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveClass("bg-theme-action-primary-bg");
    expect(badge).toHaveClass("text-theme-action-primary-fg");
  });

  it("tones a passive count with the secondary pair", () => {
    render(
      <CountBadge variant="count" data-testid="badge">
        7
      </CountBadge>,
    );

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveClass("bg-theme-bg-secondary");
    expect(badge).toHaveClass("text-theme-fg-secondary");
  });

  it("stays out of the accessibility tree unless opted in", () => {
    const { rerender } = render(
      <CountBadge variant="count" data-testid="badge">
        7
      </CountBadge>,
    );
    expect(screen.getByTestId("badge")).toHaveAttribute("aria-hidden", "true");

    rerender(
      <CountBadge variant="count" aria-hidden={false} data-testid="badge">
        7
      </CountBadge>,
    );
    expect(screen.getByTestId("badge")).toHaveAttribute("aria-hidden", "false");
  });

  it("appends caller classes to the shared geometry", () => {
    render(
      <CountBadge variant="count" className="shrink-0" data-testid="badge">
        1
      </CountBadge>,
    );

    const badge = screen.getByTestId("badge");
    expect(badge).toHaveClass("rounded-full");
    expect(badge).toHaveClass("shrink-0");
  });
});
