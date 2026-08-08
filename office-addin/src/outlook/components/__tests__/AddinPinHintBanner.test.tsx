import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinPinHintBanner } from "../AddinPinHintBanner";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
});

describe("AddinPinHintBanner", () => {
  it("renders the pin hint", () => {
    render(<AddinPinHintBanner onDismiss={vi.fn()} />);
    expect(screen.getByTestId("addin-pin-hint-banner")).toBeInTheDocument();
    expect(screen.getByText("Pin to follow your mail")).toBeInTheDocument();
  });

  it("calls onDismiss when dismissed", () => {
    const onDismiss = vi.fn();
    render(<AddinPinHintBanner onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
