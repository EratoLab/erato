import { chatMessagesQuery, useMessagingStore } from "@erato/frontend/library";
import { hashKey, useQueryClient } from "@tanstack/react-query";
import { createElement, useCallback, useEffect, useRef, useState } from "react";

import {
  getWordDocumentIdentity,
  readLiveWordDocumentUrl,
} from "./utils/wordDocumentIdentity";
import {
  forgetWordDocumentChat,
  readWordDocumentChat,
  recordWordDocumentChat,
  wordDocumentChatKey,
} from "./wordDocumentChatMap";

import type {
  AddinSessionController,
  AddinSessionControllerProps,
} from "../core/AddinChatProviderCore";

/** Written by builds that shared one open chat across every Word document. */
export const LEGACY_WORD_CURRENT_CHAT_KEY = "erato.addin.word.currentChat.v1";

interface WordDocumentOpening {
  documentKey: string | null;
  chatId: string | null;
}

async function openWordDocument(
  identity: string,
): Promise<WordDocumentOpening> {
  const documentKey = await wordDocumentChatKey(identity);
  const chatId = documentKey ? readWordDocumentChat(documentKey) : null;
  if (documentKey && chatId) recordWordDocumentChat(documentKey, chatId);
  return { documentKey, chatId };
}

async function liveDocumentKey(): Promise<string | null> {
  const url = await readLiveWordDocumentUrl();
  return url === null ? null : wordDocumentChatKey(url);
}

/** The history GET answers 404 for a chat that is gone or no longer accessible. */
function isChatNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}

function removeLegacyCurrentChat(): void {
  try {
    localStorage.removeItem(LEGACY_WORD_CURRENT_CHAT_KEY);
  } catch {
    // Storage may be blocked; the stale key is then unreadable anyway.
  }
}

/** The open chat lives in pane state so two panes never move each other's chat. */
export function WordAddinSessionController(props: AddinSessionControllerProps) {
  const [opening, setOpening] = useState<WordDocumentOpening | null>(null);

  useEffect(() => {
    removeLegacyCurrentChat();
    let cancelled = false;
    void openWordDocument(getWordDocumentIdentity()).then((next) => {
      if (!cancelled) setOpening(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rendering before the lookup settles would flash a new chat, then swap.
  if (opening === null) return null;
  return createElement(WordDocumentSessionController, { ...props, opening });
}

function WordDocumentSessionController({
  children,
  opening,
}: AddinSessionControllerProps & { opening: WordDocumentOpening }) {
  const { documentKey } = opening;
  const queryClient = useQueryClient();
  const [currentChatId, setCurrentChatId] = useState(opening.chatId);
  const [newChatCounter, setNewChatCounter] = useState(0);
  const currentChatIdRef = useRef(opening.chatId);
  const clearNewlyCreatedChatIdRef = useRef<() => void>(() => {});

  // An unsaved document gets its URL on first save, and after Save As the pane edits the new
  // file, so chats are recorded under the URL Word reports now, not the one at pane load.
  const currentKeyRef = useRef(documentKey);
  const rememberChat = useCallback(() => {
    void liveDocumentKey().then((liveKey) => {
      if (liveKey !== null) currentKeyRef.current = liveKey;
      const key = currentKeyRef.current;
      const latest = currentChatIdRef.current;
      if (key !== null && latest !== null) recordWordDocumentChat(key, latest);
    });
  }, []);

  const beginNewChat = useCallback(() => {
    currentChatIdRef.current = null;
    setNewChatCounter((value) => value + 1);
    setCurrentChatId(null);
  }, []);
  const selectChat = useCallback(
    (chatId: string) => {
      currentChatIdRef.current = chatId;
      setCurrentChatId(chatId);
      rememberChat();
    },
    [rememberChat],
  );

  useEffect(() => {
    const onFocus = () => {
      if (currentChatIdRef.current !== null) rememberChat();
    };
    globalThis.addEventListener("focus", onFocus);
    return () => globalThis.removeEventListener("focus", onFocus);
  }, [rememberChat]);

  useEffect(() => {
    if (currentChatId === null) return;
    const { queryKey } = chatMessagesQuery({
      pathParams: { chatId: currentChatId },
    });
    const queryHash = hashKey(queryKey);
    let handled = false;
    const check = () => {
      const state = queryClient.getQueryState(queryKey);
      if (handled || state?.status !== "error") return;
      if (!isChatNotFound(state.error)) return;
      handled = true;
      for (const key of new Set([documentKey, currentKeyRef.current])) {
        if (key !== null) forgetWordDocumentChat(key, currentChatId);
      }
      beginNewChat();
      const messaging = useMessagingStore.getState();
      messaging.abortActiveSSE();
      messaging.clearUserMessages();
      messaging.resetStreaming();
      clearNewlyCreatedChatIdRef.current();
    };
    check();
    // Only "updated": observer events fire synchronously inside other components' renders.
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.query.queryHash === queryHash) {
        check();
      }
    });
  }, [beginNewChat, currentChatId, documentKey, queryClient]);

  const controller: AddinSessionController = {
    currentChatId,
    effectiveChatId: currentChatId,
    newChatCounter,
    beginNewChat,
    selectChat,
    adoptNewChatId: selectChat,
    clearNewlyCreatedChatIdRef,
  };
  return children(controller);
}
