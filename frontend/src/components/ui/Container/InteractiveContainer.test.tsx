import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InteractiveContainer } from "./InteractiveContainer";

describe("InteractiveContainer", () => {
  it("adds button semantics and keyboard activation for clickable divs", () => {
    const onClick = vi.fn();

    render(
      <InteractiveContainer useDiv onClick={onClick}>
        Clickable item
      </InteractiveContainer>,
    );

    const buttonLikeDiv = screen.getByRole("button", { name: "Clickable item" });

    expect(buttonLikeDiv).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(buttonLikeDiv, { key: "Enter" });
    fireEvent.keyDown(buttonLikeDiv, { key: " " });

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("renders a plain div without button semantics when not clickable", () => {
    render(<InteractiveContainer useDiv>Static item</InteractiveContainer>);

    const staticItem = screen.getByText("Static item");

    expect(screen.queryByRole("button")).toBeNull();
    expect(staticItem.parentElement).not.toHaveAttribute("role");
    expect(staticItem.parentElement).not.toHaveAttribute("tabindex");
  });

  it("lets consumers opt out of width and focus styling", () => {
    render(
      <InteractiveContainer fullWidth={false} showFocusRing={false}>
        Compact item
      </InteractiveContainer>,
    );

    const button = screen.getByRole("button", { name: "Compact item" });

    expect(button).not.toHaveClass("w-full");
    expect(button).not.toHaveClass("focus-ring-tight");
  });

  it("respects preventDefault in custom div key handlers", () => {
    const onClick = vi.fn();

    render(
      <InteractiveContainer
        useDiv
        onClick={onClick}
        onKeyDown={(event) => event.preventDefault()}
      >
        Guarded item
      </InteractiveContainer>,
    );

    fireEvent.keyDown(screen.getByRole("button", { name: "Guarded item" }), {
      key: "Enter",
    });

    expect(onClick).not.toHaveBeenCalled();
  });
});
