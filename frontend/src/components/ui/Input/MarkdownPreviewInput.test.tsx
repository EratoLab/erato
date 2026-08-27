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

  it("moves between tabs with the arrow keys, wrapping at both ends", () => {
    render(<MarkdownPreviewInput {...defaultProps} id="description" />);

    const markdownTab = screen.getByRole("tab", { name: "Markdown" });
    markdownTab.focus();
    expect(markdownTab).toHaveFocus();

    fireEvent.keyDown(markdownTab, { key: "ArrowRight" });

    const previewTab = screen.getByRole("tab", { name: "Preview" });
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute("aria-selected", "true");

    // Two tabs, so either arrow wraps straight back.
    fireEvent.keyDown(previewTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole("tab", { name: "Markdown" }), {
      key: "ArrowLeft",
    });
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveFocus();
  });

  it("jumps to the edges with Home and End", () => {
    render(<MarkdownPreviewInput {...defaultProps} id="description" />);

    const markdownTab = screen.getByRole("tab", { name: "Markdown" });
    markdownTab.focus();

    fireEvent.keyDown(markdownTab, { key: "End" });

    const previewTab = screen.getByRole("tab", { name: "Preview" });
    expect(previewTab).toHaveFocus();
    expect(previewTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(previewTab, { key: "Home" });

    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Markdown" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("leaves unrelated keys to the browser", () => {
    render(<MarkdownPreviewInput {...defaultProps} id="description" />);

    const markdownTab = screen.getByRole("tab", { name: "Markdown" });
    markdownTab.focus();

    fireEvent.keyDown(markdownTab, { key: "ArrowDown" });

    expect(markdownTab).toHaveFocus();
    expect(markdownTab).toHaveAttribute("aria-selected", "true");
  });

  it("points both tabs at the panel they actually control", () => {
    render(<MarkdownPreviewInput {...defaultProps} id="description" />);

    const panelId = screen.getByRole("tabpanel").getAttribute("id");
    expect(panelId).toBeTruthy();

    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("aria-controls", panelId);
    }
  });
});
