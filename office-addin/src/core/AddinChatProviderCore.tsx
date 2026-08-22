import {
  ChatContext,
  getSupportedFileTypes,
  mapMessageToUiMessage,
  recentChatsQuery,
  removeArchivedChatFromLists,
  sanitizeChatHistoryFilters,
  seedGenerationStatusFromListing,
  useArchiveChatEndpoint,
  useAssistantsFeature,
  useBudgetStatus,
  useChatMessaging,
  useFileCapabilitiesContext,
  useFileDropzone,
  useFileUploadStore,
  useGenerationStatusStore,
  useInfiniteRecentChats,
  useMessagingStore,
  useModelHistory,
  usePersistedState,
  useUpdateChat,
  type ChatContextValue,
  type Message,
  type PersistedStateOptions,
  type RecentChatsListFilters,
} from "@erato/frontend/library";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AddinHistoryFilterStoreContext,
  getAddinChatHistoryFilterStore,
} from "./addinChatHistoryFilterStore";

import type { ComponentType, MutableRefObject, ReactNode } from "react";

interface AddinChatMessage extends Message {
  sender: string;
  authorId: string;
  previous_message_id?: string;
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
}

export interface AddinSessionController {
  currentChatId: string | null;
  effectiveChatId: string | null;
  newChatCounter: number;
  beginNewChat: () => void;
  selectChat: (chatId: string) => void;
  adoptNewChatId: (chatId: string) => void;
  clearNewlyCreatedChatIdRef: MutableRefObject<() => void>;
}

export interface AddinSessionControllerProps {
  chats: ChatContextValue["chats"];
  children: (session: AddinSessionController) => ReactNode;
}

type RecentChatsResult = ReturnType<typeof useInfiniteRecentChats>;

export function AddinChatProviderCore({
  children,
  platform,
  SessionController = NeutralAddinSessionController,
}: {
  children: ReactNode;
  /** Host identifier stamped on sends; never inferred from a host SDK. */
  platform: string;
  SessionController?: ComponentType<AddinSessionControllerProps>;
}) {
  const filterStore = getAddinChatHistoryFilterStore(platform);
  const { enabled: assistantsEnabled } = useAssistantsFeature();

  // Fold assistant-scoped filter values back to their defaults in the store
  // itself: the recent-chats query consumes the raw persisted values, so
  // sanitizing only at render would let a stale persisted value keep
  // filtering the request invisibly.
  useEffect(() => {
    if (assistantsEnabled) return;
    const state = filterStore.getState();
    const sanitized = sanitizeChatHistoryFilters(state, false);
    if (sanitized.typeFilter !== state.typeFilter) {
      state.setTypeFilter(sanitized.typeFilter);
    }
    if (sanitized.groupBy !== state.groupBy) {
      state.setGroupBy(sanitized.groupBy);
    }
  }, [assistantsEnabled, filterStore]);

  const typeFilter = filterStore((state) => state.typeFilter);
  const statusFilter = filterStore((state) => state.statusFilter);
  const filters = useMemo<RecentChatsListFilters>(
    () => ({ typeFilter, statusFilter }),
    [typeFilter, statusFilter],
  );
  const history = useInfiniteRecentChats({ filters });
  const chats = history.chats;

  return (
    <AddinHistoryFilterStoreContext.Provider value={filterStore}>
      <SessionController chats={chats}>
        {(session) => (
          <AddinChatDataProvider
            chats={chats}
            history={history}
            filters={filters}
            platform={platform}
            session={session}
          >
            {children}
          </AddinChatDataProvider>
        )}
      </SessionController>
    </AddinHistoryFilterStoreContext.Provider>
  );
}

export const NEUTRAL_CURRENT_CHAT_KEY = "erato.addin.neutral.currentChat.v1";
const neutralChatPersistedOptions: PersistedStateOptions<string | null> = {
  parse: (value) =>
    typeof value === "string" || value === null ? value : null,
};

/**
 * Neutral session adapter: isolated storage and no anchor/context policy. Each
 * host passes its own key so one host's selection never moves another's.
 */
export function createNeutralAddinSessionController(
  storageKey: string,
): ComponentType<AddinSessionControllerProps> {
  return function NeutralAddinSessionController({
    children,
  }: AddinSessionControllerProps) {
    const [currentChatId, setCurrentChatId] = usePersistedState<string | null>(
      storageKey,
      null,
      neutralChatPersistedOptions,
    );
    const [newChatCounter, setNewChatCounter] = useState(0);
    const clearNewlyCreatedChatIdRef = useRef<() => void>(() => {});

    const beginNewChat = useCallback(() => {
      setNewChatCounter((value) => value + 1);
      setCurrentChatId(null);
    }, [setCurrentChatId]);
    const selectChat = useCallback(
      (chatId: string) => setCurrentChatId(chatId),
      [setCurrentChatId],
    );

    return children({
      currentChatId,
      effectiveChatId: currentChatId,
      newChatCounter,
      beginNewChat,
      selectChat,
      adoptNewChatId: selectChat,
      clearNewlyCreatedChatIdRef,
    });
  };
}

export const NeutralAddinSessionController =
  createNeutralAddinSessionController(NEUTRAL_CURRENT_CHAT_KEY);

function AddinChatDataProvider({
  children,
  chats,
  history,
  filters,
  platform,
  session,
}: {
  children: ReactNode;
  chats: ChatContextValue["chats"];
  history: RecentChatsResult;
  filters: RecentChatsListFilters;
  platform: string;
  session: AddinSessionController;
}) {
  const { capabilities } = useFileCapabilitiesContext();
  const queryClient = useQueryClient();
  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );
  const {
    isLoading: isHistoryLoading,
    error: historyError,
    refetch: refetchHistory,
  } = history;
  const { mutateAsync: archiveChatMutation } = useArchiveChatEndpoint();
  const { currentChatLastModel } = useModelHistory({
    currentChatId: session.currentChatId,
    chats,
  });

  // Mirror the viewed chat into the generation-status store, as the web
  // ChatProvider does: opening a settled run consumes its terminal
  // notification, and the chat in view never carries an attention marker.
  useEffect(() => {
    useGenerationStatusStore.getState().setCurrentChatId(session.currentChatId);
  }, [session.currentChatId]);

  const resetMessagingForNewChat = useCallback(() => {
    useMessagingStore.getState().abortActiveSSE();
    useMessagingStore.getState().clearUserMessages();
    useMessagingStore.getState().resetStreaming();
    session.clearNewlyCreatedChatIdRef.current();
  }, [session.clearNewlyCreatedChatIdRef]);

  const createNewChat = useCallback(async () => {
    session.beginNewChat();
    resetMessagingForNewChat();
    return `temp-${Date.now()}`;
  }, [resetMessagingForNewChat, session]);
  const navigateToChat = useCallback(
    (chatId: string) => session.selectChat(chatId),
    [session],
  );
  const archiveChat = useCallback(
    async (chatId: string) => {
      // An archived chat has no row, so its status must not keep counting.
      useGenerationStatusStore.getState().clearStatus(chatId);
      if (filters.statusFilter === "all") {
        // The archived-inclusive result set does not shrink, which is what
        // makes refetch-driven offset skew impossible — plain invalidate.
        await archiveChatMutation({ pathParams: { chatId }, body: {} });
        void queryClient.invalidateQueries({
          queryKey: recentChatsQuery({}).queryKey,
        });
      } else {
        const rollback = await removeArchivedChatFromLists(queryClient, chatId);
        try {
          await archiveChatMutation({ pathParams: { chatId }, body: {} });
        } catch (error) {
          rollback();
          throw error;
        }
      }
      if (session.currentChatId === chatId) {
        session.beginNewChat();
        resetMessagingForNewChat();
      }
    },
    [
      archiveChatMutation,
      filters.statusFilter,
      queryClient,
      resetMessagingForNewChat,
      session,
    ],
  );

  const { mutateAsync: updateChatMutation } = useUpdateChat();
  const updateChatTitle = useCallback(
    async (chatId: string, titleByUserProvided?: string) => {
      const trimmedTitle = titleByUserProvided?.trim();
      await updateChatMutation({
        pathParams: { chatId },
        body: trimmedTitle
          ? { title_by_user_provided: trimmedTitle }
          : // Empty value removes the custom title on the backend.
            {},
      });
      await queryClient.invalidateQueries({
        queryKey: recentChatsQuery({}).queryKey,
      });
    },
    [queryClient, updateChatMutation],
  );

  // Seed the status store from the backend's running and pending-approval
  // markers, so generations started (or parked) elsewhere get an indicator
  // without waiting for a poll.
  useEffect(() => {
    seedGenerationStatusFromListing(chats);
  }, [chats]);

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
    clearNewlyCreatedChatId,
  } = useChatMessaging({
    chatId: session.effectiveChatId,
    silentChatId,
    platform,
  });
  session.clearNewlyCreatedChatIdRef.current = clearNewlyCreatedChatId;

  useEffect(() => {
    if (newlyCreatedChatId && !session.currentChatId && !isPendingResponse) {
      useMessagingStore.getState().setNavigationTransition(true);
      session.adoptNewChatId(newlyCreatedChatId);
      clearNewlyCreatedChatId();
      setTimeout(() => {
        useMessagingStore.getState().setNavigationTransition(false);
      }, 100);
    }
  }, [clearNewlyCreatedChatId, isPendingResponse, newlyCreatedChatId, session]);

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
    chatId: session.effectiveChatId,
    onSilentChatCreated: () => {},
  });

  const isLoading = isHistoryLoading || isMessagingLoading;
  const error = historyError ?? messagingError;
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = history;
  const fetchNextHistoryPage = useCallback(async () => {
    await fetchNextPage();
  }, [fetchNextPage]);
  const mountKey = useMemo(
    () => `new-chat-session-${session.newChatCounter}`,
    [session.newChatCounter],
  );

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
          accumulator[messageId] = {
            ...message,
            sender: message.role,
            authorId: "assistant_id",
            loading: {
              state: isOptimisticPlaceholder
                ? "thinking"
                : isStreaming
                  ? "typing"
                  : "done",
            },
          };
        } else {
          accumulator[messageId] = mapMessageToUiMessage(message);
        }
        return accumulator;
      },
      {} as Record<string, AddinChatMessage>,
    );
    const messageOrder = Object.keys(transformedMessages).sort(
      (left, right) =>
        new Date(transformedMessages[left].createdAt).getTime() -
        new Date(transformedMessages[right].createdAt).getTime(),
    );

    return {
      chats,
      pinnedChats: [],
      currentChatId: session.currentChatId,
      isHistoryLoading,
      historyError,
      createNewChat,
      archiveChat,
      updateChatTitle,
      pinChat: async () => {},
      navigateToChat,
      refetchHistory,
      fetchNextHistoryPage,
      hasNextHistoryPage: hasNextPage ?? false,
      isFetchingNextHistoryPage: isFetchingNextPage,
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
      newChatCounter: session.newChatCounter,
      mountKey,
      currentChatLastModel,
    };
  }, [
    archiveChat,
    cancelMessage,
    chats,
    clearUploadedFiles,
    createNewChat,
    currentChatLastModel,
    editMessage,
    error,
    fetchNextHistoryPage,
    hasNextPage,
    historyError,
    isFetchingNextPage,
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
    refetchHistory,
    refetchMessages,
    regenerateMessage,
    sendMessage,
    session.currentChatId,
    session.newChatCounter,
    silentChatId,
    streamingContent,
    updateChatTitle,
    uploadError,
    uploadFiles,
    uploadedFiles,
  ]);

  return (
    <ChatContext.Provider value={contextValue}>{children}</ChatContext.Provider>
  );
}
