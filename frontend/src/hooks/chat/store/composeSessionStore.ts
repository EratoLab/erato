import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { ComposeDraftState } from "@/hooks/chat/useComposeSession";

/**
 * Compose-session identity and per-session drafts, keyed by chat.
 *
 * This lives outside the component tree because `ChatInput` is torn down and
 * rebuilt underneath the user: the New Chat button bumps `newChatCounter` in
 * ChatProvider, which is the `key` on `<Chat>`, and the empty-state → messages
 * layout flip remounts it by position. Holding either map in a ref meant a
 * remount minted a fresh session id for the same chat, orphaning that chat's
 * draft and any queued message. (ERMAIN-470)
 */
interface ComposeSessionStore {
  sessionIdByChatKey: Partial<Record<string, string>>;
  draftsBySessionId: Partial<Record<string, ComposeDraftState>>;
  resolveSessionId: (chatKey: string) => string;
  adoptSessionId: (fromChatKey: string, toChatKey: string) => void;
  getDraft: (sessionId: string) => ComposeDraftState;
  saveDraft: (sessionId: string, draft: ComposeDraftState) => void;
}

export const EMPTY_COMPOSE_DRAFT: ComposeDraftState = Object.freeze({
  message: "",
  attachedFiles: [],
});

export const useComposeSessionStore = create<ComposeSessionStore>()(
  devtools(
    (set, get) => ({
      sessionIdByChatKey: {},
      draftsBySessionId: {},

      resolveSessionId: (chatKey) => {
        const existing = get().sessionIdByChatKey[chatKey];
        if (existing) {
          return existing;
        }
        const minted = globalThis.crypto.randomUUID();
        set(
          (prev) => ({
            sessionIdByChatKey: {
              ...prev.sessionIdByChatKey,
              [chatKey]: minted,
            },
          }),
          false,
          "composeSession/resolveSessionId",
        );
        return minted;
      },

      // Sentinel → real chatId: the session bound to the new-chat key follows
      // the chat into its real identity, so the session id itself is unchanged
      // and only the lookup key moves.
      //
      // Only a chat that has never been seen can inherit. Navigating from the
      // new-chat route back into an existing chat looks identical from here,
      // and adopting there would hand that chat the empty new-chat session and
      // strand its own draft.
      adoptSessionId: (fromChatKey, toChatKey) =>
        set(
          (prev) => {
            const inherited = prev.sessionIdByChatKey[fromChatKey];
            if (inherited === undefined || prev.sessionIdByChatKey[toChatKey]) {
              return prev;
            }
            const next = { ...prev.sessionIdByChatKey };
            delete next[fromChatKey];
            next[toChatKey] = inherited;
            return { sessionIdByChatKey: next };
          },
          false,
          "composeSession/adoptSessionId",
        ),

      getDraft: (sessionId) =>
        get().draftsBySessionId[sessionId] ?? EMPTY_COMPOSE_DRAFT,

      saveDraft: (sessionId, draft) =>
        set(
          (prev) => ({
            draftsBySessionId: {
              ...prev.draftsBySessionId,
              [sessionId]: draft,
            },
          }),
          false,
          "composeSession/saveDraft",
        ),
    }),
    {
      name: "Compose Session Store",
      store: "compose-session-store",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
