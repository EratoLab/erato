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
import { ConversationIndicator } from "../Message/ConversationIndicator";

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
    const { containerRef, isScrolledUp, checkScrollPosition } =
      useScrollToBottom({
        enabled: true,
        deps: [messageOrder.length, currentSessionId],
      });

    // Set up pagination for message data
    const { visibleData, hasMore, loadMore, isNewlyLoaded, paginationStats } =
      usePaginatedData({
        data: messageOrder,
        initialCount: pageSize,
        pageSize: pageSize,
        enabled: hasOlderMessages,
        direction: "backward", // Use backward pagination for chat (older messages first)
      });

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
      // Get API pagination status
      const hasMoreMessagesFromApi =
        apiMessagesResponse?.stats.has_more ?? false;

      // Show load more button in two cases:
      // 1. API indicates more messages are available - show regardless of scroll position
      if (hasMoreMessagesFromApi) {
        return true;
      }

      // 2. There are locally cached messages (hasOlderMessages or hasMore) AND user is scrolled up
      const hasMoreLocalMessages = hasOlderMessages || hasMore;
      return hasMoreLocalMessages && isScrolledUp;
    }, [apiMessagesResponse, hasOlderMessages, hasMore, isScrolledUp]);

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

        {/* Message List - virtualized or standard based on settings and message count */}
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
        <ConversationIndicator type="end" />
      </div>
    );
  },
);

MessageList.displayName = "MessageList";
