import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useConversationKey } from "../useConversationKey";
import { useSelectionDismissal } from "../useSelectionDismissal";

interface Props {
  selectionKey: string;
  contextKey: string;
}

interface ChatProps {
  chatId: string | null;
  selectionKey: string;
}

function renderDismissal(initialProps: Props) {
  return renderHook(
    ({ selectionKey, contextKey }: Props) =>
      useSelectionDismissal(selectionKey, contextKey),
    { initialProps, wrapper: StrictMode },
  );
}

afterEach(cleanup);

describe("useSelectionDismissal", () => {
  it("starts armed and dismisses", () => {
    const { result } = renderDismissal({ selectionKey: "A", contextKey: "x" });
    expect(result.current.dismissed).toBe(false);

    act(() => result.current.dismiss());

    expect(result.current.dismissed).toBe(true);
  });

  it("stays dismissed while the same selection is reported again", () => {
    const { result, rerender } = renderDismissal({
      selectionKey: "A",
      contextKey: "x",
    });
    act(() => result.current.dismiss());

    rerender({ selectionKey: "A", contextKey: "x" });

    expect(result.current.dismissed).toBe(true);
  });

  it("re-arms on a new selection", () => {
    const { result, rerender } = renderDismissal({
      selectionKey: "A",
      contextKey: "x",
    });
    act(() => result.current.dismiss());

    rerender({ selectionKey: "B", contextKey: "x" });

    expect(result.current.dismissed).toBe(false);
  });

  it("re-arms when the same passage is selected again after a deselect", () => {
    const { result, rerender } = renderDismissal({
      selectionKey: "A",
      contextKey: "x",
    });
    act(() => result.current.dismiss());

    rerender({ selectionKey: "", contextKey: "x" });
    expect(result.current.dismissed).toBe(true);
    rerender({ selectionKey: "A", contextKey: "x" });

    expect(result.current.dismissed).toBe(false);
  });

  it("resets when the context changes", () => {
    const { result, rerender } = renderDismissal({
      selectionKey: "A",
      contextKey: "x",
    });
    act(() => result.current.dismiss());

    rerender({ selectionKey: "A", contextKey: "y" });

    expect(result.current.dismissed).toBe(false);
  });

  it("re-arms on request", () => {
    const { result } = renderDismissal({ selectionKey: "A", contextKey: "x" });
    act(() => result.current.dismiss());

    act(() => result.current.rearm());

    expect(result.current.dismissed).toBe(false);
  });

  it("keeps a dismissal made in a new chat once the chat receives its ID", () => {
    const initialProps: ChatProps = { chatId: null, selectionKey: "A" };
    const { result, rerender } = renderHook(
      ({ chatId, selectionKey }: ChatProps) =>
        useSelectionDismissal(selectionKey, useConversationKey(chatId, "doc")),
      { initialProps, wrapper: StrictMode },
    );
    act(() => result.current.dismiss());

    rerender({ chatId: "c1", selectionKey: "A" });
    expect(result.current.dismissed).toBe(true);

    rerender({ chatId: "c2", selectionKey: "A" });
    expect(result.current.dismissed).toBe(false);
  });
});
