import {
  ChatContext,
  getSupportedFileTypes,
  mapMessageToUiMessage,
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
  type ChatContextValue,
  type Message,
  type PersistedStateOptions,
} from "@erato/frontend/library";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

type RecentChatsResult = ReturnType<typeof useRecentChats>;

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
  const history = useRecentChats({});
  const chats = useMemo(() => history.data?.chats ?? [], [history.data]);

  return (
    <SessionController chats={chats}>
      {(session) => (
        <AddinChatDataProvider
          chats={chats}
          history={history}
          platform={platform}
          session={session}
        >
          {children}
        </AddinChatDataProvider>
      )}
    </SessionController>
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
  platform,
  session,
}: {
  children: ReactNode;
  chats: ChatContextValue["chats"];
  history: RecentChatsResult;
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
      await archiveChatMutation({ pathParams: { chatId }, body: {} });
      await queryClient.invalidateQueries({
        queryKey: recentChatsQuery({}).queryKey,
      });
      if (session.currentChatId === chatId) {
        session.beginNewChat();
        resetMessagingForNewChat();
      }
    },
    [archiveChatMutation, queryClient, resetMessagingForNewChat, session],
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
  const fetchNextHistoryPage = useCallback(async () => {}, []);
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
      updateChatTitle: async () => {},
      pinChat: async () => {},
      navigateToChat,
      refetchHistory,
      fetchNextHistoryPage,
      hasNextHistoryPage: false,
      isFetchingNextHistoryPage: false,
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
    refetchHistory,
    refetchMessages,
    regenerateMessage,
    sendMessage,
    session.currentChatId,
    session.newChatCounter,
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
