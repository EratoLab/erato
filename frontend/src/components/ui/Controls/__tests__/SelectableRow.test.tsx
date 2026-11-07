import { userEvent } from "@storybook/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  SELECTABLE_ROW_CHECKBOX_SELECTOR,
  SelectableRow,
} from "../SelectableRow";

import type { SelectableRowProps } from "../SelectableRow";

const renderRow = (props: Partial<SelectableRowProps> = {}) =>
  render(
    <ul>
      <SelectableRow
        selected={false}
        onSelectedChange={vi.fn()}
        selectLabel="Quarterly report"
        title="Quarterly report"
        meta="Anna Schmidt"
        end="16.09.2026"
        {...props}
      />
    </ul>,
  );

describe("SelectableRow", () => {
  it("names the checkbox and points it at its description", () => {
    renderRow({
      selectLabel: "Quarterly report, policy concern",
      describedBy: "meta-1 status-1",
    });

    const checkbox = screen.getByRole("checkbox", {
      name: "Quarterly report, policy concern",
    });
    expect(checkbox).toHaveAttribute("aria-describedby", "meta-1 status-1");
    expect(checkbox.matches(SELECTABLE_ROW_CHECKBOX_SELECTOR)).toBe(true);
  });

  it("toggles selection on Space", async () => {
    const onSelectedChange = vi.fn();
    const Controlled = () => {
      const [selected, setSelected] = useState(false);
      return (
        <ul>
          <SelectableRow
            selected={selected}
            onSelectedChange={(next) => {
              onSelectedChange(next);
              setSelected(next);
            }}
            selectLabel="Quarterly report"
            title="Quarterly report"
          />
        </ul>
      );
    };
    render(<Controlled />);
    const checkbox = screen.getByRole("checkbox");
    checkbox.focus();

    await userEvent.keyboard(" ");

    expect(onSelectedChange).toHaveBeenLastCalledWith(true);
    expect(checkbox).toBeChecked();
    expect(checkbox.closest("li")).toHaveAttribute("data-selected");
  });

  it("opens on a body click and moves focus to the checkbox", () => {
    const onOpen = vi.fn();
    const onSelectedChange = vi.fn();
    renderRow({ onOpen, onSelectedChange });

    fireEvent.click(screen.getByText("Anna Schmidt"));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toHaveFocus();
  });

  it("selects without opening when the checkbox is clicked", () => {
    const onOpen = vi.fn();
    const onSelectedChange = vi.fn();
    renderRow({ onOpen, onSelectedChange });

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onSelectedChange).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("renders the title as an open button outside the tab order", () => {
    const onOpen = vi.fn();
    const { rerender } = renderRow({
      onOpen,
      openLabel: "Preview: Quarterly report",
      detailId: "review-preview",
    });

    const open = screen.getByRole("button", {
      name: "Preview: Quarterly report",
    });
    expect(open).toHaveAttribute("tabindex", "-1");
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveAttribute("aria-controls", "review-preview");
    expect(open.closest("li")).not.toHaveAttribute("data-current");

    fireEvent.click(open);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox")).toHaveFocus();

    rerender(
      <ul>
        <SelectableRow
          selected={false}
          onSelectedChange={vi.fn()}
          selectLabel="Quarterly report"
          title="Quarterly report"
          onOpen={onOpen}
          openLabel="Preview: Quarterly report"
          detailId="review-preview"
          current
        />
      </ul>,
    );
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(open.closest("li")).toHaveAttribute("data-current");
  });

  it("has no open button without onOpen", () => {
    renderRow();

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Quarterly report")).toHaveAttribute("dir", "auto");
  });

  it("ignores selection and opening while disabled", async () => {
    const onOpen = vi.fn();
    const onSelectedChange = vi.fn();
    renderRow({ onOpen, onSelectedChange, disabled: true });

    await userEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Anna Schmidt"));

    expect(onSelectedChange).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("listitem")).toHaveAttribute("data-disabled");
  });

  it("emits tone, selection and busy state on a non-interactive frame", () => {
    renderRow({ tone: "warning", selected: true, busy: true });

    const frame = screen.getByRole("listitem");
    expect(frame).toHaveAttribute("data-ui", "selectable-row");
    expect(frame).toHaveAttribute("data-selectable-row");
    expect(frame).toHaveAttribute("data-tone", "warning");
    expect(frame).toHaveAttribute("data-selected");
    expect(frame).toHaveAttribute("aria-busy", "true");
    expect(frame).toHaveAttribute("data-layout", "columns");
    expect(frame).toHaveClass("selectable-row-geometry", "selectable-row-skin");
    expect(frame).not.toHaveAttribute("tabindex");
  });

  it("leaves neutral, unselected rows unmarked and takes a caller hook", () => {
    renderRow({ "data-ui": "review-item-row", layout: "stacked" });

    const frame = screen.getByRole("listitem");
    expect(frame).toHaveAttribute("data-ui", "review-item-row");
    expect(frame).toHaveAttribute("data-layout", "stacked");
    expect(frame).not.toHaveAttribute("data-tone");
    expect(frame).not.toHaveAttribute("data-selected");
    expect(frame).not.toHaveAttribute("aria-busy");
  });

  it("hides the kind glyph and forwards the ref and tabIndex to the checkbox", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <ul>
        <SelectableRow
          ref={ref}
          selected={false}
          onSelectedChange={vi.fn()}
          selectLabel="Quarterly report"
          title="Quarterly report"
          tabIndex={-1}
          icon={<svg data-testid="glyph" />}
        />
      </ul>,
    );

    expect(ref.current).toBe(screen.getByRole("checkbox"));
    expect(ref.current).toHaveAttribute("tabindex", "-1");
    expect(screen.getByTestId("glyph").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
