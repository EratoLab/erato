import {
  ChatContext,
  evaluateAddinSession,
  getSupportedFileTypes,
  recentChatsQuery,
  useArchiveChatEndpoint,
  useBudgetStatus,
  useChatMessaging,
  useFileCapabilitiesContext,
  useFileDropzone,
  useFileUploadStore,
  useMessagingStore,
  useModelHistory,
  usePersistedState,
  useRecentChats,
  mapMessageToUiMessage,
  type Message,
  type ChatContextValue,
} from "@erato/frontend/library";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOffice } from "./OfficeProvider";
import {
  dismissSessionToasts,
  showSessionAskToast,
} from "../components/sessionAskToast";
import { useOutlookSessionAnchor } from "../hooks/useOutlookSessionAnchor";
import {
  DEFAULT_OUTLOOK_SESSION,
  DEFAULT_OUTLOOK_SESSION_PREFERENCES,
  OUTLOOK_SESSION_KEY,
  OUTLOOK_SESSION_PREFERENCES_KEY,
  anchorsEqualForPreferences,
  migrateLegacyChatIdKey,
  outlookSessionPersistedOptions,
  outlookSessionPreferencesPersistedOptions,
  type OutlookSessionAnchor,
  type OutlookSessionStorageValue,
} from "../sessionPolicy";

import type { ReactNode } from "react";

interface AddinChatMessage extends Message {
  sender: string;
  authorId: string;
  previous_message_id?: string;
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
}

// Run the legacy → versioned-envelope migration once per page load, before the
// provider mounts. Idempotent.
migrateLegacyChatIdKey();

/**
 * The session lifecycle in this provider has two phases. Modelling it as a
 * discriminated union (rather than a `(boolean, chatId)` pair) makes
 * `(chatId: "X", policyDecided: false)` an unrepresentable state.
 *
 * - `pending`: cold-open before the policy has decided. Consumers see no
 *   messages and the messages fetch is gated.
 * - `decided`: the policy has spoken (or never needed to — see
 *   `computeInitialLifecycle` for the cases where we skip the gate). The
 *   `chatId` field is the runtime source of truth for the current chat.
 */
type SessionLifecycle =
  | { kind: "pending" }
  | { kind: "decided"; chatId: string | null };

/**
 * Reads `Office.context.mailbox.item` synchronously and derives the anchor
 * the policy uses. Mirrors `OutlookMailItemProvider`'s sync read path
 * (`readMailItemSync` + `typeof item.subject === "string"` for read/compose
 * discrimination) so we don't have to wait for that provider's `useEffect`
 * to populate state. Returns `null` if no item is selected or Office isn't
 * in a mailbox host.
 */
function readSyncOutlookAnchor(): OutlookSessionAnchor | null {
  try {
    const item = Office.context.mailbox?.item as
      | Office.MessageRead
      | Office.MessageCompose
      | undefined
      | null;
    if (!item) return null;
    return {
      conversationId: item.conversationId ?? null,
      isCompose: typeof (item as Office.MessageRead).subject !== "string",
    };
  } catch {
    return null;
  }
}

interface ComputeInitialLifecycleArgs {
  isOutlook: boolean;
  session: OutlookSessionStorageValue;
  sessionPreferences: typeof DEFAULT_OUTLOOK_SESSION_PREFERENCES;
}

/**
 * Initial lifecycle on mount. Non-Outlook hosts have no policy and start
 * decided. Outlook hosts gate until the policy effect runs — except in two
 * cases where the policy outcome is knowable synchronously and we can skip
 * the gate entirely:
 *
 * 1. Resume mode (the default). The policy always returns "resume" on
 *    cold-open regardless of anchor — no need to wait for the live anchor.
 * 2. Ask / new mode where the saved anchor matches the current Office item
 *    read synchronously. The policy short-circuits to "resume" whenever
 *    `anchorsEqual(saved, current)` holds — so again, no need to wait.
 *
 * Together these cover the common cases (resume mode, or returning to the
 * same email in any mode) and reduce the cold-open gate window to zero
 * frames. Anything else stays `pending`.
 */
function computeInitialLifecycle({
  isOutlook,
  session,
  sessionPreferences,
}: ComputeInitialLifecycleArgs): SessionLifecycle {
  if (!isOutlook) {
    return { kind: "decided", chatId: session.chatId };
  }

  if (sessionPreferences.mode === "resume") {
    return { kind: "decided", chatId: session.chatId };
  }

  const liveAnchor = readSyncOutlookAnchor();
  if (liveAnchor && session.anchor) {
    const equals = anchorsEqualForPreferences(sessionPreferences);
    if (equals(session.anchor, liveAnchor)) {
      return { kind: "decided", chatId: session.chatId };
    }
  }

  return { kind: "pending" };
}

export function AddinChatProvider({ children }: { children: ReactNode }) {
  const { capabilities } = useFileCapabilitiesContext();
  const queryClient = useQueryClient();
  const { host } = useOffice();
  const isOutlook = host === "Outlook";

  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );

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

  const currentChatId = session.chatId;
  const currentAnchor = useOutlookSessionAnchor();
  const [newChatCounter, setNewChatCounter] = useState(0);

  // The Tier-2 gate is now expressed as a discriminated union (see
  // `SessionLifecycle`). The lazy initializer skips the gate when the
  // policy outcome is knowable synchronously — see
  // `computeInitialLifecycle`.
  const [lifecycle, setLifecycle] = useState<SessionLifecycle>(() =>
    computeInitialLifecycle({ isOutlook, session, sessionPreferences }),
  );
  const effectiveChatId =
    lifecycle.kind === "decided" ? lifecycle.chatId : null;

  const setCurrentChatId = useCallback(
    (chatId: string | null, anchor?: OutlookSessionAnchor | null) => {
      setSession((previous) => ({
        chatId,
        anchor: anchor === undefined ? previous.anchor : anchor,
      }));
      // Any explicit chat change implies the session is decided. Idempotent
      // when already decided to the same chatId — React skips the re-render.
      setLifecycle((previous) =>
        previous.kind === "decided" && previous.chatId === chatId
          ? previous
          : { kind: "decided", chatId },
      );
    },
    [setSession],
  );

  const {
    data: chatsData,
    isLoading: isHistoryLoading,
    error: historyError,
    refetch: refetchHistory,
  } = useRecentChats({});
  const chats = useMemo(() => chatsData?.chats ?? [], [chatsData]);

  const { mutateAsync: archiveChatMutation } = useArchiveChatEndpoint();

  const { currentChatLastModel } = useModelHistory({ currentChatId, chats });

  const createNewChat = useCallback(async () => {
    setNewChatCounter((previous) => previous + 1);
    setCurrentChatId(null, currentAnchor);

    useMessagingStore.getState().abortActiveSSE();
    useMessagingStore.getState().clearUserMessages();
    useMessagingStore.getState().resetStreaming();

    return `temp-${Date.now()}`;
  }, [currentAnchor, setCurrentChatId]);

  const navigateToChat = useCallback(
    (chatId: string) => {
      setCurrentChatId(chatId, currentAnchor);
    },
    [currentAnchor, setCurrentChatId],
  );

  const archiveChat = useCallback(
    async (chatId: string) => {
      await archiveChatMutation({ pathParams: { chatId }, body: {} });
      await queryClient.invalidateQueries({
        queryKey: recentChatsQuery({}).queryKey,
      });

      if (currentChatId === chatId) {
        setCurrentChatId(null, currentAnchor);
        setNewChatCounter((previous) => previous + 1);
      }
    },
    [
      archiveChatMutation,
      currentAnchor,
      currentChatId,
      queryClient,
      setCurrentChatId,
    ],
  );

  // Policy: react to cold-open and to debounced context changes. Outlook-only
  // for now — other hosts have no anchor concept and silently keep today's
  // "always resume" behaviour by virtue of `currentAnchor` being null.
  const lastEvaluatedAnchorRef = useRef<OutlookSessionAnchor | null | "unset">(
    "unset",
  );
  const lastEvaluatedChatIdRef = useRef<string | null>(null);

  // The decision side effect needs the latest chat list to surface a sensible
  // "Continue <title>" suggestion. Refs avoid re-running the effect when the
  // chat list ticks for unrelated reasons (cache invalidation, etc.).
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  // The toast outlives the render that spawned it, so its callbacks must
  // always reach the freshest action functions (whose closures capture the
  // current anchor). Without these refs, "Start new" would call a stale
  // closure that silently no-ops.
  const createNewChatRef = useRef(createNewChat);
  createNewChatRef.current = createNewChat;
  const navigateToChatRef = useRef(navigateToChat);
  navigateToChatRef.current = navigateToChat;

  useEffect(() => {
    if (!isOutlook) return;
    if (currentAnchor === null) return; // anchor still settling

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

    const decision = evaluateAddinSession<OutlookSessionAnchor>({
      trigger,
      saved: sessionRef.current,
      currentAnchor,
      policy: { mode: sessionPreferences.mode },
      anchorsEqual: anchorsEqualForPreferences(sessionPreferences),
    });

    // Any decision other than "ask" supersedes a previously-shown ask toast
    // (e.g. user navigated back to the original conversation without picking).
    if (decision.kind !== "ask") {
      dismissSessionToasts();
    }

    switch (decision.kind) {
      case "resume": {
        if (sessionRef.current.chatId !== decision.chatId) {
          setCurrentChatId(decision.chatId, currentAnchor);
        } else {
          // Same chat, but anchor may have moved — record the new anchor so
          // future comparisons stay accurate.
          setSession({ chatId: decision.chatId, anchor: currentAnchor });
        }
        lastEvaluatedChatIdRef.current = decision.chatId;
        break;
      }
      case "new": {
        if (sessionRef.current.chatId !== null) {
          setNewChatCounter((previous) => previous + 1);
          setCurrentChatId(null, currentAnchor);
          useMessagingStore.getState().abortActiveSSE();
          useMessagingStore.getState().clearUserMessages();
          useMessagingStore.getState().resetStreaming();
        } else {
          setSession({ chatId: null, anchor: currentAnchor });
        }
        lastEvaluatedChatIdRef.current = null;
        break;
      }
      case "ask": {
        const suggestedChatId = decision.suggestedChatId;
        const suggestedChat = suggestedChatId
          ? chatsRef.current.find((chat) => chat.id === suggestedChatId)
          : null;
        showSessionAskToast({
          suggestedChat: suggestedChat
            ? { id: suggestedChat.id, title: suggestedChat.title_resolved }
            : suggestedChatId
              ? { id: suggestedChatId, title: null }
              : null,
          recentChats: chatsRef.current.map((chat) => ({
            id: chat.id,
            title: chat.title_resolved,
          })),
          onResume: (chatId) => navigateToChatRef.current(chatId),
          onPickRecent: (chatId) => navigateToChatRef.current(chatId),
          onNew: () => {
            void createNewChatRef.current();
          },
        });
        break;
      }
    }

    // First decision unblocks the messages fetch. The "ask" branch above
    // doesn't change `chatId`, so it never calls `setCurrentChatId` (which
    // is what flips lifecycle in the resume / new branches). Cover that
    // case here with a functional update — no-op once already decided.
    setLifecycle((previous) =>
      previous.kind === "pending"
        ? { kind: "decided", chatId: sessionRef.current.chatId }
        : previous,
    );
  }, [
    currentAnchor,
    isOutlook,
    sessionPreferences,
    setCurrentChatId,
    setSession,
  ]);

  const mountKey = useMemo(
    () => `new-chat-session-${newChatCounter}`,
    [newChatCounter],
  );

  const silentChatId = useFileUploadStore((state) => state.silentChatId);

  const {
    messages,
    isLoading: isMessagingLoading,
    isStreaming,
    isPendingResponse,
    isFinalizing,
    streamingContent,
    error: messagingError,
    sendMessage,
    editMessage,
    regenerateMessage,
    cancelMessage,
    refetch: refetchMessages,
    newlyCreatedChatId,
  } = useChatMessaging({
    chatId: effectiveChatId,
    silentChatId,
    platform: host?.toLowerCase() ?? "office-addin",
  });

  useEffect(() => {
    if (newlyCreatedChatId && !currentChatId && !isPendingResponse) {
      useMessagingStore.getState().setNavigationTransition(true);
      setCurrentChatId(newlyCreatedChatId, currentAnchor);
      setTimeout(() => {
        useMessagingStore.getState().setNavigationTransition(false);
      }, 100);
    }
  }, [
    currentAnchor,
    currentChatId,
    isPendingResponse,
    newlyCreatedChatId,
    setCurrentChatId,
  ]);

  useBudgetStatus();

  const {
    uploadFiles,
    isUploading,
    uploadedFiles,
    error: uploadError,
    clearFiles: clearUploadedFiles,
  } = useFileDropzone({
    acceptedFileTypes,
    multiple: true,
    chatId: effectiveChatId,
    onSilentChatCreated: () => {},
  });

  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError ?? messagingError;

  const contextValue = useMemo<ChatContextValue>(() => {
    const transformedMessages = Object.entries(messages || {}).reduce(
      (accumulator, [messageId, message]) => {
        const isStreamingMessage =
          message.role === "assistant" &&
          ((isStreaming && message.status === "sending") ||
            (!isStreaming &&
              message.status === "complete" &&
              message.id.includes("temp-")));

        if (isStreamingMessage) {
          const isOptimisticPlaceholder =
            !isStreaming &&
            message.status === "sending" &&
            message.id.startsWith("temp-assistant-");
          const loadingState = isOptimisticPlaceholder
            ? "thinking"
            : isStreaming
              ? "typing"
              : "done";

          accumulator[messageId] = {
            ...message,
            sender: message.role,
            authorId: "assistant_id",
            loading: { state: loadingState },
          };
        } else {
          accumulator[messageId] = mapMessageToUiMessage(message);
        }

        return accumulator;
      },
      {} as Record<string, AddinChatMessage>,
    );

    const messageOrder = Object.keys(transformedMessages).sort(
      (left, right) => {
        const leftDate = new Date(transformedMessages[left].createdAt);
        const rightDate = new Date(transformedMessages[right].createdAt);
        return leftDate.getTime() - rightDate.getTime();
      },
    );

    return {
      chats,
      currentChatId,
      isHistoryLoading,
      historyError,
      createNewChat,
      archiveChat,
      updateChatTitle: async () => {},
      navigateToChat,
      refetchHistory,
      messages: transformedMessages,
      messageOrder,
      isMessagingLoading,
      isStreaming,
      isPendingResponse,
      isFinalizing,
      streamingContent,
      messagingError,
      sendMessage,
      editMessage,
      regenerateMessage,
      cancelMessage,
      refetchMessages,
      uploadFiles,
      isUploading,
      uploadedFiles,
      uploadError,
      clearUploadedFiles,
      isLoading,
      error,
      silentChatId,
      newChatCounter,
      mountKey,
      currentChatLastModel,
    };
  }, [
    archiveChat,
    cancelMessage,
    chats,
    clearUploadedFiles,
    createNewChat,
    currentChatId,
    currentChatLastModel,
    editMessage,
    error,
    historyError,
    isFinalizing,
    isHistoryLoading,
    isLoading,
    isMessagingLoading,
    isPendingResponse,
    isStreaming,
    isUploading,
    messages,
    messagingError,
    mountKey,
    navigateToChat,
    newChatCounter,
    refetchHistory,
    refetchMessages,
    regenerateMessage,
    sendMessage,
    silentChatId,
    streamingContent,
    uploadError,
    uploadFiles,
    uploadedFiles,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
