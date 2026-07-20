import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileUploadButton } from "../FileUploadButton";

/**
 * The idle button used to be a hand-rolled <button> whose hover swapped in a
 * hardcoded `bg-blue-100` / `text-blue-500` via React state — unreachable by
 * any theme token. These pin the shared-Button geometry and the absence of
 * palette literals, so a regression shows up here rather than in a theme.
 */
describe("FileUploadButton", () => {
  it("uses shared icon geometry sized to match its composer siblings", () => {
    render(<FileUploadButton label="Attach" iconOnly />);

    const button = screen.getByRole("button", { name: "Attach" });

    expect(button).toHaveAttribute("data-geometry", "icon-sm");
    expect(button).toHaveAttribute("data-variant", "secondary");
    expect(button.className).toContain("btn-geometry-icon-sm");
  });

  it("uses control geometry and renders the label when not icon-only", () => {
    render(<FileUploadButton label="Attach files" iconOnly={false} />);

    const button = screen.getByRole("button", { name: /Attach files/ });

    expect(button).toHaveAttribute("data-geometry", "md");
    expect(screen.getByText("Attach files")).toBeInTheDocument();
  });

  it("carries no hardcoded palette colours", () => {
    render(<FileUploadButton label="Attach" iconOnly />);

    const button = screen.getByRole("button", { name: "Attach" });

    expect(button.className).not.toMatch(/\bbg-blue-/);
    expect(button.className).not.toMatch(/\btext-blue-/);
    expect(button.innerHTML).not.toMatch(/text-blue-/);
    // The fill comes from the variant's tokens.
    expect(button.className).toContain("bg-theme-bg-secondary");
    expect(button.className).toContain("hover:bg-theme-bg-hover");
  });

  it("is disabled when the disabled prop is set", () => {
    render(<FileUploadButton label="Attach" iconOnly disabled />);

    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
  });
});
