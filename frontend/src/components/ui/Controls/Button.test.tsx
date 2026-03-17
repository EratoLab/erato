import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./Button";

describe("Button", () => {
  it("uses theme action classes for the primary variant", () => {
    render(<Button variant="primary">Primary Action</Button>);

    const button = screen.getByRole("button", { name: "Primary Action" });

    expect(button.className).toContain("bg-theme-action-primary-bg");
    expect(button.className).toContain("text-theme-action-primary-fg");
    expect(button.className).toContain("hover:bg-theme-action-primary-hover");
    expect(button.className).not.toContain("bg-neutral-800");
    expect(button.className).not.toContain("text-white");
    expect(button.className).not.toContain("hover:bg-neutral-700");
  });
});
