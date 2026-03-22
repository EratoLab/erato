import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModalBase } from "./ModalBase";

afterEach(() => {
  cleanup();
});

describe("ModalBase", () => {
  it("renders stable overlay and shell hooks when open", () => {
    render(
      <ModalBase isOpen={true} onClose={vi.fn()} title="Theme Settings">
        <div>Modal content</div>
      </ModalBase>,
    );

    const dialog = screen.getByRole("dialog");
    const closeButton = screen.getByRole("button", { name: "Close modal" });
    const overlay = document.querySelector('[data-ui="modal-overlay"]');

    expect(dialog).toHaveAttribute("data-ui", "modal-shell");
    expect(dialog).toHaveStyle({
      backgroundColor: "var(--theme-shell-modal)",
      borderRadius: "var(--theme-radius-modal)",
      boxShadow: "var(--theme-elevation-modal)",
    });
    expect(dialog.className).toContain("focus-ring");
    expect(dialog.className).toContain("modal-shell-frame-geometry");
    expect(dialog.className).toContain("w-full");
    expect(closeButton.className).toContain("focus-ring-tight");
    expect(closeButton.className).not.toContain("p-1");
    expect(closeButton.getAttribute("style")).toContain(
      "right: var(--theme-spacing-modal-padding)",
    );
    expect(closeButton.getAttribute("style")).toContain(
      "top: var(--theme-spacing-modal-padding)",
    );
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute("style")).toContain(
      "background-color: var(--theme-overlay-modal)",
    );
    expect(overlay?.className).not.toContain("backdrop-blur-sm");
  });
});
