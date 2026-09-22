import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TextComparison } from "./TextComparison";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

describe("TextComparison", () => {
  it("keeps exact text in the original/proposed views and supports keyboard tabs", () => {
    render(<TextComparison original={"a\r\n\tb "} proposed={"a\n  b"} />);
    const changes = screen.getByRole("tab", { name: "Changes" });
    changes.focus();
    fireEvent.keyDown(changes, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Original" })).toHaveFocus();
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toBe("a↵\r\n\tb ");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(panel.textContent).toBe("a↵\n  b");
  });

  it("disables comparison when the original is unavailable", () => {
    render(<TextComparison original={null} proposed="New text" />);
    expect(screen.getByRole("tab", { name: "Changes" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Original" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Proposed" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("New text");
  });

  it("shows both complete texts when exact diff exceeds its work limit", () => {
    const original = "a".repeat(80001);
    render(<TextComparison original={original} proposed="replacement" />);
    expect(
      screen.getByText("Showing the complete texts for this large change."),
    ).toBeInTheDocument();
    expect(screen.getByText(original).textContent).toBe(original);
    expect(screen.getByText("replacement")).toBeInTheDocument();
  });
});
