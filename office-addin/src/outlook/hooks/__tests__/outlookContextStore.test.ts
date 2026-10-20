import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useConversationKey } from "../../../core/selection/useConversationKey";
import { outlookContextStore } from "../outlookContextStore";

interface Props {
  chatId: string | null;
  itemKey: string;
  selectionKey: string;
}

function renderChoices(initialProps: Partial<Props> = {}) {
  return renderHook(
    ({ chatId, itemKey, selectionKey }: Props) => {
      const key = useConversationKey(chatId, "user@example.com");
      return {
        key,
        itemKey,
        selectionKey,
        choices: outlookContextStore.useChoices(key, { itemKey, selectionKey }),
      };
    },
    {
      initialProps: {
        chatId: "chat-1",
        itemKey: "item-1",
        selectionKey: "",
        ...initialProps,
      },
      wrapper: StrictMode,
    },
  );
}

type Rendered = ReturnType<typeof renderChoices>;

const current = (view: Rendered) => view.result.current;

function dismissSelection(view: Rendered) {
  const { key, itemKey, selectionKey } = current(view);
  act(() => outlookContextStore.dismissSelection(key, itemKey, selectionKey));
}

afterEach(() => {
  cleanup();
  outlookContextStore.resetForTests();
});

describe("outlookContextStore", () => {
  describe("the selection (ERMAIN-431)", () => {
    it("dismisses and rearms", () => {
      const view = renderChoices({ selectionKey: "body:A" });
      dismissSelection(view);
      expect(current(view).choices.selectionDismissed).toBe(true);

      const { key, itemKey } = current(view);
      act(() => outlookContextStore.rearmSelection(key, itemKey, "body:A"));

      expect(current(view).choices.selectionDismissed).toBe(false);
    });

    it("stays dismissed while the same selection is reported again", () => {
      const view = renderChoices({ selectionKey: "body:A" });
      dismissSelection(view);

      view.rerender({
        chatId: "chat-1",
        itemKey: "item-1",
        selectionKey: "body:A",
      });

      expect(current(view).choices.selectionDismissed).toBe(true);
    });

    it("rearms on another selection", () => {
      const view = renderChoices({ selectionKey: "body:A" });
      dismissSelection(view);

      view.rerender({
        chatId: "chat-1",
        itemKey: "item-1",
        selectionKey: "body:B",
      });

      expect(current(view).choices.selectionDismissed).toBe(false);
    });

    it("keeps the dismissal while nothing is selected, and rearms on the same passage again", () => {
      const view = renderChoices({ selectionKey: "body:A" });
      dismissSelection(view);

      view.rerender({ chatId: "chat-1", itemKey: "item-1", selectionKey: "" });
      expect(current(view).choices.selectionDismissed).toBe(true);

      view.rerender({
        chatId: "chat-1",
        itemKey: "item-1",
        selectionKey: "body:A",
      });
      expect(current(view).choices.selectionDismissed).toBe(false);
    });

    it("rearms on another mail item and in another conversation", () => {
      const view = renderChoices({ selectionKey: "body:A" });
      dismissSelection(view);
      view.rerender({
        chatId: "chat-1",
        itemKey: "item-2",
        selectionKey: "body:A",
      });
      expect(current(view).choices.selectionDismissed).toBe(false);

      dismissSelection(view);
      view.rerender({
        chatId: "chat-2",
        itemKey: "item-2",
        selectionKey: "body:A",
      });
      expect(current(view).choices.selectionDismissed).toBe(false);
    });
  });

  it("keeps the draft off until the mail item changes", () => {
    const view = renderChoices();
    act(() =>
      outlookContextStore.setDraftOff(current(view).key, "item-1", true),
    );
    expect(current(view).choices.draftOff).toBe(true);

    view.rerender({ chatId: "chat-1", itemKey: "item-1", selectionKey: "" });
    expect(current(view).choices.draftOff).toBe(true);

    view.rerender({ chatId: "chat-1", itemKey: "item-2", selectionKey: "" });
    expect(current(view).choices.draftOff).toBe(false);
  });

  it("scopes the thread choice to the mail item", () => {
    const view = renderChoices();
    act(() =>
      outlookContextStore.setThreadChoice(
        current(view).key,
        "item-1",
        "excluded",
      ),
    );
    expect(current(view).choices.threadChoice).toBe("excluded");

    view.rerender({ chatId: "chat-1", itemKey: "item-2", selectionKey: "" });
    expect(current(view).choices.threadChoice).toBeNull();
  });

  it("adds a thread sent earlier again and includes it", () => {
    const view = renderChoices();
    const { key } = current(view);
    act(() =>
      outlookContextStore.afterSend(key, {
        itemKey: "item-1",
        threadSent: "conv-1",
        attachmentIdsSent: [],
      }),
    );
    expect(current(view).choices.threadsSentInChat.has("conv-1")).toBe(true);

    act(() => outlookContextStore.includeThreadAgain(key, "item-1", "conv-1"));

    expect(current(view).choices.threadsSentInChat.has("conv-1")).toBe(false);
    expect(current(view).choices.threadChoice).toBe("included");
  });

  describe("after a send", () => {
    it("records the thread and attachments sent and ends one-message choices", () => {
      const view = renderChoices();
      const { key } = current(view);
      act(() => {
        outlookContextStore.setThreadChoice(key, "item-1", "included");
        outlookContextStore.includeAttachmentsOnFollowUp(key, "item-1", ["a1"]);
      });
      expect(current(view).choices.includeOnFollowUpIds.has("a1")).toBe(true);

      act(() =>
        outlookContextStore.afterSend(key, {
          itemKey: "item-1",
          threadSent: "conv-1",
          attachmentIdsSent: ["a1"],
        }),
      );

      const { choices } = current(view);
      expect(choices.threadChoice).toBeNull();
      expect(choices.threadsSentInChat.has("conv-1")).toBe(true);
      expect(choices.sentAttachmentIds.has("a1")).toBe(true);
      expect(choices.includeOnFollowUpIds.size).toBe(0);
    });

    it("keeps what lasts until the item changes", () => {
      const view = renderChoices();
      const { key } = current(view);
      act(() => {
        outlookContextStore.setThreadChoice(key, "item-1", "excluded");
        outlookContextStore.setDraftOff(key, "item-1", true);
        outlookContextStore.setAttachmentsGroupOff(key, "item-1", true);
      });

      act(() =>
        outlookContextStore.afterSend(key, {
          itemKey: "item-1",
          threadSent: null,
          attachmentIdsSent: [],
        }),
      );

      const { choices } = current(view);
      expect(choices.threadChoice).toBe("excluded");
      expect(choices.draftOff).toBe(true);
      expect(choices.attachmentsGroupOff).toBe(true);
      expect(choices.threadsSentInChat.size).toBe(0);
    });

    it("forgets the attachments sent with another item, never the thread", () => {
      const view = renderChoices();
      const { key } = current(view);
      act(() =>
        outlookContextStore.afterSend(key, {
          itemKey: "item-1",
          threadSent: "conv-1",
          attachmentIdsSent: ["a1"],
        }),
      );

      view.rerender({ chatId: "chat-1", itemKey: "item-2", selectionKey: "" });

      expect(current(view).choices.sentAttachmentIds.size).toBe(0);
      expect(current(view).choices.threadsSentInChat.has("conv-1")).toBe(true);
    });
  });

  it("holds an ended scheduling run for its own signal only", () => {
    const view = renderChoices();
    act(() =>
      outlookContextStore.endScheduling(
        current(view).key,
        "item-1",
        "2026-10-20T10:00:00Z",
      ),
    );
    expect(current(view).choices.schedulingEndedAt).toBe(
      "2026-10-20T10:00:00Z",
    );

    view.rerender({ chatId: "chat-1", itemKey: "item-2", selectionKey: "" });
    expect(current(view).choices.schedulingEndedAt).toBe(
      "2026-10-20T10:00:00Z",
    );
  });

  it("keeps a new chat's choices once it gets its ID, and starts another chat fresh", () => {
    const view = renderChoices({ chatId: null });
    const firstKey = current(view).key;
    act(() => outlookContextStore.setDraftOff(firstKey, "item-1", true));

    view.rerender({ chatId: "chat-1", itemKey: "item-1", selectionKey: "" });
    expect(current(view).key).toBe(firstKey);
    expect(current(view).choices.draftOff).toBe(true);

    view.rerender({ chatId: "chat-2", itemKey: "item-1", selectionKey: "" });
    expect(current(view).choices.draftOff).toBe(false);
    // The left conversation's entry goes once no composer holds it.
    expect([...outlookContextStore.getSnapshot().keys()]).toEqual([
      current(view).key,
    ]);
  });

  it("writes to neither browser storage nor Office roaming settings", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const localSet = vi.spyOn(localStorage, "setItem");
    const office = Office as unknown as {
      context: Record<string, unknown>;
    };
    const roamingSet = vi.fn();
    const roamingSave = vi.fn();
    const previous = office.context.roamingSettings;
    office.context.roamingSettings = {
      set: roamingSet,
      saveAsync: roamingSave,
    };
    try {
      const view = renderChoices({ selectionKey: "body:A" });
      const { key } = current(view);
      dismissSelection(view);
      act(() => {
        outlookContextStore.rearmSelection(key, "item-1", "body:A");
        outlookContextStore.setDraftOff(key, "item-1", true);
        outlookContextStore.setThreadChoice(key, "item-1", "excluded");
        outlookContextStore.setAttachmentsGroupOff(key, "item-1", true);
        outlookContextStore.endScheduling(
          key,
          "item-1",
          "2026-10-20T10:00:00Z",
        );
        outlookContextStore.afterSend(key, {
          itemKey: "item-1",
          threadSent: "conv-1",
          attachmentIdsSent: ["a1"],
        });
      });

      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
      expect(localSet).not.toHaveBeenCalled();
      expect(roamingSet).not.toHaveBeenCalled();
      expect(roamingSave).not.toHaveBeenCalled();
    } finally {
      office.context.roamingSettings = previous;
      setItem.mockRestore();
      removeItem.mockRestore();
      localSet.mockRestore();
    }
  });
});
