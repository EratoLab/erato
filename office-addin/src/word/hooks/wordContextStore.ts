import { useLayoutEffect, useSyncExternalStore } from "react";

import { nextSelectionDismissal } from "../../core/selection/selectionDismissal";

import type { SelectionDismissalState } from "../../core/selection/selectionDismissal";

interface DocumentInclusion {
  conversationKey: string;
  /** The setting for new chats as it stood when the chat got its ID. */
  chatDefault: boolean | null;
  /** The chip's (x) or (+) in this conversation. */
  override: boolean | null;
}

interface WordContextState {
  document: DocumentInclusion;
  selection: SelectionDismissalState;
}

const INITIAL: WordContextState = {
  document: { conversationKey: "", chatDefault: null, override: null },
  selection: { contextKey: "", selectionKey: "", dismissed: false },
};

let state = INITIAL;
const listeners = new Set<() => void>();

function publish(next: WordContextState) {
  if (next === state) return;
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

function documentEntry(conversationKey: string): DocumentInclusion {
  return state.document.conversationKey === conversationKey
    ? state.document
    : { conversationKey, chatDefault: null, override: null };
}

function setDocument(next: DocumentInclusion) {
  const current = state.document;
  if (
    next.conversationKey === current.conversationKey &&
    next.chatDefault === current.chatDefault &&
    next.override === current.override
  )
    return;
  publish({ ...state, document: next });
}

function setSelection(next: SelectionDismissalState) {
  if (next === state.selection) return;
  const current = state.selection;
  if (
    next.contextKey === current.contextKey &&
    next.selectionKey === current.selectionKey &&
    next.dismissed === current.dismissed
  )
    return;
  publish({ ...state, selection: next });
}

/**
 * Whether the document goes with the chat's messages: the chip's choice, else the setting for new
 * chats, which a chat keeps from the moment it gets its ID.
 */
export function wordDocumentIncluded(
  entry: DocumentInclusion,
  conversationKey: string,
  { chatStarted, includeByDefault }: WordDocumentInclusionDefaults,
): boolean {
  const own = entry.conversationKey === conversationKey ? entry : null;
  return (
    own?.override ??
    (chatStarted ? (own?.chatDefault ?? includeByDefault) : includeByDefault)
  );
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
 * or browser storage. One slot, keyed by conversation: another conversation starts from its
 * defaults, and a new chat getting its ID keeps its key and so its choices.
 */
export const wordContextStore = {
  getSnapshot,
  useDocumentIncluded(
    conversationKey: string,
    defaults: WordDocumentInclusionDefaults,
  ): boolean {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot);
    const frozen =
      snapshot.document.conversationKey === conversationKey
        ? snapshot.document.chatDefault
        : null;
    const { chatStarted, includeByDefault } = defaults;
    useLayoutEffect(() => {
      if (!chatStarted || frozen !== null) return;
      setDocument({
        ...documentEntry(conversationKey),
        chatDefault: includeByDefault,
      });
    }, [conversationKey, chatStarted, frozen, includeByDefault]);
    return wordDocumentIncluded(snapshot.document, conversationKey, defaults);
  },
  setDocumentIncluded(conversationKey: string, included: boolean) {
    setDocument({ ...documentEntry(conversationKey), override: included });
  },
  useSelectionDismissed(
    conversationKey: string,
    selectionKey: string,
  ): boolean {
    const stored = useSyncExternalStore(subscribe, getSnapshot).selection;
    // Every key the selection passes through is recorded, so a passage selected again after
    // nothing was selected reads as new.
    useLayoutEffect(() => {
      setSelection(
        nextSelectionDismissal(stored, selectionKey, conversationKey),
      );
    }, [stored, selectionKey, conversationKey]);
    return nextSelectionDismissal(stored, selectionKey, conversationKey)
      .dismissed;
  },
  dismissSelection(conversationKey: string, selectionKey: string) {
    const current = nextSelectionDismissal(
      state.selection,
      selectionKey,
      conversationKey,
    );
    setSelection({ ...current, dismissed: true });
  },
  rearmSelection(conversationKey: string, selectionKey: string) {
    const current = nextSelectionDismissal(
      state.selection,
      selectionKey,
      conversationKey,
    );
    setSelection({ ...current, dismissed: false });
  },
  resetForTests() {
    state = INITIAL;
    listeners.clear();
  },
};
