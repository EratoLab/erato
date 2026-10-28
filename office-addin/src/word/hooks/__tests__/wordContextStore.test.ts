import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConversationKey } from "../../../core/selection/useConversationKey";
import { wordContextStore } from "../wordContextStore";

interface DocumentProps {
  chatId: string | null;
  identity?: string;
  includeByDefault: boolean;
}

function renderDocument(initialProps: DocumentProps) {
  return renderHook(
    ({ chatId, identity = "doc-a", includeByDefault }: DocumentProps) => {
      const key = useConversationKey(chatId, identity);
      return {
        key,
        included: wordContextStore.useDocumentIncluded(key, {
          chatStarted: chatId !== null,
          includeByDefault,
        }),
      };
    },
    { initialProps, wrapper: StrictMode },
  );
}

interface SelectionProps {
  chatId: string | null;
  selectionKey: string;
  identity?: string;
}

function renderSelection(initialProps: SelectionProps) {
  return renderHook(
    ({ chatId, selectionKey, identity = "doc-a" }: SelectionProps) => {
      const key = useConversationKey(chatId, identity);
      return {
        key,
        selectionKey,
        dismissed: wordContextStore.useSelectionDismissed(key, selectionKey),
      };
    },
    { initialProps, wrapper: StrictMode },
  );
}

afterEach(() => {
  cleanup();
  wordContextStore.resetForTests();
});

describe("wordContextStore", () => {
  describe("the document", () => {
    it("follows the setting live while the chat has no ID", () => {
      const { result, rerender } = renderDocument({
        chatId: null,
        includeByDefault: true,
      });
      expect(result.current.included).toBe(true);

      rerender({ chatId: null, includeByDefault: false });

      expect(result.current.included).toBe(false);
    });

    it("keeps the setting a chat had once it has an ID", () => {
      const { result, rerender } = renderDocument({
        chatId: "chat-1",
        includeByDefault: true,
      });

      rerender({ chatId: "chat-1", includeByDefault: false });

      expect(result.current.included).toBe(true);
    });

    it("keeps the chip's choice while a new chat gets its ID", () => {
      const { result, rerender } = renderDocument({
        chatId: null,
        includeByDefault: true,
      });
      act(() =>
        wordContextStore.setDocumentIncluded(result.current.key, false),
      );

      rerender({ chatId: "chat-new", includeByDefault: true });

      expect(result.current.included).toBe(false);
    });

    it("starts another chat or document from its default", () => {
      const { result, rerender } = renderDocument({
        chatId: "chat-1",
        includeByDefault: true,
      });
      act(() =>
        wordContextStore.setDocumentIncluded(result.current.key, false),
      );

      rerender({ chatId: "chat-2", includeByDefault: true });
      expect(result.current.included).toBe(true);

      act(() =>
        wordContextStore.setDocumentIncluded(result.current.key, false),
      );
      rerender({ chatId: "chat-2", identity: "doc-b", includeByDefault: true });
      expect(result.current.included).toBe(true);
    });

    it("keeps a chat's choice when the composer mounts again in that chat", () => {
      const first = renderDocument({
        chatId: "chat-1",
        includeByDefault: true,
      });
      act(() =>
        wordContextStore.setDocumentIncluded(first.result.current.key, false),
      );
      first.unmount();

      const again = renderDocument({
        chatId: "chat-1",
        includeByDefault: true,
      });
      expect(again.result.current.included).toBe(false);
    });

    it("applies a write for a conversation the store has not seen yet", () => {
      wordContextStore.setDocumentIncluded("stale", false);
      const { result } = renderDocument({
        chatId: "chat-1",
        includeByDefault: true,
      });
      expect(result.current.included).toBe(true);

      act(() =>
        wordContextStore.setDocumentIncluded(result.current.key, false),
      );
      expect(result.current.included).toBe(false);
    });
  });

  describe("the selection", () => {
    const dismiss = (current: { key: string; selectionKey: string }) =>
      act(() =>
        wordContextStore.dismissSelection(current.key, current.selectionKey),
      );

    it("dismisses and re-arms", () => {
      const { result } = renderSelection({ chatId: "c", selectionKey: "A" });
      expect(result.current.dismissed).toBe(false);

      dismiss(result.current);
      expect(result.current.dismissed).toBe(true);

      act(() => wordContextStore.rearmSelection(result.current.key, "A"));
      expect(result.current.dismissed).toBe(false);
    });

    it("clears the dismissal for a new selection", () => {
      const { result, rerender } = renderSelection({
        chatId: "c",
        selectionKey: "A",
      });
      dismiss(result.current);

      rerender({ chatId: "c", selectionKey: "B" });

      expect(result.current.dismissed).toBe(false);
    });

    it("keeps it while nothing is selected, and clears it when the same passage is selected again (ERMAIN-431)", () => {
      const { result, rerender } = renderSelection({
        chatId: "c",
        selectionKey: "A",
      });
      dismiss(result.current);

      rerender({ chatId: "c", selectionKey: "" });
      expect(result.current.dismissed).toBe(true);

      rerender({ chatId: "c", selectionKey: "A" });
      expect(result.current.dismissed).toBe(false);
    });

    it("keeps it while a new chat gets its ID, and clears it in another chat", () => {
      const { result, rerender } = renderSelection({
        chatId: null,
        selectionKey: "A",
      });
      dismiss(result.current);

      rerender({ chatId: "chat-new", selectionKey: "A" });
      expect(result.current.dismissed).toBe(true);

      rerender({ chatId: "chat-other", selectionKey: "A" });
      expect(result.current.dismissed).toBe(false);
    });

    it("keeps a dismissal written before the store recorded that conversation", () => {
      const key = JSON.stringify(["doc-a", "chat", "c"]);
      wordContextStore.dismissSelection(key, "A");

      const { result } = renderSelection({ chatId: "c", selectionKey: "A" });

      expect(result.current.key).toBe(key);
      expect(result.current.dismissed).toBe(true);
    });
  });

  it("keeps two composers on different conversations apart", () => {
    const render = () =>
      renderHook(
        () => {
          const main = useConversationKey("chat-1", "doc-a");
          const other = useConversationKey("chat-2", "doc-a");
          return {
            main,
            other,
            mainDismissed: wordContextStore.useSelectionDismissed(main, "A"),
            otherDismissed: wordContextStore.useSelectionDismissed(other, "A"),
            mainIncluded: wordContextStore.useDocumentIncluded(main, {
              chatStarted: true,
              includeByDefault: true,
            }),
            otherIncluded: wordContextStore.useDocumentIncluded(other, {
              chatStarted: true,
              includeByDefault: false,
            }),
          };
        },
        { wrapper: StrictMode },
      );
    const { result } = render();

    act(() => wordContextStore.dismissSelection(result.current.main, "A"));
    act(() => wordContextStore.setDocumentIncluded(result.current.other, true));

    expect(result.current).toMatchObject({
      mainDismissed: true,
      otherDismissed: false,
      mainIncluded: true,
      otherIncluded: true,
    });
    act(() => wordContextStore.dismissSelection(result.current.other, "A"));
    act(() => wordContextStore.rearmSelection(result.current.main, "A"));
    expect(result.current).toMatchObject({
      mainDismissed: false,
      otherDismissed: true,
    });
  });

  it("forgets a conversation once no composer shows it", () => {
    const { result, rerender } = renderDocument({
      chatId: "chat-1",
      includeByDefault: true,
    });
    act(() => wordContextStore.setDocumentIncluded(result.current.key, false));

    rerender({ chatId: "chat-2", includeByDefault: true });
    rerender({ chatId: "chat-1", includeByDefault: true });

    expect(result.current.included).toBe(true);
    expect([...wordContextStore.getSnapshot().keys()]).toEqual([
      result.current.key,
    ]);
  });

  it("writes to no browser storage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const document = renderDocument({ chatId: "c", includeByDefault: true });
    const selection = renderSelection({ chatId: "c", selectionKey: "A" });

    act(() => {
      wordContextStore.setDocumentIncluded(document.result.current.key, false);
      wordContextStore.setDocumentIncluded(document.result.current.key, true);
    });
    dismissAndRearm(selection.result.current.key);

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    removeItem.mockRestore();
  });
});

function dismissAndRearm(key: string) {
  act(() => {
    wordContextStore.dismissSelection(key, "A");
    wordContextStore.rearmSelection(key, "A");
  });
}
