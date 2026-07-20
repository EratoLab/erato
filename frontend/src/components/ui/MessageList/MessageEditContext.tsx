import { createContext, useContext } from "react";

import type { ReactNode } from "react";

export interface MessageEditContextValue {
  /** The message currently open for editing, if any. */
  editingMessageId: string | null;
  beginEdit: (messageId: string) => void;
  cancelEdit: () => void;
  /** Submits the edit. Files default to the message's own when omitted. */
  submitEdit: (
    messageId: string,
    content: string,
    inputFileIds: string[],
  ) => void;
  /** Blocks Submit: `editMessage` drops edits while a turn is in flight. */
  isStreaming?: boolean;
  /** Passed to the row's token-usage check so Submit can be gated. */
  chatId?: string | null;
  assistantId?: string;
  chatProviderId?: string;
}

/**
 * Editing is opt-in: without a provider the rows render read-only, which is
 * what surfaces embedding `MessageList` without an edit affordance expect.
 */
const MessageEditContext = createContext<MessageEditContextValue | null>(null);

export const MessageEditProvider = ({
  value,
  children,
}: {
  value: MessageEditContextValue;
  children: ReactNode;
}) => (
  <MessageEditContext.Provider value={value}>
    {children}
  </MessageEditContext.Provider>
);

export const useMessageEdit = (): MessageEditContextValue | null =>
  useContext(MessageEditContext);
