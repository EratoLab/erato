import clsx from "clsx";
import { debounce } from "lodash";
import { memo, useCallback, useMemo, useEffect, useRef } from "react";

import { useMessageListVirtualization, useScrollEvents } from "@/hooks/ui";
import { usePaginatedData } from "@/hooks/ui/usePaginatedData";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";

import { MessageListHeader } from "./MessageListHeader";
import {
  useMessageClassNameHelper,
  useMessageAnimations,
} from "./MessageListUtils";
import { StandardMessageList } from "./StandardMessageList";
import { VirtualizedMessageList } from "./VirtualizedMessageList";
// import { ConversationIndicator } from "../Message/ConversationIndicator";

import type { ChatMessageProps } from "../Chat/ChatMessage";
import type {
  ChatMessagesResponse,
  UserProfile,
  FileUploadItem,
  MessageFeedback,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { ComponentType } from "react";
import type React from "react";

/**
 * Type for chat message with loading state
 */
export interface ChatMessage extends Message {
  sender: string;
  authorId: string;
  loading?: {
    state: "typing" | "thinking" | "done" | "error";
    context?: string;
  };
}

// Import the split components

export interface MessageListProps {
  /**
   * Array of all messages in the conversation
   */
  messages: Record<string, ChatMessage>;

  /**
   * Order of message IDs
   */
  messageOrder: string[];

  /**
   * Function to load more messages
   */
  loadOlderMessages: () => void;

  /**
   * Whether more messages are available
   */
  hasOlderMessages: boolean;

  /**
   * Whether messages are currently loading
   */
  isPending: boolean;

  /**
   * The current chat/session ID
   */
  currentSessionId: string | null;

  /**
   * API response data with stats (optional)
   */
  apiMessagesResponse?: ChatMessagesResponse;

  /**
   * Number of messages to load per page
   */
  pageSize?: number;

  /**
   * Maximum width of messages in pixels
   */
  maxWidth?: number;

  /**
   * Whether to show timestamps
   */
  showTimestamps?: boolean;

  /**
   * Whether to show avatars
   */
  showAvatars?: boolean;

  /**
   * User profile information
   */
  userProfile?: UserProfile;

  /**
   * Message controls component
   */
  controls?: MessageControlsComponent;

  /**
   * Custom message renderer component (replaces the default ChatMessage layout)
   */
  messageRenderer?: ComponentType<ChatMessageProps>;

  /**
   * Context for message controls
   */
  controlsContext: MessageControlsContext;

  /**
   * Handler for message actions
   */
  onMessageAction: (action: MessageAction) => Promise<boolean>;

  /**
   * Custom CSS class for the message list container
   */
  className?: string;

  /**
   * Whether to use virtualization for large lists
   */
  useVirtualization?: boolean;

  /**
   * Threshold for when to use virtualization (number of messages)
   */
  virtualizationThreshold?: number;

  /**
   * Callback to expose the scrollToBottom function
   */
  onScrollToBottomRef?: (scrollToBottom: () => void) => void;

  /**
   * Callback to open the file preview modal
   */
  onFilePreview?: (file: FileUploadItem) => void;

  /**
   * Assistant default files available in this chat context
   */
  assistantFiles?: FileUploadItem[];

  /**
   * Callback to view existing feedback
   */
  onViewFeedback?: (messageId: string, feedback: MessageFeedback) => void;

  /**
   * Whether the chat is currently transitioning between sessions
   */
  isTransitioning?: boolean;

  /**
   * Custom component to render when there are no messages
   */
  emptyStateComponent?: React.ReactNode;
}

// Separate hook for managing message loading and streaming behavior
function useMessageLoading({
  messageOrder,
  messages,
  scrollToBottom,
  isScrolledUp,
}: {
  messageOrder: string[];
  messages: Record<string, ChatMessage>;
  scrollToBottom: () => void;
  isScrolledUp: boolean;
}) {
  // Track the last loading state to avoid unwanted scroll when message completes
  const lastLoadingState = useRef<string | null>(null);
  // Track the last streaming content length to avoid unnecessary scrolls
  const lastContentLength = useRef<number>(0);
  // Track the current message ID to reset content length when message changes
  const lastMessageId = useRef<string | null>(null);

  // Force scroll to bottom when a message is actively streaming
  useEffect(() => {
    // Check if the last message is from the assistant and is still loading
    if (messageOrder.length > 0) {
      const currentLastMessageId = messageOrder[messageOrder.length - 1];
      const lastMessage = messages[currentLastMessageId];

      // Reset content length if this is a new message
      if (lastMessageId.current !== currentLastMessageId) {
        lastContentLength.current = 0;
        lastMessageId.current = currentLastMessageId;
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (lastMessage && lastMessage.sender === "assistant") {
        // Only scroll if message is loading or just completed (typing/thinking/done)
        if (
          lastMessage.loading &&
          (lastMessage.loading.state === "typing" ||
            lastMessage.loading.state === "thinking" ||
            lastMessage.loading.state === "done")
        ) {
          // Only scroll on significant content changes to improve performance
          // This reduces the number of scroll operations during rapid streaming
          const contentLength = lastMessage.content.length;
          if (contentLength - lastContentLength.current > 10) {
            // Only scroll after 10 new chars
            // Update last content length reference
            lastContentLength.current = contentLength;

            // Update last loading state reference
            lastLoadingState.current = lastMessage.loading.state;

            // Only scroll to bottom during active streaming if user hasn't scrolled up
            // This allows user to interrupt auto-scroll by scrolling up
            if (!isScrolledUp) {
              scrollToBottom();
            }
          }
        }
        // Don't scroll when message changes from loading to done
        // This prevents the unwanted "scroll up and down" at the end
      }
    }
  }, [messageOrder, messages, scrollToBottom, isScrolledUp]);
}

// Hook to manage loading more messages when near top
function useLoadMoreOnScroll({
  isNearTop: isNearTop,
  hasOlderMessages: hasOlderMessages,
  isPending: isPending,
  handleLoadMore: handleLoadMore,
}: {
  isNearTop: boolean;
  hasOlderMessages: boolean;
  isPending: boolean;
  handleLoadMore: () => void;
}) {
  // Update scroll position check when near the top
  useEffect(() => {
    if (isNearTop && hasOlderMessages && !isPending) {
      handleLoadMore();
    }
  }, [isNearTop, hasOlderMessages, isPending, handleLoadMore]);
}

/**
 * MessageList component for rendering chat messages with scroll behavior
 */
export const MessageList = memo<MessageListProps>(
  ({
    messages,
    messageOrder,
    loadOlderMessages,
    hasOlderMessages,
    isPending,
    currentSessionId,
    apiMessagesResponse,
    pageSize = 6,
    maxWidth = 768,
    showTimestamps = true,
    showAvatars = false,
    userProfile,
    controls,
    messageRenderer,
    controlsContext,
    onMessageAction,
    className,
    useVirtualization = false,
    virtualizationThreshold = 30,
    onScrollToBottomRef,
    onFilePreview,
    assistantFiles = [],
    onViewFeedback,
    isTransitioning,
    emptyStateComponent,
  }) => {
    // Debug logging for rendering
    // debugLog("RENDER", "MessageList rendering", {
    //   messageCount: messageOrder.length,
    //   hasLoadingMessage: messageOrder.some((id) => !!messages[id].loading),
    //   loadingMessageIds: messageOrder.filter((id) => !!messages[id].loading),
    // });

    const lastMessageLoadingContent = useMemo(() => {
      const result =
        messageOrder.length > 0 &&
        messages[messageOrder[messageOrder.length - 1]].loading
          ? messages[messageOrder[messageOrder.length - 1]].content
          : null;

      return result;
    }, [messageOrder, messages]);

    // Use our custom hooks for scroll behavior and pagination
    const {
      containerRef,
      isScrolledUp,
      isNearTop,
      checkScrollPosition,
      scrollToBottom,
    } = useScrollToBottom({
      enabled: true,
      useSmoothScroll: true,
      transitionDuration: 300,
      isTransitioning: isPending || isTransitioning,
      deps: [messageOrder.length, currentSessionId, lastMessageLoadingContent],
    });

    // Expose scrollToBottom function to parent component
    useEffect(() => {
      if (onScrollToBottomRef) {
        onScrollToBottomRef(scrollToBottom);
      }
    }, [onScrollToBottomRef, scrollToBottom]);

    // Use the message loading hook
    useMessageLoading({ messageOrder, messages, scrollToBottom, isScrolledUp });

    // Set up pagination for message data
    const { visibleData, hasMore, loadMore, isNewlyLoaded, paginationStats } =
      usePaginatedData({
        data: messageOrder,
        initialCount: pageSize,
        pageSize: pageSize,
        enabled: hasOlderMessages,
        direction: "backward", // Use backward pagination for chat (older messages first)
      });

    // Add a message when user scrolls back down to new messages
    useEffect(() => {
      // Don't show any notification while loading or if no messages
      if (isPending || messageOrder.length === 0) return;

      // User was scrolled up but now scrolled back down, check if there are new messages
      if (isScrolledUp === false && visibleData.length < messageOrder.length) {
        // This is where you'd show a "new messages" indicator if desired
      }
    }, [isScrolledUp, isPending, messageOrder.length, visibleData.length]);

    // Create debounced function with useMemo
    const debouncedLoadMore = useMemo(
      () =>
        debounce(() => {
          if (isPending) {
            return;
          }

          // For chat history (backward pagination), we only need to load from the API
          // Our hook is already configured to show all messages
          if (apiMessagesResponse?.stats.has_more || hasOlderMessages) {
            loadOlderMessages();
          }
          // Only use the client-side pagination if we're not loading from API
          else if (hasMore) {
            loadMore();
          }
        }, 300),
      [
        apiMessagesResponse?.stats.has_more,
        hasOlderMessages,
        hasMore,
        isPending,
        loadOlderMessages,
        loadMore,
      ],
    );

    // Use the memoized debounced function
    const handleLoadMore = useCallback(() => {
      debouncedLoadMore();
    }, [debouncedLoadMore]);

    // Make sure to clean up the debounced function
    useEffect(() => {
      return () => {
        debouncedLoadMore.cancel();
      };
    }, [debouncedLoadMore]);

    // Calculate if we should use virtualization based on message count
    const shouldUseVirtualization =
      useVirtualization && messageOrder.length >= virtualizationThreshold;

    // Use our virtualization hook
    const { containerSize } = useMessageListVirtualization({
      containerRef,
      shouldUseVirtualization,
    });

    // Helper function to get CSS classes for message highlighting
    const getMessageClassName = useMessageClassNameHelper();

    // Inject message animations
    useMessageAnimations();

    // Use our hook for scroll events
    useScrollEvents({
      containerRef,
      onScroll: checkScrollPosition,
      deps: [apiMessagesResponse],
    });

    // Use our hook to load more messages when scrolling to top
    useLoadMoreOnScroll({
      isNearTop,
      hasOlderMessages,
      isPending,
      handleLoadMore,
    });

    // Collect all file download URLs from message files and assistant default files
    // for erato-file:// link resolution.
    const allFileDownloadUrls = useMemo(() => {
      const urlMap: Record<string, string> = {};

      // Assistant files are available even before they appear in message payloads.
      assistantFiles.forEach((file) => {
        urlMap[file.id] = file.download_url;
      });

      // Message files override assistant URLs, preserving freshest data from chat API.
      messageOrder.forEach((messageId) => {
        const message = messages[messageId] as UiChatMessage;
        (message.files ?? []).forEach((file) => {
          urlMap[file.id] = file.download_url;
        });
      });
      return urlMap;
    }, [assistantFiles, messageOrder, messages]);

    // Check if there are no messages to display
    const showEmptyState = messageOrder.length === 0 && !isPending;

    // Return the header component with load more button if needed
    const renderMessageListHeader = useMemo(() => {
      // Should show load more button if we have more messages and we're not already loading
      const showLoadMoreButton =
        (apiMessagesResponse?.stats.has_more ?? hasOlderMessages) &&
        !isPending &&
        messageOrder.length > 0;

      // Show beginning indicator when we've loaded all messages
      const showBeginningIndicator =
        !apiMessagesResponse?.stats.has_more &&
        !hasOlderMessages &&
        messageOrder.length > 0;

      return (
        <MessageListHeader
          showLoadMoreButton={showLoadMoreButton}
          handleLoadMore={handleLoadMore}
          isPending={isPending}
          showBeginningIndicator={showBeginningIndicator}
          paginationStats={paginationStats}
        />
      );
    }, [
      apiMessagesResponse?.stats.has_more,
      hasOlderMessages,
      isPending,
      messageOrder.length,
      handleLoadMore,
      paginationStats,
    ]);

    // Add optimized container class based on state
    const containerClass = useMemo(() => {
      return clsx(
        "flex-1 overflow-y-auto bg-theme-bg-secondary px-2 sm:px-4",
        "space-y-4 p-4",
        className,
        // Apply transition properties without changing opacity
        // This creates a smoother experience when content changes
        // eslint-disable-next-line lingui/no-unlocalized-strings
        "transition-[opacity,transform] duration-300 ease-in-out",
        // Only change opacity when explicitly transitioning (not during normal message updates)
        isTransitioning ? "opacity-0" : "opacity-100",
      );
    }, [className, isTransitioning]);

    const handleCopyPlainText = useCallback(
      (event: React.ClipboardEvent<HTMLDivElement>) => {
        const selection = window.getSelection();
        const selectedText = selection?.toString();

        if (!selectedText) {
          return;
        }

        const selectedRange =
          selection && selection.rangeCount > 0
            ? selection.getRangeAt(0)
            : null;
        const selectedFragment = selectedRange?.cloneContents();
        const htmlContainer = document.createElement("div");

        if (selectedFragment) {
          htmlContainer.appendChild(selectedFragment);

          // Preserve semantic markup (bold/lists/etc) but strip theme color styling.
          htmlContainer.querySelectorAll("*").forEach((element) => {
            if (element instanceof HTMLElement) {
              element.style.removeProperty("color");
              element.style.removeProperty("background-color");
              element.style.removeProperty("caret-color");
              element.style.removeProperty("text-decoration-color");
              element.style.removeProperty("fill");
              element.style.removeProperty("stroke");

              if (!element.getAttribute("style")?.trim()) {
                element.removeAttribute("style");
              }
            }

            element.removeAttribute("color");
            element.removeAttribute("bgcolor");
            element.removeAttribute("fill");
            element.removeAttribute("stroke");
          });
        }

        event.preventDefault();
        event.clipboardData.clearData();
        event.clipboardData.setData("text/plain", selectedText);
        const sanitizedHtml = htmlContainer.innerHTML.trim();
        if (sanitizedHtml) {
          // eslint-disable-next-line lingui/no-unlocalized-strings -- MIME type constant
          event.clipboardData.setData("text/html", sanitizedHtml);
        }
      },
      [],
    );

    return (
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={containerClass}
        data-testid="message-list"
        onCopy={handleCopyPlainText}
      >
        {renderMessageListHeader}
        <div className={clsx("mx-auto w-full max-w-4xl")}>
          {showEmptyState && emptyStateComponent ? (
            <div className="flex h-full min-h-[300px] items-center justify-center">
              {emptyStateComponent}
            </div>
          ) : shouldUseVirtualization ? (
            <VirtualizedMessageList
              messages={messages}
              visibleData={visibleData}
              containerSize={containerSize}
              isNewlyLoaded={isNewlyLoaded}
              getMessageClassName={getMessageClassName}
              maxWidth={maxWidth}
              showTimestamps={showTimestamps}
              showAvatars={showAvatars}
              userProfile={userProfile}
              controls={controls}
              messageRenderer={messageRenderer}
              controlsContext={controlsContext}
              onMessageAction={onMessageAction}
              onFilePreview={onFilePreview}
              onViewFeedback={onViewFeedback}
              allFileDownloadUrls={allFileDownloadUrls}
            />
          ) : (
            <StandardMessageList
              messages={messages}
              visibleData={visibleData}
              isNewlyLoaded={isNewlyLoaded}
              getMessageClassName={getMessageClassName}
              maxWidth={maxWidth}
              showTimestamps={showTimestamps}
              showAvatars={showAvatars}
              userProfile={userProfile}
              controls={controls}
              messageRenderer={messageRenderer}
              controlsContext={controlsContext}
              onMessageAction={onMessageAction}
              onFilePreview={onFilePreview}
              onViewFeedback={onViewFeedback}
              allFileDownloadUrls={allFileDownloadUrls}
            />
          )}
        </div>
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
MessageList.displayName = "MessageList";
