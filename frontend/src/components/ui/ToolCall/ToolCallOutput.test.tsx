import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolCallOutput } from "./ToolCallOutput";

describe("ToolCallOutput", () => {
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
