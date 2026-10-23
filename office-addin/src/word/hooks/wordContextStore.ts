import { useLayoutEffect, useSyncExternalStore } from "react";

import { nextSelectionDismissal } from "../../core/selection/selectionDismissal";

import type { SelectionDismissalState } from "../../core/selection/selectionDismissal";

interface DocumentInclusion {
  /** The setting for new chats as it stood when the chat got its ID. */
  chatDefault: boolean | null;
  /** The chip's (x) or (+) in this conversation. */
  override: boolean | null;
}

interface ConversationChoices {
  document: DocumentInclusion;
  selection: SelectionDismissalState;
}

/** By conversation key, so composers on different conversations never write each other's entry. */
type WordContextState = ReadonlyMap<string, ConversationChoices>;

const NO_DOCUMENT_CHOICE: DocumentInclusion = {
  chatDefault: null,
  override: null,
};

const freshChoices = (conversationKey: string): ConversationChoices => ({
  document: NO_DOCUMENT_CHOICE,
  selection: {
    contextKey: conversationKey,
    selectionKey: "",
    dismissed: false,
  },
});

let state: WordContextState = new Map();
const holders = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(next: WordContextState) {
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
  change: (current: ConversationChoices) => ConversationChoices,
) {
  const current = state.get(conversationKey) ?? freshChoices(conversationKey);
  const next = change(current);
  if (next === current && state.has(conversationKey)) return;
  const map = new Map(state);
  map.set(conversationKey, next);
  publish(map);
}

function setDocument(
  conversationKey: string,
  change: Partial<DocumentInclusion>,
) {
  write(conversationKey, (current) => {
    const document = { ...current.document, ...change };
    return document.chatDefault === current.document.chatDefault &&
      document.override === current.document.override
      ? current
      : { ...current, document };
  });
}

function setSelection(
  conversationKey: string,
  change: (current: SelectionDismissalState) => SelectionDismissalState,
) {
  write(conversationKey, (current) => {
    const selection = change(current.selection);
    return selection.selectionKey === current.selection.selectionKey &&
      selection.dismissed === current.selection.dismissed
      ? current
      : { ...current, selection };
  });
}

/**
 * Marks a conversation as shown by a mounted composer. Choices of a conversation no composer
 * shows any more are dropped when a composer takes a key, so a chat left and opened again
 * starts from its defaults, while a composer that mounts again in the same chat keeps them.
 */
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

export interface WordDocumentInclusionDefaults {
  /** The chat has a server ID. */
  chatStarted: boolean;
  /** The setting "Include the open document in new chats". */
  includeByDefault: boolean;
}

/**
 * The composer's context choices for the conversation it shows: the document's (x)/(+) and the
 * selection's dismissal. Memory only, never Office settings (they would be saved into the DOCX)
 * or browser storage. Another conversation starts from its defaults, and a new chat getting its
 * ID keeps its key and so its choices.
 */
export const wordContextStore = {
  getSnapshot,
  /**
   * Whether the document goes with the chat's messages: the chip's choice, else the setting for
   * new chats, which a chat keeps from the moment it gets its ID.
   */
  useDocumentIncluded(
    conversationKey: string,
    { chatStarted, includeByDefault }: WordDocumentInclusionDefaults,
  ): boolean {
    useHeld(conversationKey);
    const document =
      useSyncExternalStore(subscribe, getSnapshot).get(conversationKey)
        ?.document ?? NO_DOCUMENT_CHOICE;
    const frozen = document.chatDefault;
    useLayoutEffect(() => {
      if (!chatStarted || frozen !== null) return;
      setDocument(conversationKey, { chatDefault: includeByDefault });
    }, [conversationKey, chatStarted, frozen, includeByDefault]);
    return (
      document.override ??
      (chatStarted ? (frozen ?? includeByDefault) : includeByDefault)
    );
  },
  setDocumentIncluded(conversationKey: string, included: boolean) {
    setDocument(conversationKey, { override: included });
  },
  useSelectionDismissed(
    conversationKey: string,
    selectionKey: string,
  ): boolean {
    useHeld(conversationKey);
    const stored = useSyncExternalStore(subscribe, getSnapshot).get(
      conversationKey,
    )?.selection;
    // Every key the selection passes through is recorded, so a passage selected again after
    // nothing was selected reads as new.
    useLayoutEffect(() => {
      setSelection(conversationKey, (current) =>
        nextSelectionDismissal(current, selectionKey, conversationKey),
      );
    }, [stored, selectionKey, conversationKey]);
    return nextSelectionDismissal(
      stored ?? freshChoices(conversationKey).selection,
      selectionKey,
      conversationKey,
    ).dismissed;
  },
  dismissSelection(conversationKey: string, selectionKey: string) {
    setSelection(conversationKey, (current) => ({
      ...nextSelectionDismissal(current, selectionKey, conversationKey),
      dismissed: true,
    }));
  },
  rearmSelection(conversationKey: string, selectionKey: string) {
    setSelection(conversationKey, (current) => ({
      ...nextSelectionDismissal(current, selectionKey, conversationKey),
      dismissed: false,
    }));
  },
  resetForTests() {
    state = new Map();
    holders.clear();
    listeners.clear();
  },
};
