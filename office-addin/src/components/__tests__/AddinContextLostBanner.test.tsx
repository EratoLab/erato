import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinContextLostBanner } from "../AddinContextLostBanner";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
});

describe("AddinContextLostBanner", () => {
  it("renders the lost-context message", () => {
    render(<AddinContextLostBanner onRetry={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByTestId("addin-context-lost-banner")).toBeInTheDocument();
    expect(screen.getByText("Message context lost")).toBeInTheDocument();
  });

  it("calls onRetry when Retry is pressed", () => {
    const onRetry = vi.fn();
    render(<AddinContextLostBanner onRetry={onRetry} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("calls onDismiss when the dismiss control is pressed", () => {
    const onDismiss = vi.fn();
    render(<AddinContextLostBanner onRetry={vi.fn()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
