import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DetailFields } from "../DetailFields";

const fields = [
  { label: "From", value: "Anna Schmidt <anna@example.com>" },
  { label: "To", value: "Team" },
  {
    key: "date",
    label: "Date",
    value: <time dateTime="2026-09-16">16.09.2026</time>,
  },
];

describe("DetailFields", () => {
  it("renders each field as a term and its definition, in order", () => {
    const { container } = render(<DetailFields fields={fields} />);

    const terms = screen.getAllByRole("term");
    const definitions = screen.getAllByRole("definition");
    expect(terms.map((term) => term.textContent)).toEqual([
      "From",
      "To",
      "Date",
    ]);
    expect(definitions.map((definition) => definition.textContent)).toEqual([
      "Anna Schmidt <anna@example.com>",
      "Team",
      "16.09.2026",
    ]);
    for (const [index, term] of terms.entries()) {
      expect(term.nextElementSibling).toBe(definitions[index]);
    }
    expect(container.querySelector("dl")).toHaveAttribute(
      "data-ui",
      "detail-fields",
    );
  });

  it("renders nothing for an empty list", () => {
    const { container } = render(<DetailFields fields={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("sizes the grid's label column to the widest label", () => {
    const { container } = render(<DetailFields fields={fields} />);

    const list = container.querySelector("dl");
    expect(list).toHaveAttribute("data-layout", "grid");
    expect(list).toHaveClass(
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "text-sm",
    );
    expect(screen.getAllByRole("term")[0].parentElement).toHaveClass(
      "contents",
    );
    expect(screen.getAllByRole("definition")[0]).toHaveClass(
      "min-w-0",
      "break-words",
    );
    expect(screen.getAllByRole("term")[0]).toHaveClass("text-theme-fg-muted");
  });

  it("stacks labels over values and takes size, tone and a caller hook", () => {
    const { container } = render(
      <DetailFields
        fields={fields}
        layout="stacked"
        size="xs"
        labelTone="secondary"
        data-ui="review-fields"
      />,
    );

    const list = container.querySelector("dl");
    expect(list).toHaveAttribute("data-layout", "stacked");
    expect(list).toHaveAttribute("data-ui", "review-fields");
    expect(list).toHaveClass("flex", "flex-col", "text-xs");
    expect(list).not.toHaveClass("grid");
    expect(screen.getAllByRole("term")[0]).toHaveClass(
      "text-theme-fg-secondary",
    );
  });
});
