import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { Select } from "./Select";

afterEach(cleanup);

it("associates its label and error while retaining native select behavior", () => {
  const change = vi.fn();
  render(
    <Select label="Outcome" error="Choose an outcome" onChange={change}>
      <option value="all">All</option>
      <option value="applied">Applied</option>
    </Select>,
  );
  const select = screen.getByRole("combobox", { name: "Outcome" });
  expect(select.tagName).toBe("SELECT");
  expect(select).toHaveAccessibleDescription("Choose an outcome");
  expect(select).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(select, { target: { value: "applied" } });
  expect(change).toHaveBeenCalledOnce();
  expect(select).toHaveValue("applied");
});
