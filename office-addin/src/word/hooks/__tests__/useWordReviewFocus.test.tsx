import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { useWordReviewFocus } from "../useWordReviewFocus";

afterEach(cleanup);

function Review({
  done,
  applying = false,
}: {
  done: boolean;
  applying?: boolean;
}) {
  const ref = useWordReviewFocus(`${done}:${applying}`);
  return (
    <>
      <input aria-label="Chat" />
      <section ref={ref} tabIndex={-1}>
        {done ? (
          <div tabIndex={-1} data-word-review-result>
            Applied
          </div>
        ) : applying ? (
          <span>Applying</span>
        ) : (
          <button>Apply</button>
        )}
      </section>
      <p>Elsewhere</p>
    </>
  );
}

it("moves lost action focus to the compact receipt", () => {
  const view = render(<Review done={false} />);
  screen.getByRole("button").focus();
  view.rerender(<Review done={false} applying />);
  expect(screen.getByText("Applying").parentElement).toHaveFocus();
  view.rerender(<Review done />);
  expect(screen.getByText("Applied")).toHaveFocus();
});

it("does not steal focus from the chat during an automatic completion", () => {
  const view = render(<Review done={false} />);
  screen.getByRole("button").focus();
  screen.getByRole("textbox").focus();
  view.rerender(<Review done />);
  expect(screen.getByRole("textbox")).toHaveFocus();
});

it("leaves focus alone if the user clicks elsewhere before completion", () => {
  const view = render(<Review done={false} />);
  screen.getByRole("button").focus();
  fireEvent.pointerDown(screen.getByText("Elsewhere"));
  view.rerender(<Review done />);
  expect(screen.getByText("Applied")).not.toHaveFocus();
});
