import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { Message } from "@/types/chat";
import type { ReactNode } from "react";

type MessagesById = Readonly<Record<string, Message | undefined>>;

interface ConversationMessagesStore {
  get: () => MessagesById;
  subscribe: (listener: () => void) => () => void;
}

function createStore(initial: MessagesById) {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set(next: MessagesById) {
      if (next === current) return;
      current = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const EMPTY: MessagesById = {};
const EMPTY_STORE: ConversationMessagesStore = {
  get: () => EMPTY,
  subscribe: () => () => {},
};

// A store rather than a context value: a plain value would re-render every
// message on each streamed token, while a reader here re-renders only when
// what it selects changes.
const ConversationMessagesContext =
  createContext<ConversationMessagesStore>(EMPTY_STORE);

/** Gives a message renderer read access to the rest of its conversation. */
export function ConversationMessagesProvider({
  messages,
  children,
}: {
  messages: MessagesById;
  children: ReactNode;
}) {
  const [store] = useState(() => createStore(messages));
  useLayoutEffect(() => store.set(messages), [store, messages]);
  return (
    <ConversationMessagesContext.Provider value={store}>
      {children}
    </ConversationMessagesContext.Provider>
  );
}

/** One message of the conversation; re-renders only when that message changes. */
export function useConversationMessage(
  messageId: string | undefined,
): Message | undefined {
  const store = useContext(ConversationMessagesContext);
  return useSyncExternalStore(store.subscribe, () =>
    messageId ? store.get()[messageId] : undefined,
  );
}

/** Every message of the conversation; re-renders whenever any changes. */
export function useConversationMessages(): MessagesById {
  const store = useContext(ConversationMessagesContext);
  return useSyncExternalStore(store.subscribe, store.get);
}
