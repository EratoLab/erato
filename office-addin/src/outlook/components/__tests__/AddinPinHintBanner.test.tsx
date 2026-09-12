import { componentRegistry } from "@erato/frontend/library";
import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinPinHintBanner } from "../AddinPinHintBanner";

function KitAccessory() {
  return null;
}

function KitStartView() {
  return null;
}

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});

afterEach(() => {
  componentRegistry.ChatTopLeftAccessory = null;
  componentRegistry.AddinStartView = null;
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

  it("clears the floating drawer trigger without a kit accessory", () => {
    render(<AddinPinHintBanner onDismiss={vi.fn()} />);
    expect(screen.getByTestId("addin-pin-hint-banner")).toHaveClass("pl-10");
  });

  it("drops the trigger clearance when a kit accessory is registered", () => {
    componentRegistry.ChatTopLeftAccessory = KitAccessory;
    render(<AddinPinHintBanner onDismiss={vi.fn()} />);
    const banner = screen.getByTestId("addin-pin-hint-banner");
    expect(banner).toHaveClass("pl-4");
    expect(banner).not.toHaveClass("pl-10");
  });

  it("clears the start-view toggle only while the drawer trigger floats", () => {
    componentRegistry.AddinStartView = KitStartView;
    const { unmount } = render(<AddinPinHintBanner onDismiss={vi.fn()} />);
    expect(screen.getByTestId("addin-pin-hint-banner")).toHaveClass("pr-10");
    unmount();

    componentRegistry.ChatTopLeftAccessory = KitAccessory;
    render(<AddinPinHintBanner onDismiss={vi.fn()} />);
    const banner = screen.getByTestId("addin-pin-hint-banner");
    expect(banner).toHaveClass("pr-4");
    expect(banner).not.toHaveClass("pr-10");
  });
});
