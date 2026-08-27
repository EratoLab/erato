import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "../SegmentedControl";

import type { SegmentedControlOption } from "../SegmentedControl";

type View = "list" | "grid" | "table";

const defaultOptions: SegmentedControlOption<View>[] = [
  { value: "list", label: "List" },
  { value: "grid", label: "Grid" },
  { value: "table", label: "Table" },
];

interface HarnessProps {
  options?: SegmentedControlOption<View>[];
  initialValue?: View;
  onChange?: (value: View) => void;
}

/**
 * The control is controlled, so selection only actually moves when a parent
 * feeds the new value back in. Arrow keys activate automatically, which is
 * only observable through a real state round-trip.
 */
function Harness({
  options = defaultOptions,
  initialValue = "list",
  onChange,
}: HarnessProps) {
  const [value, setValue] = useState<View>(initialValue);

  return (
    <SegmentedControl
      aria-label="View"
      options={options}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const tab = (name: string) => screen.getByRole("tab", { name });

describe("SegmentedControl", () => {
  it("moves selection and focus rightwards, wrapping past the last segment", () => {
    render(<Harness />);

    const list = tab("List");
    list.focus();
    expect(list).toHaveFocus();

    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(tab("Grid")).toHaveFocus();
    expect(tab("Grid")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("Grid"), { key: "ArrowRight" });
    expect(tab("Table")).toHaveFocus();

    fireEvent.keyDown(tab("Table"), { key: "ArrowRight" });
    expect(tab("List")).toHaveFocus();
    expect(tab("List")).toHaveAttribute("aria-selected", "true");
  });

  it("moves selection and focus leftwards, wrapping past the first segment", () => {
    render(<Harness />);

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(tab("Table")).toHaveFocus();
    expect(tab("Table")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("Table"), { key: "ArrowLeft" });
    expect(tab("Grid")).toHaveFocus();
    expect(tab("Grid")).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the edges with Home and End", () => {
    render(<Harness initialValue="grid" />);

    const grid = tab("Grid");
    grid.focus();

    fireEvent.keyDown(grid, { key: "End" });
    expect(tab("Table")).toHaveFocus();
    expect(tab("Table")).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(tab("Table"), { key: "Home" });
    expect(tab("List")).toHaveFocus();
    expect(tab("List")).toHaveAttribute("aria-selected", "true");
  });

  it("activates automatically, reporting each arrow as a change", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("grid");

    fireEvent.keyDown(tab("Grid"), { key: "End" });

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith("table");
  });

  it("steps over a disabled segment rather than landing on it", () => {
    const onChange = vi.fn();
    render(
      <Harness
        onChange={onChange}
        options={[
          { value: "list", label: "List" },
          { value: "grid", label: "Grid", disabled: true },
          { value: "table", label: "Table" },
        ]}
      />,
    );

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(tab("Table")).toHaveFocus();
    expect(tab("Table")).toHaveAttribute("aria-selected", "true");
    expect(tab("Grid")).toHaveAttribute("aria-selected", "false");
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("skips a disabled segment when entering from the End edge", () => {
    render(
      <Harness
        options={[
          { value: "list", label: "List" },
          { value: "grid", label: "Grid" },
          { value: "table", label: "Table", disabled: true },
        ]}
      />,
    );

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "End" });

    expect(tab("Grid")).toHaveFocus();
    expect(tab("Grid")).toHaveAttribute("aria-selected", "true");
  });

  it("stays put when it is the only segment that can be selected", () => {
    render(
      <Harness
        options={[
          { value: "list", label: "List" },
          { value: "grid", label: "Grid", disabled: true },
          { value: "table", label: "Table", disabled: true },
        ]}
      />,
    );

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowRight" });

    expect(tab("List")).toHaveFocus();
    expect(tab("List")).toHaveAttribute("aria-selected", "true");
  });

  it("leaves unrelated keys to the browser", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const list = tab("List");
    list.focus();

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "a" });

    expect(onChange).not.toHaveBeenCalled();
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-selected", "true");
  });

  it("keeps a roving tab stop on the selected segment", () => {
    render(<Harness initialValue="grid" />);

    expect(tab("Grid")).toHaveAttribute("tabindex", "0");
    expect(tab("List")).toHaveAttribute("tabindex", "-1");
    expect(tab("Table")).toHaveAttribute("tabindex", "-1");
  });

  it("does not claim a tabpanel that no caller renders", () => {
    render(<Harness />);

    // The control owns no panel, so an `aria-controls` here could only ever
    // dangle. The `id` stays: unreferenced is inert, unresolvable is a fault.
    for (const segment of screen.getAllByRole("tab")) {
      expect(segment).not.toHaveAttribute("aria-controls");
      expect(segment).toHaveAttribute("id");
    }
  });
});
