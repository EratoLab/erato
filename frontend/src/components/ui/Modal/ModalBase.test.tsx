import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModalBase } from "./ModalBase";

afterEach(() => {
  cleanup();
});

describe("ModalBase", () => {
  it("renders stable overlay and shell hooks when open", () => {
    const onClose = vi.fn();
    render(
      <ModalBase isOpen={true} onClose={onClose} title="Theme Settings">
        <div>Modal content</div>
      </ModalBase>,
    );

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close modal" });
    const overlay = document.querySelector('[data-ui="modal-overlay"]');

    expect(dialog).toHaveAttribute("data-ui", "modal-shell");
    expect(dialog).toHaveClass("modal-shell-skin");
    expect(dialog.getAttribute("style") ?? "").toBe("");
    expect(dialog.className).toContain("focus-ring");
    expect(dialog.className).toContain("modal-shell-frame-geometry");
    expect(dialog.className).toContain("w-full");
    expect(closeButton.className).toContain("focus-ring-tight");
    expect(closeButton.className).not.toContain("p-1");
    expect(closeButton).toHaveClass("modal-close-geometry");
    expect(overlay).toBeTruthy();
    expect(overlay).toHaveClass("modal-overlay-skin");
    expect(overlay?.getAttribute("style") ?? "").toBe("");
    expect(overlay?.className).not.toContain("backdrop-blur-sm");
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("does not refocus the shell when onClose changes", () => {
    // Focus sits outside the shell, as in a portaled menu opened from the
    // dialog, so only the effect's keying keeps it there.
    const ui = (onClose: () => void) => (
      <>
        <button data-testid="outside" />
        <ModalBase isOpen={true} onClose={onClose} title="Search">
          <input data-testid="field" />
        </ModalBase>
      </>
    );
    const { rerender } = render(ui(vi.fn()));
    expect(screen.getByRole("dialog")).toHaveFocus();

    const outside = screen.getByTestId("outside");
    outside.focus();
    rerender(ui(vi.fn()));

    expect(outside).toHaveFocus();
  });

  it("keeps an autoFocus child focused", () => {
    render(
      <ModalBase isOpen={true} onClose={vi.fn()} title="Search">
        <input
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the case under test
          autoFocus
          data-testid="field"
        />
      </ModalBase>,
    );

    expect(screen.getByTestId("field")).toHaveFocus();
  });

  it("does not close on the Escape that dismisses an IME candidate", () => {
    const onClose = vi.fn();
    render(
      <ModalBase isOpen={true} onClose={onClose} title="Add a comment">
        <textarea data-testid="field" />
      </ModalBase>,
    );
    const field = screen.getByTestId("field");
    field.focus();

    fireEvent.keyDown(field, {
      key: "Escape",
      keyCode: 229,
      isComposing: true,
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("names each stacked dialog by its own title", () => {
    render(
      <>
        <ModalBase isOpen={true} onClose={vi.fn()} title="Teams conversation">
          <p>Messages</p>
        </ModalBase>
        <ModalBase
          isOpen={true}
          onClose={vi.fn()}
          title="Preview: dashboard.png"
        >
          <p>Image</p>
        </ModalBase>
      </>,
    );

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    const titleIds = dialogs.map((dialog) =>
      dialog.getAttribute("aria-labelledby"),
    );
    expect(titleIds[0]).toBeTruthy();
    expect(new Set(titleIds).size).toBe(2);
    for (const [index, dialog] of dialogs.entries()) {
      const heading = document.getElementById(titleIds[index] ?? "");
      expect(heading?.tagName).toBe("H2");
      expect(dialog).toContainElement(heading);
    }
    expect(
      screen.getAllByRole("dialog", { name: "Teams conversation" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("dialog", { name: "Preview: dashboard.png" }),
    ).toHaveLength(1);
  });

  it("leaves an untitled dialog unlabelled", () => {
    render(
      <ModalBase isOpen={true} onClose={vi.fn()}>
        <p>Body</p>
      </ModalBase>,
    );

    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-labelledby");
  });
});
