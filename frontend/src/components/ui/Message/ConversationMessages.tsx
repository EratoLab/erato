import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
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

/**
 * A value derived from the conversation; re-renders only when `isEqual` says
 * the derived value changed, so tokens streamed into other messages pass by.
 */
export function useConversationSelector<T>(
  select: (messages: MessagesById) => T,
  isEqual: (previous: T, next: T) => boolean,
): T {
  const store = useContext(ConversationMessagesContext);
  const last = useRef<{
    messages: MessagesById;
    select: (messages: MessagesById) => T;
    value: T;
  } | null>(null);
  return useSyncExternalStore(store.subscribe, () => {
    const messages = store.get();
    const cached = last.current;
    if (cached?.messages === messages && cached.select === select)
      return cached.value;
    const next = select(messages);
    const value = cached && isEqual(cached.value, next) ? cached.value : next;
    last.current = { messages, select, value };
    return value;
  });
}
