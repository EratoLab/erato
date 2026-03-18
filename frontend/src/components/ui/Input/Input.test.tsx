import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Input } from "./Input";
import { Textarea } from "./Textarea";

const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "offsetHeight",
);
const originalClientHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "clientHeight",
);
const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "scrollHeight",
);

function restoreDescriptor(
  property: "offsetHeight" | "clientHeight" | "scrollHeight",
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(HTMLTextAreaElement.prototype, property, descriptor);
    return;
  }

  Reflect.deleteProperty(HTMLTextAreaElement.prototype, property);
}

describe("Input tokens", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    restoreDescriptor("offsetHeight", originalOffsetHeightDescriptor);
    restoreDescriptor("clientHeight", originalClientHeightDescriptor);
    restoreDescriptor("scrollHeight", originalScrollHeightDescriptor);
  });

  it("applies the themed input radius and padding to Input", () => {
    render(<Input aria-label="Name" />);

    const input = screen.getByRole("textbox", { name: "Name" });

    expect(input.className).toContain(
      "[border-radius:var(--theme-radius-input)]",
    );
    expect(input.className).toContain(
      "[padding:var(--theme-spacing-input-padding-y)_var(--theme-spacing-input-padding-x)]",
    );
  });

  it("applies the themed input radius and padding to Textarea", () => {
    render(<Textarea aria-label="Notes" />);

    const textarea = screen.getByRole("textbox", { name: "Notes" });

    expect(textarea.className).toContain(
      "[border-radius:var(--theme-radius-input)]",
    );
    expect(textarea.className).toContain(
      "[padding:var(--theme-spacing-input-padding-y)_var(--theme-spacing-input-padding-x)]",
    );
  });

  it("uses the themed error focus ring for Input", () => {
    render(<Input aria-label="Name" error="Required" />);

    const input = screen.getByRole("textbox", { name: "Name" });

    expect(input.className).toContain("focus:ring-theme-focus-error");
    expect(input.className).not.toContain("focus:ring-red-500/20");
  });

  it("uses the themed error focus ring for Textarea", () => {
    render(<Textarea aria-label="Notes" error="Required" />);

    const textarea = screen.getByRole("textbox", { name: "Notes" });

    expect(textarea.className).toContain("focus:ring-theme-focus-error");
    expect(textarea.className).not.toContain("focus:ring-red-500/20");
  });

  it("sizes textarea auto-resize from rendered row metrics", () => {
    let mockScrollHeight = 40;

    Object.defineProperty(HTMLTextAreaElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return this.rows * 20;
      },
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return this.rows * 20;
      },
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return mockScrollHeight;
      },
    });

    const { rerender } = render(
      <Textarea
        aria-label="Prompt"
        autoResize
        monospace
        readOnly
        rows={3}
        maxRows={4}
        value="one line"
      />,
    );

    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    expect(textarea.style.height).toBe("60px");

    mockScrollHeight = 120;

    rerender(
      <Textarea
        aria-label="Prompt"
        autoResize
        monospace
        readOnly
        rows={3}
        maxRows={4}
        value={"one\ntwo\nthree\nfour\nfive"}
      />,
    );

    expect(textarea.style.height).toBe("80px");
  });
});
