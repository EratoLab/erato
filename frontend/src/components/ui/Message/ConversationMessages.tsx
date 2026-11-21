import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
} from "react";

import {
  createValueStore,
  useValueStoreSelector,
} from "@/utils/chat/valueStore";

import type { Message } from "@/types/chat";
import type { ValueStore } from "@/utils/chat/valueStore";
import type { ReactNode } from "react";

type MessagesById = Readonly<Record<string, Message | undefined>>;

const EMPTY: MessagesById = {};
const EMPTY_STORE: ValueStore<MessagesById> = {
  get: () => EMPTY,
  subscribe: () => () => {},
};

// A store rather than a context value: a plain value would re-render every
// message on each streamed token, while a reader here re-renders only when
// what it selects changes.
const ConversationMessagesContext =
  createContext<ValueStore<MessagesById>>(EMPTY_STORE);

/** Gives a message renderer read access to the rest of its conversation. */
export function ConversationMessagesProvider({
  messages,
  children,
}: {
  messages: MessagesById;
  children: ReactNode;
}) {
  const [store] = useState(() => createValueStore(messages));
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
  return useValueStoreSelector(
    useContext(ConversationMessagesContext),
    select,
    isEqual,
  );
}
