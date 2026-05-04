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
import { showSessionAskToast } from "../components/sessionAskToast";
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

  const setCurrentChatId = useCallback(
    (chatId: string | null, anchor?: OutlookSessionAnchor | null) => {
      setSession((previous) => ({
        chatId,
        anchor: anchor === undefined ? previous.anchor : anchor,
      }));
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
          onResume: (chatId) => setCurrentChatId(chatId, currentAnchor),
          onPickRecent: (chatId) => setCurrentChatId(chatId, currentAnchor),
          onNew: () => {
            setNewChatCounter((previous) => previous + 1);
            setCurrentChatId(null, currentAnchor);
            useMessagingStore.getState().abortActiveSSE();
            useMessagingStore.getState().clearUserMessages();
            useMessagingStore.getState().resetStreaming();
          },
        });
        break;
      }
    }
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
    chatId: currentChatId,
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
    chatId: currentChatId,
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
