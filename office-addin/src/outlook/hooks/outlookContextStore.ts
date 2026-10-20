import { useLayoutEffect, useSyncExternalStore } from "react";

import { nextSelectionDismissal } from "../../core/selection/selectionDismissal";

import type { SelectionDismissalState } from "../../core/selection/selectionDismissal";

export type OutlookThreadChoice = "included" | "excluded" | null;

interface DraftChoice {
  itemKey: string;
  off: boolean;
}

interface ThreadChoiceEntry {
  itemKey: string;
  choice: OutlookThreadChoice;
}

interface AttachmentChoices {
  itemKey: string;
  /** The group chip's (x); the ticks underneath are kept. */
  groupOff: boolean;
  /** Included on a follow-up message, for the next send only. */
  includeOnFollowUpIds: ReadonlySet<string>;
  /** Sent with an earlier message of this conversation. */
  sentIds: ReadonlySet<string>;
}

interface OutlookConversationChoices {
  /** `contextKey` is the mail item, so a dismissal ends with it. */
  selection: SelectionDismissalState;
  draft: DraftChoice;
  thread: ThreadChoiceEntry;
  /** Conversation ids whose thread went with a message of this conversation. */
  threadsSentInChat: ReadonlySet<string>;
  attachments: AttachmentChoices;
  /** The scheduling signal the user ended; a newer one turns scheduling on again. */
  schedulingEndedAt: string | null;
}

/** What the composer reads: every item-scoped choice as it stands for the open item. */
export interface OutlookContextChoices {
  selectionDismissed: boolean;
  draftOff: boolean;
  threadChoice: OutlookThreadChoice;
  threadsSentInChat: ReadonlySet<string>;
  attachmentsGroupOff: boolean;
  includeOnFollowUpIds: ReadonlySet<string>;
  sentAttachmentIds: ReadonlySet<string>;
  schedulingEndedAt: string | null;
}

export interface OutlookSentContext {
  itemKey: string;
  /** The conversation id of the thread the send uploaded, if it did. */
  threadSent: string | null;
  /** Only attachments whose bytes resolved and went. */
  attachmentIdsSent: readonly string[];
}

type OutlookContextState = ReadonlyMap<string, OutlookConversationChoices>;

const NO_IDS: ReadonlySet<string> = new Set();

const freshAttachments = (itemKey: string): AttachmentChoices => ({
  itemKey,
  groupOff: false,
  includeOnFollowUpIds: NO_IDS,
  sentIds: NO_IDS,
});

const freshChoices = (itemKey: string): OutlookConversationChoices => ({
  selection: { contextKey: itemKey, selectionKey: "", dismissed: false },
  draft: { itemKey, off: false },
  thread: { itemKey, choice: null },
  threadsSentInChat: NO_IDS,
  attachments: freshAttachments(itemKey),
  schedulingEndedAt: null,
});

/**
 * Item-scoped choices reset on another mail item; the selection also tracks
 * every key it passes through (ERMAIN-431). Returns the same object when
 * nothing changes, so a settled entry does not publish.
 */
function settle(
  current: OutlookConversationChoices,
  itemKey: string,
  selectionKey: string = current.selection.selectionKey,
): OutlookConversationChoices {
  const selection = nextSelectionDismissal(
    current.selection,
    selectionKey,
    itemKey,
  );
  const draft =
    current.draft.itemKey === itemKey ? current.draft : { itemKey, off: false };
  const thread =
    current.thread.itemKey === itemKey
      ? current.thread
      : { itemKey, choice: null };
  const attachments =
    current.attachments.itemKey === itemKey
      ? current.attachments
      : freshAttachments(itemKey);
  if (
    selection === current.selection &&
    draft === current.draft &&
    thread === current.thread &&
    attachments === current.attachments
  ) {
    return current;
  }
  return { ...current, selection, draft, thread, attachments };
}

let state: OutlookContextState = new Map();
const holders = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(next: OutlookContextState) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;

function write(
  conversationKey: string,
  itemKey: string,
  change: (current: OutlookConversationChoices) => OutlookConversationChoices,
  selectionKey?: string,
) {
  const stored = state.get(conversationKey);
  const settled = settle(
    stored ?? freshChoices(itemKey),
    itemKey,
    selectionKey,
  );
  const next = change(settled);
  if (next === stored) return;
  const map = new Map(state);
  map.set(conversationKey, next);
  publish(map);
}

function withId(ids: ReadonlySet<string>, add: readonly string[]) {
  if (add.every((id) => ids.has(id))) return ids;
  return new Set([...ids, ...add]);
}

/** See `wordContextStore`: entries of conversations no composer shows are dropped. */
function useHeld(conversationKey: string) {
  useLayoutEffect(() => {
    holders.set(conversationKey, (holders.get(conversationKey) ?? 0) + 1);
    const left = [...state.keys()].filter((key) => !holders.has(key));
    if (left.length > 0) {
      const map = new Map(state);
      for (const key of left) map.delete(key);
      publish(map);
    }
    return () => {
      const remaining = (holders.get(conversationKey) ?? 1) - 1;
      if (remaining > 0) holders.set(conversationKey, remaining);
      else holders.delete(conversationKey);
    };
  }, [conversationKey]);
}

/**
 * The Outlook composer's context choices for the conversation it shows: the
 * chips' (x)/(+), what went with earlier messages, and an ended scheduling
 * run. Memory only: never Office roaming settings, which would sync them
 * across devices, nor browser storage. Another conversation starts fresh, and
 * a new chat getting its ID keeps its key and so its choices.
 */
export const outlookContextStore = {
  getSnapshot,
  useChoices(
    conversationKey: string,
    { itemKey, selectionKey }: { itemKey: string; selectionKey: string },
  ): OutlookContextChoices {
    useHeld(conversationKey);
    const stored = useSyncExternalStore(subscribe, getSnapshot).get(
      conversationKey,
    );
    const settled = settle(
      stored ?? freshChoices(itemKey),
      itemKey,
      selectionKey,
    );
    useLayoutEffect(() => {
      write(conversationKey, itemKey, (current) => current, selectionKey);
    }, [conversationKey, itemKey, selectionKey, stored]);
    return {
      selectionDismissed: settled.selection.dismissed,
      draftOff: settled.draft.off,
      threadChoice: settled.thread.choice,
      threadsSentInChat: settled.threadsSentInChat,
      attachmentsGroupOff: settled.attachments.groupOff,
      includeOnFollowUpIds: settled.attachments.includeOnFollowUpIds,
      sentAttachmentIds: settled.attachments.sentIds,
      schedulingEndedAt: settled.schedulingEndedAt,
    };
  },
  dismissSelection(
    conversationKey: string,
    itemKey: string,
    selectionKey: string,
  ) {
    write(
      conversationKey,
      itemKey,
      (current) =>
        current.selection.dismissed
          ? current
          : {
              ...current,
              selection: { ...current.selection, dismissed: true },
            },
      selectionKey,
    );
  },
  rearmSelection(
    conversationKey: string,
    itemKey: string,
    selectionKey: string,
  ) {
    write(
      conversationKey,
      itemKey,
      (current) =>
        current.selection.dismissed
          ? {
              ...current,
              selection: { ...current.selection, dismissed: false },
            }
          : current,
      selectionKey,
    );
  },
  setDraftOff(conversationKey: string, itemKey: string, off: boolean) {
    write(conversationKey, itemKey, (current) =>
      current.draft.off === off
        ? current
        : { ...current, draft: { itemKey, off } },
    );
  },
  setThreadChoice(
    conversationKey: string,
    itemKey: string,
    choice: OutlookThreadChoice,
  ) {
    write(conversationKey, itemKey, (current) =>
      current.thread.choice === choice
        ? current
        : { ...current, thread: { itemKey, choice } },
    );
  },
  /** The "+" menu's "add it again": the thread goes with the next message. */
  includeThreadAgain(
    conversationKey: string,
    itemKey: string,
    conversationId: string,
  ) {
    write(conversationKey, itemKey, (current) => {
      const threadsSentInChat = new Set(current.threadsSentInChat);
      threadsSentInChat.delete(conversationId);
      return {
        ...current,
        thread: { itemKey, choice: "included" },
        threadsSentInChat,
      };
    });
  },
  setAttachmentsGroupOff(
    conversationKey: string,
    itemKey: string,
    off: boolean,
  ) {
    write(conversationKey, itemKey, (current) =>
      current.attachments.groupOff === off
        ? current
        : {
            ...current,
            attachments: { ...current.attachments, groupOff: off },
          },
    );
  },
  includeAttachmentsOnFollowUp(
    conversationKey: string,
    itemKey: string,
    ids: readonly string[],
  ) {
    write(conversationKey, itemKey, (current) => {
      const includeOnFollowUpIds = withId(
        current.attachments.includeOnFollowUpIds,
        ids,
      );
      return includeOnFollowUpIds === current.attachments.includeOnFollowUpIds
        ? current
        : {
            ...current,
            attachments: { ...current.attachments, includeOnFollowUpIds },
          };
    });
  },
  endScheduling(conversationKey: string, itemKey: string, signalAt: string) {
    write(conversationKey, itemKey, (current) =>
      current.schedulingEndedAt === signalAt
        ? current
        : { ...current, schedulingEndedAt: signalAt },
    );
  },
  /**
   * Records what a dispatched send carried and ends the choices that held for
   * one message: an included thread and follow-up includes. Leaving out and
   * switching off last until the item changes.
   */
  afterSend(
    conversationKey: string,
    { itemKey, threadSent, attachmentIdsSent }: OutlookSentContext,
  ) {
    write(conversationKey, itemKey, (current) => ({
      ...current,
      thread:
        current.thread.choice === "included"
          ? { itemKey, choice: null }
          : current.thread,
      threadsSentInChat: threadSent
        ? withId(current.threadsSentInChat, [threadSent])
        : current.threadsSentInChat,
      attachments: {
        ...current.attachments,
        includeOnFollowUpIds: NO_IDS,
        sentIds: withId(current.attachments.sentIds, attachmentIdsSent),
      },
    }));
  },
  resetForTests() {
    state = new Map();
    holders.clear();
    listeners.clear();
  },
};
