import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";

import { usePendingCaret } from "../usePendingCaret";

function Composer({
  initial,
  next,
  requested,
  caret,
}: {
  initial: string;
  next: string;
  requested: string;
  caret: number;
}) {
  const [value, setValue] = useState(initial);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const placeCaret = usePendingCaret(textareaRef);
  return (
    <>
      <textarea
        ref={textareaRef}
        aria-label="Composer"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          setValue(next);
          placeCaret(requested, caret);
        }}
      >
        Pick
      </button>
    </>
  );
}

const selectionOf = (textarea: HTMLTextAreaElement) => [
  textarea.selectionStart,
  textarea.selectionEnd,
];

describe("usePendingCaret", () => {
  it("focuses and places the caret in the commit that writes the text", () => {
    render(
      <Composer
        initial="hi"
        next="hi @Ann there"
        requested="hi @Ann there"
        caret={8}
      />,
    );
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    expect(textarea).toHaveValue("hi @Ann there");
    expect(textarea).toHaveFocus();
    expect(selectionOf(textarea)).toEqual([8, 8]);
  });

  it("places the caret when the text does not change", () => {
    render(<Composer initial="abc" next="abc" requested="abc" caret={1} />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    expect(selectionOf(textarea)).toEqual([1, 1]);
  });

  it("leaves focus and caret alone when the textarea holds other text", () => {
    render(<Composer initial="" next="abc" requested="abd" caret={1} />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");

    fireEvent.click(screen.getByRole("button", { name: "Pick" }));

    expect(textarea).toHaveValue("abc");
    expect(textarea).not.toHaveFocus();
    expect(selectionOf(textarea)).toEqual([3, 3]);
  });
});
