import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddinSelectionChip } from "../AddinSelectionChip";

import type { AddinSelectionChipProps } from "../AddinSelectionChip";

beforeEach(() => {
  i18n.activate("en");
});
afterEach(cleanup);

function renderChip(props: Partial<AddinSelectionChipProps> = {}) {
  const onDismiss = vi.fn();
  const onUse = vi.fn();
  render(
    <AddinSelectionChip
      preview="Selected text"
      armed
      onDismiss={onDismiss}
      onUse={onUse}
      testId="selection-chip"
      {...props}
    />,
  );
  return { onDismiss, onUse, chip: screen.getByTestId("selection-chip") };
}

describe("AddinSelectionChip", () => {
  it("quotes a short preview in full", () => {
    const { chip } = renderChip({ preview: "Short passage" });

    expect(chip).toHaveTextContent("“Short passage”");
  });

  it("truncates a long preview to 80 characters", () => {
    const preview = `${"a".repeat(80)}TAIL`;
    const { chip } = renderChip({ preview });

    expect(chip).toHaveTextContent(`“${"a".repeat(80)}...”`);
    expect(chip).not.toHaveTextContent("TAIL");
  });

  it("never cuts a character outside the basic plane in half", () => {
    const preview = `${"a".repeat(79)}\u{1F600}${"b".repeat(10)}`;
    const { chip } = renderChip({ preview });

    expect(chip).toHaveTextContent(`“${"a".repeat(79)}\u{1F600}...”`);
  });

  it("shows the meta label and the note", () => {
    const { chip } = renderChip({
      metaLabel: "Selected passage · 2 paragraphs",
      note: "Only the selected passage is sent.",
    });

    expect(chip).toHaveTextContent("Selected passage · 2 paragraphs");
    expect(chip).toHaveTextContent("Only the selected passage is sent.");
  });

  it("offers no 'Use this selection' while armed", () => {
    renderChip({ armed: true });

    expect(screen.queryByText("Shown by Erato")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Use this selection" }),
    ).not.toBeInTheDocument();
  });

  it("marks a selection made by Erato and lets the user take it over", () => {
    const { onUse, chip } = renderChip({ armed: false });

    expect(chip).toHaveTextContent("Shown by Erato");
    fireEvent.click(screen.getByRole("button", { name: "Use this selection" }));

    expect(onUse).toHaveBeenCalledTimes(1);
  });

  it("dismisses through a labelled button", () => {
    const { onDismiss } = renderChip();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss selection" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
