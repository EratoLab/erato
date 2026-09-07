import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SpinnerIcon } from "./SpinnerIcon";

const spinnerOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>('[data-ui="spinner"]');

describe("SpinnerIcon", () => {
  it("announces itself as a status region with screen-reader-only text", () => {
    const { container } = render(<SpinnerIcon />);
    const spinner = spinnerOf(container);

    expect(spinner).toHaveAttribute("role", "status");
    expect(spinner).toHaveAttribute("data-size", "md");
    expect(screen.getByText("Loading...")).toHaveClass("sr-only");
  });

  it("renders custom screen-reader text instead of the default", () => {
    render(<SpinnerIcon srText="Loading attachment..." />);

    expect(screen.getByText("Loading attachment...")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("drops the status role and the announced text when hidden", () => {
    const { container } = render(<SpinnerIcon aria-hidden />);
    const spinner = spinnerOf(container);

    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(spinner).not.toHaveAttribute("role");
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("forwards arbitrary span props to the DOM", () => {
    render(
      <SpinnerIcon
        data-testid="upload-spinner"
        style={{ "--spinner-head": "red" } as React.CSSProperties}
      />,
    );

    const spinner = screen.getByTestId("upload-spinner");

    expect(spinner.tagName).toBe("SPAN");
    expect(spinner.style.getPropertyValue("--spinner-head")).toBe("red");
  });

  it("renders a visible caption that replaces the announced text", () => {
    const { container } = render(
      <SpinnerIcon size="xl" label="Loading assistant..." />,
    );
    const spinner = spinnerOf(container);
    const ring = container.querySelector('[data-ui="spinner-ring"]');

    expect(spinner).toHaveAttribute("role", "status");
    expect(ring).toHaveAttribute("aria-hidden", "true");
    expect(ring).toHaveClass("spinner-geometry", "spinner-xl");
    expect(
      container.querySelector('[data-ui="spinner-label"]'),
    ).toHaveTextContent("Loading assistant...");
    expect(container.querySelector(".sr-only")).toBeNull();
  });

  it.each([
    ["sm", "spinner-sm"],
    ["md", "spinner-md"],
    ["lg", "spinner-lg"],
    ["xl", "spinner-xl"],
    ["fill", "spinner-fill"],
  ] as const)("maps size %s onto the geometry class", (size, sizeClass) => {
    const { container } = render(<SpinnerIcon size={size} />);

    expect(spinnerOf(container)).toHaveClass("spinner-geometry", sizeClass);
  });

  it("appends a caller class after the geometry classes", () => {
    const { container } = render(<SpinnerIcon className="shrink-0" />);

    expect(spinnerOf(container)?.className).toBe(
      "spinner-geometry spinner-md shrink-0",
    );
  });
});
