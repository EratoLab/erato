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
    const overlay = document.querySelector('[data-ui="modal-overlay"]');

    expect(dialog).toHaveAttribute("data-ui", "modal-shell");
    expect(dialog).toHaveStyle({
      backgroundColor: "var(--theme-shell-modal)",
      borderRadius: "var(--theme-radius-modal)",
      boxShadow: "var(--theme-elevation-modal)",
    });
    expect(dialog.className).toContain("focus:ring-[var(--theme-focus-ring)]");
    expect(overlay).toBeTruthy();
    expect(overlay).toHaveStyle({
      backgroundColor: "var(--theme-overlay-modal)",
    });
  });
});
