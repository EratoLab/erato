import {
  selectAddinSessionAction,
  useMessagingStore,
  usePersistedState,
} from "@erato/frontend/library";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  dismissSessionToasts,
  showSessionAskToast,
} from "./components/sessionAskToast";
import { useOutlookSessionAnchor } from "./hooks/useOutlookSessionAnchor";
import {
  DEFAULT_OUTLOOK_SESSION,
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_KEY,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  anchorsEqualForPreferences,
  migrateLegacyChatIdKey,
  outlookAnchorFromItem,
  outlookSessionPersistedOptions,
  outlookSessionPreferencesPersistedOptions,
  resolveSupportedMailboxItem,
  type OutlookSessionAnchor,
  type OutlookSessionStorageValue,
} from "./sessionPolicy";

import type {
  AddinSessionController,
  AddinSessionControllerProps,
} from "../core/AddinChatProviderCore";

migrateLegacyChatIdKey();

export type SessionLifecycle =
  | { kind: "pending" }
  | { kind: "decided"; chatId: string | null };

function readSyncOutlookAnchor(): OutlookSessionAnchor | null {
  try {
    return outlookAnchorFromItem(
      resolveSupportedMailboxItem(Office.context.mailbox?.item),
    );
  } catch {
    return null;
  }
}

export interface ComputeInitialLifecycleArgs {
  isOutlook: boolean;
  session: OutlookSessionStorageValue;
  sessionPreferences: typeof DEFAULT_OUTLOOK_SESSION_PREFERENCES;
  liveAnchor: OutlookSessionAnchor | null;
}

export function computeInitialLifecycle({
  isOutlook,
  session,
  sessionPreferences,
  liveAnchor,
}: ComputeInitialLifecycleArgs): SessionLifecycle {
  if (!isOutlook || sessionPreferences.mode === "resume") {
    return { kind: "decided", chatId: session.chatId };
  }
  if (
    liveAnchor &&
    session.anchor &&
    anchorsEqualForPreferences(sessionPreferences)(session.anchor, liveAnchor)
  ) {
    return { kind: "decided", chatId: session.chatId };
  }
  return { kind: "pending" };
}

export function OutlookAddinSessionController({
  chats,
  children,
}: AddinSessionControllerProps) {
  const [session, setSession] = usePersistedState<OutlookSessionStorageValue>(
    OUTLOOK_SESSION_KEY,
    DEFAULT_OUTLOOK_SESSION,
    outlookSessionPersistedOptions,
  );
  const [sessionPreferences] = usePersistedState(
    OUTLOOK_SESSION_PREFERENCES_KEY,
    DEFAULT_OUTLOOK_SESSION_PREFERENCES,
    outlookSessionPreferencesPersistedOptions,
  );
  const currentAnchor = useOutlookSessionAnchor();
  const [newChatCounter, setNewChatCounter] = useState(0);
  const [lifecycle, setLifecycle] = useState<SessionLifecycle>(() =>
    computeInitialLifecycle({
      isOutlook: true,
      session,
      sessionPreferences,
      liveAnchor: readSyncOutlookAnchor(),
    }),
  );
  const clearNewlyCreatedChatIdRef = useRef<() => void>(() => {});

  const setCurrentChatId = useCallback(
    (chatId: string | null, anchor?: OutlookSessionAnchor | null) => {
      setSession((previous) => ({
        chatId,
        anchor: anchor === undefined ? previous.anchor : anchor,
      }));
      setLifecycle((previous) =>
        previous.kind === "decided" && previous.chatId === chatId
          ? previous
          : { kind: "decided", chatId },
      );
    },
    [setSession],
  );
  const resetMessaging = useCallback(() => {
    useMessagingStore.getState().abortActiveSSE();
    useMessagingStore.getState().clearUserMessages();
    useMessagingStore.getState().resetStreaming();
    clearNewlyCreatedChatIdRef.current();
  }, []);
  const beginNewChat = useCallback(() => {
    setNewChatCounter((value) => value + 1);
    setCurrentChatId(null, currentAnchor);
  }, [currentAnchor, setCurrentChatId]);
  const beginNewChatFromPolicy = useCallback(() => {
    beginNewChat();
    resetMessaging();
  }, [beginNewChat, resetMessaging]);
  const selectChat = useCallback(
    (chatId: string) => setCurrentChatId(chatId, currentAnchor),
    [currentAnchor, setCurrentChatId],
  );

  const lastEvaluatedAnchorRef = useRef<OutlookSessionAnchor | null | "unset">(
    "unset",
  );
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const beginNewChatFromPolicyRef = useRef(beginNewChatFromPolicy);
  beginNewChatFromPolicyRef.current = beginNewChatFromPolicy;
  const selectChatRef = useRef(selectChat);
  selectChatRef.current = selectChat;

  useEffect(() => {
    if (currentAnchor === null) return;
    const previousAnchor = lastEvaluatedAnchorRef.current;
    const trigger =
      previousAnchor === "unset"
        ? ({ kind: "cold-open" } as const)
        : ({
            kind: "context-change",
            previous: previousAnchor,
            next: currentAnchor,
          } as const);
    lastEvaluatedAnchorRef.current = currentAnchor;
    const action = selectAddinSessionAction<OutlookSessionAnchor>({
      trigger,
      saved: sessionRef.current,
      currentAnchor,
      policy: { mode: sessionPreferences.mode },
      anchorsEqual: anchorsEqualForPreferences(sessionPreferences),
    });

    if (action.kind !== "ask") dismissSessionToasts();
    switch (action.kind) {
      case "resume":
        if (sessionRef.current.chatId !== action.chatId) {
          setCurrentChatId(action.chatId, currentAnchor);
        } else {
          setSession({ chatId: action.chatId, anchor: currentAnchor });
        }
        break;
      case "new":
        if (sessionRef.current.chatId !== null) {
          beginNewChatFromPolicyRef.current();
        } else {
          setSession({ chatId: null, anchor: currentAnchor });
        }
        break;
      case "ask": {
        const suggestedChat = action.suggestedChatId
          ? chatsRef.current.find((chat) => chat.id === action.suggestedChatId)
          : null;
        showSessionAskToast({
          suggestedChat: suggestedChat
            ? {
                id: suggestedChat.id,
                title: suggestedChat.title_resolved,
                lastMessageAt: suggestedChat.last_message_at ?? null,
              }
            : action.suggestedChatId
              ? {
                  id: action.suggestedChatId,
                  title: null,
                  lastMessageAt: null,
                }
              : null,
          recentChats: chatsRef.current.map((chat) => ({
            id: chat.id,
            title: chat.title_resolved,
            lastMessageAt: chat.last_message_at ?? null,
          })),
          onResume: (chatId) => selectChatRef.current(chatId),
          onPickRecent: (chatId) => selectChatRef.current(chatId),
          onNew: () => beginNewChatFromPolicyRef.current(),
        });
        break;
      }
    }
    setLifecycle((previous) =>
      previous.kind === "pending"
        ? { kind: "decided", chatId: sessionRef.current.chatId }
        : previous,
    );
  }, [
    currentAnchor,
    resetMessaging,
    sessionPreferences,
    setCurrentChatId,
    setSession,
  ]);

  const controller: AddinSessionController = {
    currentChatId: session.chatId,
    effectiveChatId: lifecycle.kind === "decided" ? lifecycle.chatId : null,
    newChatCounter,
    beginNewChat,
    selectChat,
    adoptNewChatId: selectChat,
    clearNewlyCreatedChatIdRef,
  };
  return children(controller);
}
