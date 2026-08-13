import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MarkdownPreviewInput } from "./MarkdownPreviewInput";

const defaultProps = {
  emptyPreviewMessage: "Nothing to preview yet.",
  markdownTabLabel: "Markdown",
  onChange: vi.fn(),
  previewTabLabel: "Preview",
  tablistLabel: "Markdown editor",
  value: "# Heading\n\n- First item",
};

describe("MarkdownPreviewInput", () => {
  it("switches between the source and rendered Markdown views", () => {
    render(<MarkdownPreviewInput {...defaultProps} id="description" />);

    expect(screen.getByRole("textbox")).toHaveValue(defaultProps.value);
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Heading" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("list")).toHaveTextContent("First item");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));

    expect(screen.getByRole("textbox")).toHaveValue(defaultProps.value);
  });

  it("shows an empty state in the preview", () => {
    render(
      <MarkdownPreviewInput {...defaultProps} id="description" value="" />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));

    expect(
      screen.getByText(defaultProps.emptyPreviewMessage),
    ).toBeInTheDocument();
  });

  it("keeps validation errors visible in the preview", () => {
    render(
      <MarkdownPreviewInput
        {...defaultProps}
        id="description"
        error="Description is required"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Description is required",
    );
  });
});
