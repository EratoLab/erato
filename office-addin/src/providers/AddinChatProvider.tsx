import {
  ChatContext,
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
  useRecentChats,
  mapMessageToUiMessage,
  type Message,
  type ChatContextValue,
} from "@erato/frontend/library";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

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

export function AddinChatProvider({ children }: { children: ReactNode }) {
  const { capabilities } = useFileCapabilitiesContext();
  const queryClient = useQueryClient();

  const acceptedFileTypes = useMemo(
    () => getSupportedFileTypes(capabilities),
    [capabilities],
  );

  const chatIdStorageKey = "erato-office-addin-current-chat-id";
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(() =>
    localStorage.getItem(chatIdStorageKey),
  );
  const [newChatCounter, setNewChatCounter] = useState(0);

  const setCurrentChatId = useCallback((chatId: string | null) => {
    setCurrentChatIdState(chatId);

    if (chatId) {
      localStorage.setItem(chatIdStorageKey, chatId);
    } else {
      localStorage.removeItem(chatIdStorageKey);
    }
  }, []);

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
    setCurrentChatId(null);

    useMessagingStore.getState().abortActiveSSE();
    useMessagingStore.getState().clearUserMessages();
    useMessagingStore.getState().resetStreaming();

    return `temp-${Date.now()}`;
  }, [setCurrentChatId]);

  const navigateToChat = useCallback(
    (chatId: string) => {
      setCurrentChatId(chatId);
    },
    [setCurrentChatId],
  );

  const archiveChat = useCallback(
    async (chatId: string) => {
      await archiveChatMutation({ pathParams: { chatId }, body: {} });
      await queryClient.invalidateQueries({
        queryKey: recentChatsQuery({}).queryKey,
      });

      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setNewChatCounter((previous) => previous + 1);
      }
    },
    [archiveChatMutation, currentChatId, queryClient, setCurrentChatId],
  );

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
  });

  useEffect(() => {
    if (newlyCreatedChatId && !currentChatId && !isPendingResponse) {
      useMessagingStore.getState().setNavigationTransition(true);
      setCurrentChatId(newlyCreatedChatId);
      setTimeout(() => {
        useMessagingStore.getState().setNavigationTransition(false);
      }, 100);
    }
  }, [currentChatId, isPendingResponse, newlyCreatedChatId, setCurrentChatId]);

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
