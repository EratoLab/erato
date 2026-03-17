import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Input } from "./Input";
import { Textarea } from "./Textarea";

describe("Input geometry tokens", () => {
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
});
