import clsx from "clsx";
import { debounce } from "lodash";
import React, { memo, useCallback, useMemo, useState, useEffect } from "react";

import { usePaginatedData } from "@/hooks/usePaginatedData";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";

import { MessageListHeader } from "./MessageListHeader";
import {
  useMessageClassNameHelper,
  useMessageAnimations,
} from "./MessageListUtils";
import { StandardMessageList } from "./StandardMessageList";
import { VirtualizedMessageList } from "./VirtualizedMessageList";
// import { ConversationIndicator } from "../Message/ConversationIndicator";

import type { ChatMessagesResponse } from "../../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatMessage as ChatMessageType } from "../../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

// Import the split components

export interface MessageListProps {
  /**
   * Array of all messages in the conversation
   */
  messages: Record<string, ChatMessageType>;

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
  isLoading: boolean;

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
  onMessageAction: (action: MessageAction) => Promise<void>;

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
    isLoading,
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
  }) => {
    // Measure container dimensions for virtualization
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

    // Use our custom hooks for scroll behavior and pagination
    const {
      containerRef,
      isScrolledUp,
      isNearTop,
      checkScrollPosition,
      scrollToBottom,
    } = useScrollToBottom({
      enabled: true,
      deps: [
        messageOrder.length,
        currentSessionId,
        // Add dependencies to detect content changes in the last message
        // This ensures scrolling works during streaming
        messageOrder.length > 0
          ? messages[messageOrder[messageOrder.length - 1]].content
          : "",
        messageOrder.length > 0
          ? messages[messageOrder[messageOrder.length - 1]].loading
          : null,
      ],
    });

    // Force scroll to bottom when a message is actively streaming
    useEffect(() => {
      // Check if the last message is from the assistant and is still loading
      if (messageOrder.length > 0) {
        const lastMessageId = messageOrder[messageOrder.length - 1];
        const lastMessage = messages[lastMessageId];

        if (
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          lastMessage &&
          lastMessage.sender === "assistant" &&
          !!lastMessage.loading
        ) {
          // Message is streaming, so scroll to bottom
          scrollToBottom();
        }
      }
    }, [messageOrder, messages, scrollToBottom]);

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
      if (isLoading || messageOrder.length === 0) return;

      // User was scrolled up but now scrolled back down, check if there are new messages
      if (isScrolledUp === false && visibleData.length < messageOrder.length) {
        // This is where you'd show a "new messages" indicator if desired
        console.log("User scrolled back to see new messages");
      }
    }, [isScrolledUp, isLoading, messageOrder.length, visibleData.length]);

    // Create debounced function with useMemo
    const debouncedLoadMore = useMemo(
      () =>
        debounce(() => {
          if (isLoading) {
            console.log("Skipping load more because already loading");
            return;
          }

          console.log("Load more triggered in MessageList");

          // For chat history (backward pagination), we only need to load from the API
          // Our hook is already configured to show all messages
          if (apiMessagesResponse?.stats.has_more || hasOlderMessages) {
            console.log("Loading older messages from API");
            loadOlderMessages();
          }
          // Only use the client-side pagination if we're not loading from API
          else if (hasMore) {
            console.log("Loading more messages from client-side pagination");
            loadMore();
          } else {
            console.log("No more messages to load");
          }
        }, 300),
      [
        apiMessagesResponse?.stats.has_more,
        hasOlderMessages,
        hasMore,
        isLoading,
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

    // Memoize derived values
    const showLoadMoreButton = useMemo(() => {
      // Show load more button only when the user is near the top of the message list
      if (!isNearTop) return false;

      // Get API pagination status
      const hasMoreMessagesFromApi =
        apiMessagesResponse?.stats.has_more ?? false;

      // Only show load more when user is near the top AND there are more messages
      const hasMoreLocalMessages = hasOlderMessages || hasMore;

      // Show button only when there are more messages (API or client-side)
      return hasMoreMessagesFromApi || hasMoreLocalMessages;
    }, [apiMessagesResponse, hasOlderMessages, hasMore, isNearTop]);

    const showBeginningIndicator = useMemo(() => {
      // Only show the beginning indicator if:
      // 1. API indicates no more messages are available
      // 2. There are no more messages in client-side pagination
      // 3. There are no more messages to load from the API
      // 4. We have at least one message to display
      const hasNoMoreMessagesFromApi =
        apiMessagesResponse?.stats.has_more === false;
      return (
        !hasMore &&
        !hasOlderMessages &&
        hasNoMoreMessagesFromApi &&
        messageOrder.length > 0
      );
    }, [apiMessagesResponse, hasMore, hasOlderMessages, messageOrder.length]);

    const shouldUseVirtualization = useMemo(
      () => useVirtualization && visibleData.length > virtualizationThreshold,
      [useVirtualization, visibleData.length, virtualizationThreshold],
    );

    // Helper function to get CSS classes for message highlighting
    const getMessageClassName = useMessageClassNameHelper();

    // Inject message animations
    useMessageAnimations();

    // Update container dimensions for virtualization
    useEffect(() => {
      if (!containerRef.current || !useVirtualization) return;

      const updateSize = () => {
        const { offsetWidth, offsetHeight } =
          containerRef.current as HTMLDivElement;
        setContainerSize({
          width: offsetWidth || window.innerWidth,
          height: offsetHeight || window.innerHeight,
        });
      };

      // Initial size measurement
      updateSize();

      // Update on resize
      const resizeObserver = new ResizeObserver(debounce(updateSize, 100));
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }, [containerRef, useVirtualization]);

    // Update scroll position check after rendering
    useEffect(() => {
      if (containerRef.current) {
        checkScrollPosition();
      }
    }, [visibleData.length, checkScrollPosition, containerRef]);

    // Force check when we receive new messages from API
    useEffect(() => {
      if (containerRef.current && apiMessagesResponse) {
        // Short delay to ensure DOM is updated
        setTimeout(() => checkScrollPosition(), 100);
      }
    }, [apiMessagesResponse, checkScrollPosition, containerRef]);

    return (
      <div
        ref={containerRef as React.RefObject<HTMLDivElement>}
        className={clsx(
          "flex-1 overflow-y-auto bg-theme-bg-secondary px-2 sm:px-4",
          "space-y-4 p-4",
          className,
        )}
        data-testid="message-list"
      >
        {/* Header components: load more button, beginning indicator, debug info */}
        <MessageListHeader
          showLoadMoreButton={showLoadMoreButton}
          handleLoadMore={handleLoadMore}
          isLoading={isLoading}
          showBeginningIndicator={showBeginningIndicator}
          apiMessagesResponse={apiMessagesResponse}
          paginationStats={paginationStats}
        />
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
            />
          )}

          {/* End of conversation indicator */}
          {/* <ConversationIndicator type="end" /> */}
        </div>

        {/* Message List - virtualized or standard based on settings and message count */}
      </div>
    );
  },
);

MessageList.displayName = "MessageList";
