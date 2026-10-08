import { useState } from "react";

let newConversationCount = 0;

function conversationKey(chatId: string | null, hostIdentity: string): string {
  // Two new chats in a row are different conversations, so each gets its own key.
  const conversation =
    chatId != null ? ["chat", chatId] : ["new", ++newConversationCount];
  return JSON.stringify([hostIdentity, ...conversation]);
}

/**
 * Identifies the conversation the composer belongs to. A new chat receiving
 * its server ID on first send keeps its key; any other chat switch or host
 * identity change produces a new one.
 */
export function useConversationKey(
  chatId: string | null | undefined,
  hostIdentity: string,
): string {
  const currentChatId = chatId ?? null;
  const [state, setState] = useState(() => ({
    chatId: currentChatId,
    hostIdentity,
    key: conversationKey(currentChatId, hostIdentity),
  }));
  if (state.chatId === currentChatId && state.hostIdentity === hostIdentity) {
    return state.key;
  }
  const isNewChatGettingItsId =
    state.hostIdentity === hostIdentity &&
    state.chatId == null &&
    currentChatId != null;
  const next = {
    chatId: currentChatId,
    hostIdentity,
    key: isNewChatGettingItsId
      ? state.key
      : conversationKey(currentChatId, hostIdentity),
  };
  setState(next);
  return next.key;
}
