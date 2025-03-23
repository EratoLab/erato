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
      if (isPending || messageOrder.length === 0) return;

      // User was scrolled up but now scrolled back down, check if there are new messages
      if (isScrolledUp === false && visibleData.length < messageOrder.length) {
        // This is where you'd show a "new messages" indicator if desired
        console.log("User scrolled back to see new messages");
      }
    }, [isScrolledUp, isPending, messageOrder.length, visibleData.length]);

    // Create debounced function with useMemo
    const debouncedLoadMore = useMemo(
      () =>
        debounce(() => {
          if (isPending) {
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

    // Helper function to get CSS classes for message highlighting
    const getMessageClassName = useMessageClassNameHelper();

    // Inject message animations
    useMessageAnimations();

    // Update container size for virtualization
    useEffect(() => {
      if (!containerRef.current || !shouldUseVirtualization) return;

      const resizeObserver = new ResizeObserver((entries) => {
        const { width, height } = entries[0].contentRect;
        setContainerSize({ width, height });
      });

      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }, [containerRef, shouldUseVirtualization]);

    // Update scroll position check when near the top
    useEffect(() => {
      if (isNearTop && hasOlderMessages && !isPending) {
        console.log("Near top, loading more messages");
        handleLoadMore();
      }
    }, [isNearTop, hasOlderMessages, isPending, handleLoadMore]);

    // Update container size on resize for virtualization
    useEffect(() => {
      if (!shouldUseVirtualization) return;

      const updateSize = () => {
        if (containerRef.current) {
          const { clientWidth, clientHeight } = containerRef.current;
          setContainerSize({
            width: clientWidth,
            height: clientHeight,
          });
        }
      };

      updateSize();
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }, [containerRef, shouldUseVirtualization]);

    // Register scroll handler to update position markers
    useEffect(() => {
      if (!containerRef.current) return;

      // Check scroll position on scroll events
      containerRef.current.addEventListener("scroll", checkScrollPosition);
      return () => {
        if (containerRef.current) {
          containerRef.current.removeEventListener(
            "scroll",
            checkScrollPosition,
          );
        }
      };
    }, [apiMessagesResponse, checkScrollPosition, containerRef]);

    // Return the header component with load more button if needed
    const renderMessageListHeader = useMemo(() => {
      // Should show load more button if we have more messages and we're not already loading
      const showLoadMoreButton =
        (apiMessagesResponse?.stats.has_more || hasOlderMessages) &&
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
