import {
  ChatContext,
  getSupportedFileTypes,
  mapMessageToUiMessage,
  recentChatsQuery,
  removeArchivedChatFromLists,
  seedGenerationStatusFromListing,
  useArchiveChatEndpoint,
  useAssistantsFeature,
  useBudgetStatus,
  useChatHistoryFilterFoldback,
  useChatMessaging,
  useFileCapabilitiesContext,
  useFileDropzone,
  useFileUploadStore,
  useGenerationStatusStore,
  useInfiniteRecentChats,
  useMessagingStore,
  useModelHistory,
  usePersistedState,
  useUpdateChatTitle,
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

// The server-default listing shape (every type, archived and delegated runs
// excluded).
const SESSION_LISTING_FILTERS: RecentChatsListFilters = {
  typeFilter: "all",
  statusFilter: "active",
  delegatedFilter: "hidden",
};

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
  const { enabled: assistantsEnabled, delegationEnabled } =
    useAssistantsFeature();
  useChatHistoryFilterFoldback(
    { assistantsEnabled, delegationEnabled },
    filterStore,
  );

  const typeFilter = filterStore((state) => state.typeFilter);
  const statusFilter = filterStore((state) => state.statusFilter);
  const delegatedFilter = filterStore((state) => state.delegatedFilter);
  const filters = useMemo<RecentChatsListFilters>(
    () => ({ typeFilter, statusFilter, delegatedFilter }),
    [typeFilter, statusFilter, delegatedFilter],
  );
  const history = useInfiniteRecentChats({ filters });
  const chats = history.chats;

  // Outlook's session policy suggests and lists chats for its ask toast
  // through this unfiltered listing, never the drawer-filtered one: narrowing
  // a drawer filter must not silently change which chat the toast offers to
  // resume. Only Outlook's session controller consumes these chats — every
  // other platform reuses the drawer's filters so both hooks share one query
  // key and this second listing never runs its own request chain.
  const sessionFilters =
    platform === "outlook" ? SESSION_LISTING_FILTERS : filters;
  const sessionHistory = useInfiniteRecentChats({
    filters: sessionFilters,
  });

  return (
    <AddinHistoryFilterStoreContext.Provider value={filterStore}>
      <SessionController chats={sessionHistory.chats}>
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
      // An archived chat has no row, so its status must not keep counting.
      // Cleared only once the mutation succeeded: there is no restore API,
      // so clearing earlier would drop the marker of a chat whose row a
      // failed archive puts back.
      useGenerationStatusStore.getState().clearStatus(chatId);
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

  const updateChatTitle = useUpdateChatTitle();

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
