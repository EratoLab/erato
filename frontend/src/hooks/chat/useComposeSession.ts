import { useCallback, useEffect, useRef, useState } from "react";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ComposeDraftState {
  message: string;
  attachedFiles: FileUploadItem[];
}

const EMPTY_DRAFT: ComposeDraftState = Object.freeze({
  message: "",
  attachedFiles: [],
});

// eslint-disable-next-line lingui/no-unlocalized-strings -- internal sentinel key, never user-facing
const NEW_CHAT_KEY = "__new-chat__";

function chatIdKey(chatId: string | null | undefined): string {
  return chatId ?? NEW_CHAT_KEY;
}

function generateSessionId(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `cs-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

/**
 * Owns a stable compose-session identity per chat that survives a
 * chatId rename mid-session (e.g. the `null` → real-UUID transition
 * after `chat_created`). Async producers (dictation, paste handlers)
 * should capture the returned `sessionId` once and route updates by
 * comparing against `getActiveSessionId()` at delivery time, rather
 * than holding a value derived from `chatId` directly.
 */
export function useComposeSession({
  chatId,
}: {
  chatId: string | null | undefined;
}) {
  const sessionIdByChatKeyRef = useRef<Map<string, string>>(new Map());
  const draftsBySessionIdRef = useRef<Map<string, ComposeDraftState>>(new Map());

  const resolveActiveSessionId = useCallback((): string => {
    const key = chatIdKey(chatId);
    const existing = sessionIdByChatKeyRef.current.get(key);
    if (existing) {
      return existing;
    }
    const minted = generateSessionId();
    sessionIdByChatKeyRef.current.set(key, minted);
    return minted;
  }, [chatId]);

  const [activeSessionId, setActiveSessionId] = useState<string>(() =>
    resolveActiveSessionId(),
  );

  const previousChatKeyRef = useRef<string>(chatIdKey(chatId));

  useEffect(() => {
    const previousKey = previousChatKeyRef.current;
    const nextKey = chatIdKey(chatId);

    if (previousKey === nextKey) {
      return;
    }

    // Sentinel → real chatId: the session that was bound to `null`
    // follows the chat into its real identity. The session id itself
    // stays the same; only the lookup key changes.
    if (previousKey === NEW_CHAT_KEY && nextKey !== NEW_CHAT_KEY) {
      const sentinelSessionId =
        sessionIdByChatKeyRef.current.get(NEW_CHAT_KEY);
      if (sentinelSessionId !== undefined) {
        sessionIdByChatKeyRef.current.delete(NEW_CHAT_KEY);
        sessionIdByChatKeyRef.current.set(nextKey, sentinelSessionId);
      }
    }

    previousChatKeyRef.current = nextKey;

    const nextSessionId =
      sessionIdByChatKeyRef.current.get(nextKey) ?? generateSessionId();
    sessionIdByChatKeyRef.current.set(nextKey, nextSessionId);
    setActiveSessionId((current) =>
      current === nextSessionId ? current : nextSessionId,
    );
  }, [chatId]);

  const getActiveSessionId = useCallback(() => activeSessionId, [activeSessionId]);

  const getDraft = useCallback((sessionId: string): ComposeDraftState => {
    return draftsBySessionIdRef.current.get(sessionId) ?? EMPTY_DRAFT;
  }, []);

  const saveDraft = useCallback(
    (sessionId: string, draft: ComposeDraftState) => {
      draftsBySessionIdRef.current.set(sessionId, draft);
    },
    [],
  );

  return {
    sessionId: activeSessionId,
    getActiveSessionId,
    getDraft,
    saveDraft,
  };
}
