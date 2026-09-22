import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { Select } from "./Select";

afterEach(cleanup);

it("associates its label and error while retaining native select behavior", () => {
  const change = vi.fn();
  render(
    <Select
      label="Outcome"
      description="Filter the results"
      error="Choose an outcome"
      onChange={change}
    >
      <option value="all">All</option>
      <option value="applied">Applied</option>
    </Select>,
  );
  const select = screen.getByRole("combobox", { name: "Outcome" });
  expect(select.tagName).toBe("SELECT");
  expect(select).toHaveAccessibleDescription("Choose an outcome");
  expect(select).toHaveAttribute("aria-invalid", "true");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(screen.queryByText("Filter the results")).not.toBeInTheDocument();
  fireEvent.change(select, { target: { value: "applied" } });
  expect(change).toHaveBeenCalledOnce();
  expect(select).toHaveValue("applied");
});

it("keeps external descriptions, explicit IDs and refs without a visible label", () => {
  const ref = createRef<HTMLSelectElement>();
  render(
    <>
      <p id="external-description">Results from this document.</p>
      <Select
        id="outcome"
        ref={ref}
        aria-label="Outcome"
        aria-describedby="external-description"
        description="Filter the results"
        disabled
      >
        <option value="all">All</option>
      </Select>
    </>,
  );
  const select = screen.getByRole("combobox", { name: "Outcome" });
  expect(select).toHaveAttribute("id", "outcome");
  expect(select).toHaveAccessibleDescription(
    "Results from this document. Filter the results",
  );
  expect(select).toBeDisabled();
  expect(ref.current).toBe(select);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
