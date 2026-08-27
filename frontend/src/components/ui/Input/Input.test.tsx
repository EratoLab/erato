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
    expect(input.className).toContain("border-[var(--theme-border-field)]");
    expect(input.className).toContain(
      "focus:border-[var(--theme-border-field-focus)]",
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
    expect(textarea.className).toContain("border-[var(--theme-border-field)]");
    expect(textarea.className).toContain(
      "focus:border-[var(--theme-border-field-focus)]",
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

  // There is no tailwind-merge in this repo, so `clsx("bg-a", disabled && "bg-b")`
  // is decided by position in the generated stylesheet, not by argument order —
  // and `bg-theme-bg-secondary` is emitted after `bg-theme-bg-primary`, so the
  // disabled branch used to lose. `disabled:` variants compile to a compound
  // selector (0,2,0) that beats the base utility (0,1,0) whatever the order.
  it.each([
    ["Input", () => <Input aria-label="Disabled field" disabled />],
    ["Textarea", () => <Textarea aria-label="Disabled field" disabled />],
  ])(
    "expresses %s's disabled styling as disabled: variants",
    (_name, renderField) => {
      render(renderField());

      const field = screen.getByRole("textbox", { name: "Disabled field" });

      for (const cls of [
        "disabled:bg-theme-bg-primary",
        "disabled:text-theme-fg-muted",
        "disabled:cursor-not-allowed",
        "disabled:opacity-50",
      ]) {
        expect(field.className).toContain(cls);
      }

      // The bare forms would lose to the base utilities on stylesheet position.
      const tokens = field.className.split(/\s+/);
      for (const cls of [
        "bg-theme-bg-primary",
        "text-theme-fg-muted",
        "cursor-not-allowed",
        "opacity-50",
      ]) {
        expect(tokens).not.toContain(cls);
      }

      // The enabled-state base utilities are still present and unconditional.
      expect(tokens).toContain("bg-theme-bg-secondary");
      expect(tokens).toContain("text-theme-fg-primary");
    },
  );

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
