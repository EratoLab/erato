import clsx from "clsx";
import { debounce } from "lodash";
import React, { memo, useCallback, useMemo, useEffect, useRef } from "react";

import { useMessageListVirtualization, useScrollEvents } from "@/hooks/ui";
import { usePaginatedData } from "@/hooks/ui/usePaginatedData";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";
import { createLogger, debugLog } from "@/utils/debugLogger";

import { MessageListHeader } from "./MessageListHeader";
import {
  useMessageClassNameHelper,
  useMessageAnimations,
} from "./MessageListUtils";
import { StandardMessageList } from "./StandardMessageList";
import { VirtualizedMessageList } from "./VirtualizedMessageList";
// import { ConversationIndicator } from "../Message/ConversationIndicator";

import type {
  ChatMessagesResponse,
  UserProfile,
  FileUploadItem,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

// Create logger for this component
const logger = createLogger("UI", "MessageList");

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
   * Whether the chat is currently transitioning between sessions
   */
  isTransitioning?: boolean;
}

// Separate hook for managing message loading and streaming behavior
function useMessageLoading({
  messageOrder,
  messages,
  scrollToBottom,
}: {
  messageOrder: string[];
  messages: Record<string, ChatMessage>;
  scrollToBottom: () => void;
}) {
  // Track the last loading state to avoid unwanted scroll when message completes
  const lastLoadingState = useRef<string | null>(null);
  // Track the last streaming content length to avoid unnecessary scrolls
  const lastContentLength = useRef<number>(0);

  // Force scroll to bottom when a message is actively streaming
  useEffect(() => {
    // Check if the last message is from the assistant and is still loading
    if (messageOrder.length > 0) {
      const lastMessageId = messageOrder[messageOrder.length - 1];
      const lastMessage = messages[lastMessageId];

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (lastMessage && lastMessage.sender === "assistant") {
        // Only scroll if message is currently loading (typing/thinking)
        if (
          lastMessage.loading &&
          (lastMessage.loading.state === "typing" ||
            lastMessage.loading.state === "thinking")
        ) {
          // Only scroll on significant content changes to improve performance
          // This reduces the number of scroll operations during rapid streaming
          const contentLength = lastMessage.content.length;
          if (contentLength - lastContentLength.current > 10) {
            // Only scroll after 10 new chars
            // Message is streaming, so scroll to bottom
            debugLog(
              "RENDER",
              `Message ${lastMessageId} is streaming, scrolling to bottom`,
              {
                loadingState: lastMessage.loading.state,
                contentLength: lastMessage.content.length,
              },
            );

            // Update last content length reference
            lastContentLength.current = contentLength;

            // Update last loading state reference
            lastLoadingState.current = lastMessage.loading.state;

            // Scroll to bottom during active streaming
            scrollToBottom();
          }
        }
        // Don't scroll when message changes from loading to done
        // This prevents the unwanted "scroll up and down" at the end
      }
    }
  }, [messageOrder, messages, scrollToBottom]);
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
      logger.log("Near top, loading more messages");
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
    controlsContext,
    onMessageAction,
    className,
    useVirtualization = false,
    virtualizationThreshold = 30,
    onScrollToBottomRef,
    onFilePreview,
    isTransitioning,
  }) => {
    // Debug logging for rendering
    // debugLog("RENDER", "MessageList rendering", {
    //   messageCount: messageOrder.length,
    //   hasLoadingMessage: messageOrder.some((id) => !!messages[id].loading),
    //   loadingMessageIds: messageOrder.filter((id) => !!messages[id].loading),
    // });

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
      deps: [
        messageOrder.length,
        currentSessionId,
        // Only include loading state for active streaming, not for completion
        // This ensures we don't trigger an unwanted scroll when loading completes
        messageOrder.length > 0 &&
        messages[messageOrder[messageOrder.length - 1]].loading &&
        messages[messageOrder[messageOrder.length - 1]].loading?.state !==
          "done"
          ? messages[messageOrder[messageOrder.length - 1]].content
          : null,
      ],
    });

    // Expose scrollToBottom function to parent component
    useEffect(() => {
      if (onScrollToBottomRef) {
        onScrollToBottomRef(scrollToBottom);
      }
    }, [onScrollToBottomRef, scrollToBottom]);

    // Use the message loading hook
    useMessageLoading({ messageOrder, messages, scrollToBottom });

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
        logger.log("User scrolled back to see new messages");
      }
    }, [isScrolledUp, isPending, messageOrder.length, visibleData.length]);

    // Create debounced function with useMemo
    const debouncedLoadMore = useMemo(
      () =>
        debounce(() => {
          if (isPending) {
            logger.log("Skipping load more because already loading");
            return;
          }

          logger.log("Load more triggered in MessageList");

          // For chat history (backward pagination), we only need to load from the API
          // Our hook is already configured to show all messages
          if (apiMessagesResponse?.stats.has_more || hasOlderMessages) {
            logger.log("Loading older messages from API");
            loadOlderMessages();
          }
          // Only use the client-side pagination if we're not loading from API
          else if (hasMore) {
            logger.log("Loading more messages from client-side pagination");
            loadMore();
          } else {
            logger.log("No more messages to load");
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
        "transition-[opacity,transform] duration-300 ease-in-out",
        // Only change opacity when explicitly transitioning (not during normal message updates)
        isTransitioning ? "opacity-0" : "opacity-100",
      );
    }, [className, isTransitioning]);

    return (
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={containerClass}
        data-testid="message-list"
      >
        {renderMessageListHeader}
        <div className={clsx("mx-auto w-full sm:w-5/6 md:w-4/5")}>
          {shouldUseVirtualization ? (
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
              controlsContext={controlsContext}
              onMessageAction={onMessageAction}
              onFilePreview={onFilePreview}
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
              controlsContext={controlsContext}
              onMessageAction={onMessageAction}
              onFilePreview={onFilePreview}
            />
          )}
        </div>
      </div>
    );
  },
);

MessageList.displayName = "MessageList";
