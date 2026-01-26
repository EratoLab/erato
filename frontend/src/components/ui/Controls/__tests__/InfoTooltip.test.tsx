import { i18n } from "@lingui/core";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { InfoTooltip } from "../InfoTooltip";

import type { Messages } from "@lingui/core";

describe("InfoTooltip", () => {
  afterEach(() => {
    // Restore original English messages after each test
    i18n.load("en", enMessages as unknown as Messages);
    i18n.activate("en");
  });

  it("should render nothing when translation does not exist", () => {
    const { container } = render(
      <InfoTooltip translationId="test.nonexistent.tooltip.xyz" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("should render the info icon when translation exists", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.exists": "This is helpful information",
    });
    i18n.activate("en");

    render(<InfoTooltip translationId="test.tooltip.exists" />);

    // Should render a button with the info icon
    const button = screen.getByRole("button", { name: /more information/i });
    expect(button).toBeInTheDocument();
  });

  it("should render nothing when translation is empty", () => {
    // Add an empty translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.empty": "",
    });
    i18n.activate("en");

    const { container } = render(
      <InfoTooltip translationId="test.tooltip.empty" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("should apply custom className", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.classname": "Test tooltip",
    });
    i18n.activate("en");

    render(
      <InfoTooltip
        translationId="test.tooltip.classname"
        // eslint-disable-next-line tailwindcss/no-custom-classname
        className="custom-test-class"
      />,
    );

    const button = screen.getByRole("button", { name: /more information/i });
    expect(button).toHaveClass("custom-test-class");
  });

  it("should use small size by default", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.size": "Test tooltip",
    });
    i18n.activate("en");

    render(<InfoTooltip translationId="test.tooltip.size" />);

    const button = screen.getByRole("button", { name: /more information/i });
    const svg = button.querySelector("svg");

    expect(svg).toHaveClass("h-3.5", "w-3.5");
  });

  it("should apply medium size when specified", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.size.md": "Test tooltip",
    });
    i18n.activate("en");

    render(<InfoTooltip translationId="test.tooltip.size.md" size="md" />);

    const button = screen.getByRole("button", { name: /more information/i });
    const svg = button.querySelector("svg");

    expect(svg).toHaveClass("h-4", "w-4");
  });

  it("should have cursor-help class for accessibility indication", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.cursor": "Test tooltip",
    });
    i18n.activate("en");

    render(<InfoTooltip translationId="test.tooltip.cursor" />);

    const button = screen.getByRole("button", { name: /more information/i });
    expect(button).toHaveClass("cursor-help");
  });

  it("should have proper accessibility attributes", () => {
    // Add a test translation
    i18n.load("en", {
      ...(enMessages as unknown as Messages),
      "test.tooltip.a11y": "Accessible tooltip content",
    });
    i18n.activate("en");

    render(<InfoTooltip translationId="test.tooltip.a11y" />);

    const button = screen.getByRole("button", { name: /more information/i });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-label");
  });
});
