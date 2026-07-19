import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInputAddMenu } from "../ChatInputAddMenu";

/**
 * The trigger is rendered through `AnchoredPopover`'s render-prop, which hands
 * it a `ref` plus the aria/keyboard wiring. Since the trigger is a shared
 * `Button` (a forwardRef component) receiving that bag via spread, these tests
 * pin the wiring end-to-end — a dropped ref or swallowed handler would break
 * the popover silently rather than failing to compile.
 */
describe("ChatInputAddMenu", () => {
  const fileSources = [
    { key: "upload", label: "Upload from Computer", onSelect: vi.fn() },
  ];

  it("wires the popover contract onto the trigger", () => {
    render(<ChatInputAddMenu fileSources={fileSources} />);

    const trigger = screen.getByTestId("chat-input-add-menu-trigger");

    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("aria-controls");
    expect(trigger).toHaveAccessibleName("Add files and tools");
  });

  it("opens and closes the menu on click", () => {
    render(<ChatInputAddMenu fileSources={fileSources} />);

    const trigger = screen.getByTestId("chat-input-add-menu-trigger");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Upload from Computer")).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders the count badge alongside the icon, and drops it while processing", () => {
    const { rerender } = render(
      <ChatInputAddMenu fileSources={fileSources} selectedCount={3} />,
    );

    expect(screen.getByTestId("chat-input-add-menu-badge")).toHaveTextContent(
      "3",
    );

    rerender(
      <ChatInputAddMenu
        fileSources={fileSources}
        selectedCount={3}
        isProcessing
      />,
    );

    expect(
      screen.queryByTestId("chat-input-add-menu-badge"),
    ).not.toBeInTheDocument();
  });

  it("disables the trigger when disabled", () => {
    render(<ChatInputAddMenu fileSources={fileSources} disabled />);

    expect(screen.getByTestId("chat-input-add-menu-trigger")).toBeDisabled();
  });
});
