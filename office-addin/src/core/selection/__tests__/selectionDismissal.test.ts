import { describe, expect, it } from "vitest";

import { nextSelectionDismissal } from "../selectionDismissal";

import type { SelectionDismissalState } from "../selectionDismissal";

const dismissed = (
  selectionKey: string,
  contextKey = "chat-1",
): SelectionDismissalState => ({ selectionKey, contextKey, dismissed: true });

describe("nextSelectionDismissal", () => {
  it("keeps the state while nothing changes", () => {
    const state = dismissed("A");
    expect(nextSelectionDismissal(state, "A", "chat-1")).toBe(state);
  });

  it("clears the dismissal for another selection", () => {
    expect(nextSelectionDismissal(dismissed("A"), "B", "chat-1")).toEqual({
      selectionKey: "B",
      contextKey: "chat-1",
      dismissed: false,
    });
  });

  it("keeps it while nothing is selected, and clears it for the same passage selected again", () => {
    const empty = nextSelectionDismissal(dismissed("A"), "", "chat-1");
    expect(empty).toEqual(dismissed(""));
    expect(nextSelectionDismissal(empty, "A", "chat-1").dismissed).toBe(false);
  });

  it("clears it in another context, even for the same selection", () => {
    expect(nextSelectionDismissal(dismissed("A"), "A", "chat-2")).toEqual({
      selectionKey: "A",
      contextKey: "chat-2",
      dismissed: false,
    });
    expect(nextSelectionDismissal(dismissed(""), "", "chat-2").dismissed).toBe(
      false,
    );
  });
});
