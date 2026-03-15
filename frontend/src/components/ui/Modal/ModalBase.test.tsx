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
    expect(dialog).toHaveAttribute("data-ui", "modal-shell");
    expect(document.querySelector('[data-ui="modal-overlay"]')).toBeTruthy();
  });
});
