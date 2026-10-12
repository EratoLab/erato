import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestTheme } from "../../../test/helpers/TestTheme";
import { WordImportConfirm, WordImportRefusal } from "../WordImportConfirm";

import type { ComponentProps } from "react";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

function renderConfirm(
  props: Partial<ComponentProps<typeof WordImportConfirm>> = {},
) {
  const handlers = {
    onApply: vi.fn(),
    onAskAgain: vi.fn(),
    onCancel: vi.fn(),
  };
  const all: ComponentProps<typeof WordImportConfirm> = {
    routeText: "Replaces the whole document because it changes lists.",
    web: true,
    applyLabel: "Apply changes",
    canApply: true,
    applying: false,
    applyStage: undefined,
    ...handlers,
    ...props,
  };
  const view = render(<WordImportConfirm {...all} />, { wrapper: TestTheme });
  return {
    ...handlers,
    rerender: (next: Partial<ComponentProps<typeof WordImportConfirm>>) =>
      view.rerender(<WordImportConfirm {...all} {...next} />),
  };
}

const box = () => screen.getByRole("checkbox");
const apply = () => screen.getByRole("button", { name: "Apply changes" });

describe("WordImportConfirm", () => {
  it("applies only once the box is ticked", () => {
    const { onApply, onAskAgain, onCancel } = renderConfirm();
    expect(
      screen.getByRole("group", {
        name: "Confirm replacing the whole document",
      }),
    ).toBeVisible();
    expect(box()).not.toBeChecked();
    expect(apply()).toBeDisabled();
    fireEvent.click(apply());
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(box());
    fireEvent.click(apply());
    expect(onApply).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onAskAgain).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps Apply disabled while the card cannot apply, even when ticked", () => {
    renderConfirm({ canApply: false });
    fireEvent.click(box());
    expect(apply()).toBeDisabled();
  });

  it("holds the busy Apply and locks the rest while applying", () => {
    const { rerender } = renderConfirm();
    fireEvent.click(box());
    rerender({ applying: true, applyStage: "writing" });
    const busy = screen.getByRole("button", { name: "Applying…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(box()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("names Word for the web's costs only on the web", () => {
    renderConfirm();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      [
        "Word's Undo can't reverse this change. Erato can't verify the result on Word for the web, and its Restore may not bring back the exact original, which stays available to download.",
        "People editing at the same time may lose their latest changes.",
        "Comment dates and resolved flags may change.",
      ],
    );
    cleanup();
    renderConfirm({ web: false });
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      [
        "Erato's Undo works only until someone edits the document.",
        "People editing at the same time may lose their latest changes.",
      ],
    );
  });
});

describe("WordImportRefusal", () => {
  it("says why nothing can be applied and offers to ask again", () => {
    const onAskAgain = vi.fn();
    render(
      <WordImportRefusal reason="import-disabled" onAskAgain={onAskAgain} />,
      { wrapper: TestTheme },
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "This change needs a full-document rewrite, which your organization has turned off for this version of Word.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ask again for in-place edits" }),
    );
    expect(onAskAgain).toHaveBeenCalledOnce();
  });
});
