import { userEvent } from "@storybook/test";
import { fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "../Checkbox";

describe("Checkbox", () => {
  it("syncs indeterminate onto the element and clears it once checked", () => {
    const { rerender } = render(
      <Checkbox
        checked={false}
        indeterminate
        onCheckedChange={vi.fn()}
        aria-label="Select all"
      />,
    );
    const input = screen.getByRole<HTMLInputElement>("checkbox", {
      name: "Select all",
    });
    expect(input.indeterminate).toBe(true);

    rerender(
      <Checkbox
        checked
        indeterminate
        onCheckedChange={vi.fn()}
        aria-label="Select all"
      />,
    );
    expect(input.indeterminate).toBe(false);
    expect(input).toBeChecked();
  });

  it("restores indeterminate after a click the parent does not accept", () => {
    render(
      <Checkbox
        checked={false}
        indeterminate
        onCheckedChange={vi.fn()}
        aria-label="Select all"
      />,
    );
    const input = screen.getByRole<HTMLInputElement>("checkbox");

    fireEvent.click(input);

    expect(input.indeterminate).toBe(true);
    expect(input).not.toBeChecked();
  });

  it("takes its name from the visible label or from aria-label", () => {
    render(
      <>
        <Checkbox
          checked={false}
          onCheckedChange={vi.fn()}
          label="Only selected"
        />
        <Checkbox
          checked={false}
          onCheckedChange={vi.fn()}
          aria-label="Report.pdf"
        />
      </>,
    );

    const labelled = screen.getByRole("checkbox", { name: "Only selected" });
    expect(labelled.closest("label")).toHaveAttribute(
      "data-ui",
      "checkbox-field",
    );
    expect(
      screen.getByRole("checkbox", { name: "Report.pdf" }).closest("label"),
    ).toBeNull();
  });

  it("toggles on Space and reports the next state", async () => {
    const onCheckedChange = vi.fn();
    const Controlled = () => {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox
          checked={checked}
          onCheckedChange={(next, event) => {
            onCheckedChange(next, event.type);
            setChecked(next);
          }}
          aria-label="Report.pdf"
        />
      );
    };
    render(<Controlled />);
    const input = screen.getByRole("checkbox");
    input.focus();

    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true, "change");
    expect(input).toBeChecked();

    await userEvent.keyboard(" ");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false, "change");
    expect(input).not.toBeChecked();
  });

  it("ignores clicks while disabled", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
        label="Only selected"
      />,
    );

    await userEvent.click(screen.getByRole("checkbox"));

    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(screen.getByText("Only selected").closest("label")).toHaveClass(
      "has-[:disabled]:text-theme-fg-muted",
    );
  });

  it("emits a default hook the caller can override, and forwards the ref", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <>
        <Checkbox
          ref={ref}
          checked={false}
          onCheckedChange={vi.fn()}
          aria-label="A"
        />
        <Checkbox
          checked={false}
          onCheckedChange={vi.fn()}
          aria-label="B"
          data-ui="review-select-all"
        />
      </>,
    );

    expect(screen.getByRole("checkbox", { name: "A" })).toHaveAttribute(
      "data-ui",
      "checkbox",
    );
    expect(screen.getByRole("checkbox", { name: "B" })).toHaveAttribute(
      "data-ui",
      "review-select-all",
    );
    expect(ref.current).toBe(screen.getByRole("checkbox", { name: "A" }));
  });
});
