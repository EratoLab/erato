import { useCallback, useEffect, useRef, useState } from "react";

import { useComposeSessionStore } from "@/hooks/chat/store/composeSessionStore";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface ComposeDraftState {
  message: string;
  attachedFiles: FileUploadItem[];
}

// eslint-disable-next-line lingui/no-unlocalized-strings -- internal sentinel key, never user-facing
const NEW_CHAT_KEY = "__new-chat__";

function chatIdKey(chatId: string | null | undefined): string {
  return chatId ?? NEW_CHAT_KEY;
}

/**
 * Owns a stable compose-session identity per chat that survives a chatId
 * rename mid-session (e.g. the `null` → real-UUID transition after
 * `chat_created`) and a remount of the component tree. Async producers
 * (dictation, paste handlers) should capture the returned `sessionId` once and
 * route updates by comparing against `getActiveSessionId()` at delivery time,
 * rather than holding a value derived from `chatId` directly.
 *
 * Identity and drafts live in `composeSessionStore` rather than in refs here,
 * so that a remount cannot orphan the chat's draft or queued message.
 */
export function useComposeSession({
  chatId,
}: {
  chatId: string | null | undefined;
}) {
  const resolveSessionId = useComposeSessionStore(
    (state) => state.resolveSessionId,
  );
  const adoptSessionId = useComposeSessionStore(
    (state) => state.adoptSessionId,
  );
  const getDraft = useComposeSessionStore((state) => state.getDraft);
  const saveDraft = useComposeSessionStore((state) => state.saveDraft);

  const [activeSessionId, setActiveSessionId] = useState<string>(() =>
    resolveSessionId(chatIdKey(chatId)),
  );

  const previousChatKeyRef = useRef<string>(chatIdKey(chatId));

  useEffect(() => {
    const previousKey = previousChatKeyRef.current;
    const nextKey = chatIdKey(chatId);

    if (previousKey === nextKey) {
      return;
    }

    if (previousKey === NEW_CHAT_KEY && nextKey !== NEW_CHAT_KEY) {
      adoptSessionId(NEW_CHAT_KEY, nextKey);
    }

    previousChatKeyRef.current = nextKey;

    const nextSessionId = resolveSessionId(nextKey);
    setActiveSessionId((current) =>
      current === nextSessionId ? current : nextSessionId,
    );
  }, [chatId, adoptSessionId, resolveSessionId]);

  const getActiveSessionId = useCallback(
    () => activeSessionId,
    [activeSessionId],
  );

  return {
    sessionId: activeSessionId,
    getActiveSessionId,
    getDraft,
    saveDraft,
  };
}
