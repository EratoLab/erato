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
    { id: "upload", label: "Upload from Computer", onSelect: vi.fn() },
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

  /**
   * `extraContent` is a seam an out-of-repo host can fill with its own markup,
   * so the injected row here is a raw button carrying the row marker by hand
   * rather than a `Row`. It must take its place in the walk by document order,
   * not by where it sits in the selector.
   *
   * The same walk pins which rows drop out: a natively-disabled row is skipped,
   * an `aria-disabled` one is not. An unavailable tool has to stay reachable to
   * say why it is unavailable.
   */
  it("roves over injected and own rows in document order, skipping only natively-disabled ones", () => {
    render(
      <ChatInputAddMenu
        fileSources={[
          { id: "upload", label: "Upload from Computer", onSelect: vi.fn() },
          {
            id: "cloud",
            label: "Sharepoint",
            onSelect: vi.fn(),
            disabled: true,
          },
        ]}
        extraContent={() => (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-row-item=""
            data-testid="injected-row"
          >
            Email thread
          </button>
        )}
        tools={[
          {
            id: "search",
            label: "Web search",
            checked: false,
            onToggle: vi.fn(),
          },
          {
            id: "code",
            label: "Code interpreter",
            checked: false,
            disabled: true,
            onToggle: vi.fn(),
          },
        ]}
      />,
    );

    // detail 1 is a pointer open, which leaves focus on the panel; a
    // keyboard open would have focused the first row already.
    fireEvent.click(screen.getByTestId("chat-input-add-menu-trigger"), {
      detail: 1,
    });
    const menu = screen.getByRole("menu");

    // The unavailable tool announces itself rather than vanishing from the
    // keyboard walk; the unavailable file source is natively disabled and does.
    expect(screen.getByTestId("chat-input-add-menu-tool-code")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Sharepoint").closest("button")).toBeDisabled();

    const walk: (string | null)[] = [];
    for (let step = 0; step < 4; step += 1) {
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      walk.push(
        (document.activeElement as HTMLElement | null)?.textContent ?? null,
      );
    }

    expect(walk).toEqual([
      "Upload from Computer",
      "Email thread",
      "Web search",
      "Code interpreter",
    ]);
  });
});
