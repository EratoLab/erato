import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallOutput } from "./ToolCallOutput";

describe("ToolCallOutput", () => {
  it("preserves multiline result strings", () => {
    const result = "First line\n\n  Indented  line";
    const { container } = render(<ToolCallOutput output={{ result }} />);
    const value = container.querySelector("span.text-theme-success-fg");

    expect(value?.textContent).toBe(`"${result}"`);
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
  });

  it("uses the shared error foreground token for the error output label", () => {
    render(<ToolCallOutput output={{ error: "boom" }} isError={true} />);

    expect(screen.getByText("Error Output").className).toContain(
      "text-theme-error-fg",
    );
  });

  it("keeps the non-error output label on the neutral foreground token", () => {
    render(<ToolCallOutput output={{ result: "ok" }} />);

    expect(screen.getByText("Output").className).toContain(
      "text-theme-fg-secondary",
    );
  });
});
