import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonDisplay } from "./JsonDisplay";

describe("JsonDisplay", () => {
  it.each([
    ["root", "  first\n\n  second  line\n"],
    ["object", { message: "  first\n\n  second  line\n" }],
    ["nested array", { messages: ["  first\n\n  second  line\n"] }],
  ])("preserves whitespace in a %s string value", (_label, data) => {
    const { container } = render(<JsonDisplay data={data} />);
    const value = container.querySelector("span.text-theme-success-fg");

    expect(value?.textContent).toBe('"  first\n\n  second  line\n"');
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
  });

  it("keeps long multiline strings complete beyond metadata display limits", () => {
    const message = `${"Long  line\n".repeat(500)}Final argument line`;
    const { container } = render(<JsonDisplay data={{ message }} />);
    const value = container.querySelector("span.text-theme-success-fg");

    expect(value?.textContent).toBe(`"${message}"`);
    expect(value).toHaveClass("whitespace-pre-wrap", "break-words");
  });

  it("renders literal escape sequences and markup as inert text", () => {
    const message = 'literal\\n<script>alert("hello")</script>';
    const { container } = render(<JsonDisplay data={{ message }} />);

    expect(
      container.querySelector("span.text-theme-success-fg")?.textContent,
    ).toBe(`"${message}"`);
    expect(container.querySelector("script")).toBeNull();
  });

  it("retains structural and non-string value rendering", () => {
    render(
      <JsonDisplay
        data={{ count: 42, enabled: true, missing: null, list: [], object: {} }}
      />,
    );

    expect(screen.getByText("42")).toHaveClass("text-theme-info-fg");
    expect(screen.getByText("true")).toHaveClass("text-theme-warning-fg");
    expect(screen.getByText("null")).toHaveClass("text-theme-fg-muted");
    expect(screen.getByText("[]")).toBeInTheDocument();
    expect(screen.getByText("{}")).toBeInTheDocument();
  });
});
