import clsx from "clsx";
import { debounce } from "lodash";
import React, {
  memo,
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
} from "react";
import { VariableSizeList as VirtualList } from "react-window";

import { usePaginatedData } from "@/hooks/usePaginatedData";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";

import { ChatMessage } from "./ChatMessage";
import { ConversationIndicator } from "./ConversationIndicator";
import { LoadMoreButton } from "./LoadMoreButton";

import type { ChatMessagesResponse } from "../../lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatMessage as ChatMessageType } from "../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";
import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "@/types/message-controls";

// Memoized message item component with custom comparison
const MessageItem = memo<{
  messageId: string;
  message: ChatMessageType;
  isNew: boolean;
  style?: React.CSSProperties;
  maxWidth?: number;
  showTimestamp?: boolean;
  showAvatar?: boolean;
  userProfile?: UserProfile;
  controls?: MessageControlsComponent;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<void>;
  className?: string;
}>(
  ({
    messageId,
    message,
    // Used in parent component via getMessageClassName
    isNew: _isNew,
    style,
    maxWidth,
    showTimestamp,
    showAvatar,
    userProfile,
    controls: Controls,
    controlsContext,
    onMessageAction,
    className,
  }) => (
    <div style={style} className={className}>
      <ChatMessage
        key={messageId}
        message={message}
        showTimestamp={showTimestamp}
        showAvatar={showAvatar}
        maxWidth={maxWidth}
        userProfile={userProfile}
        controls={Controls}
        controlsContext={controlsContext}
        onMessageAction={onMessageAction}
      />
    </div>
  ),
  // Custom comparison function to optimize rendering
  (prevProps, nextProps) => {
    // Always re-render if message ID changes
    if (prevProps.messageId !== nextProps.messageId) return false;

    // Always re-render if isNew status changes
    if (prevProps.isNew !== nextProps.isNew) return false;

    const prevMessage = prevProps.message;
    const nextMessage = nextProps.message;

    // Re-render if content changes
    if (prevMessage.content !== nextMessage.content) return false;

    // Re-render if loading or error state changes
    if (!!prevMessage.loading !== !!nextMessage.loading) return false;
    if (!!prevMessage.error !== !!nextMessage.error) return false;

    // Re-render if style changes (for virtualization)
    if (JSON.stringify(prevProps.style) !== JSON.stringify(nextProps.style))
      return false;

    // Otherwise, prevent re-render
    return true;
  },
);
MessageItem.displayName = "MessageItem";

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
    const getMessageClassName = useCallback(
      (isNew: boolean) =>
        clsx(
          "mx-auto w-full sm:w-[85%]",
          "py-4",
          "transition-all duration-700 ease-in-out",
          isNew
            ? "animate-fadeIn bg-theme-bg-accent border-l-4 border-theme-accent pl-2"
            : "bg-transparent",
        ),
      [],
    );

    // Define animation keyframes in CSS
    useEffect(() => {
      // Only inject if not already present
      if (!document.getElementById("message-animations")) {
        const style = document.createElement("style");
        style.id = "message-animations";
        style.innerHTML = `
          @keyframes fadeIn {
            from { opacity: 0.7; transform: translateY(-8px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fadeIn {
            animation: fadeIn 0.5s ease-out forwards;
          }
        `;
        document.head.appendChild(style);
      }

      // Clean up on unmount
      return () => {
        const style = document.getElementById("message-animations");
        if (style) {
          document.head.removeChild(style);
        }
      };
    }, []);

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

    // Virtual list ref for scrolling and resizing
    const listRef = useRef<VirtualList>(null);

    // Estimated size mapping for messages based on content
    const messageSizeCache = useRef<{ [key: string]: number }>({});

    // Estimate message height based on content length
    const estimateMessageSize = useCallback(
      (messageId: string) => {
        if (messageSizeCache.current[messageId]) {
          return messageSizeCache.current[messageId];
        }

        const message = messages[messageId];
        // Message will always exist here based on how messageId is used

        // Base height for message UI elements
        const baseHeight = 70;

        // Estimate content height based on character count
        // Average 100 chars per line, 20px line height
        const contentLength = message.content.length;
        const estimatedLines = Math.ceil(contentLength / 100);
        const contentHeight = Math.max(20, estimatedLines * 20);

        // Store in cache
        const totalHeight = baseHeight + contentHeight;
        messageSizeCache.current[messageId] = totalHeight;

        return totalHeight;
      },
      [messages],
    );

    // Item size getter for variable list
    const getItemSize = useCallback(
      (index: number) => {
        const messageId = visibleData[index];
        return estimateMessageSize(messageId);
      },
      [visibleData, estimateMessageSize],
    );

    // Reset the list when message heights might have changed
    useEffect(() => {
      if (listRef.current) {
        listRef.current.resetAfterIndex(0);
      }
    }, [visibleData.length]);

    // Message renderer for virtualized list
    const renderMessage = useCallback(
      ({ index, style }: { index: number; style: React.CSSProperties }) => {
        const messageId = visibleData[index];
        const message = messages[messageId];
        const isNew = isNewlyLoaded(index);

        return (
          <MessageItem
            messageId={messageId}
            message={message}
            isNew={isNew}
            style={style}
            maxWidth={maxWidth}
            showTimestamp={showTimestamps}
            showAvatar={showAvatars}
            userProfile={userProfile}
            controls={controls}
            controlsContext={controlsContext}
            onMessageAction={onMessageAction}
            className={getMessageClassName(isNew)}
          />
        );
      },
      [
        visibleData,
        messages,
        isNewlyLoaded,
        getMessageClassName,
        maxWidth,
        showTimestamps,
        showAvatars,
        userProfile,
        controls,
        controlsContext,
        onMessageAction,
      ],
    );

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
        {/* Load more button */}
        {showLoadMoreButton && (
          <LoadMoreButton onClick={handleLoadMore} isLoading={isLoading} />
        )}

        {/* Beginning of conversation indicator */}
        {showBeginningIndicator && <ConversationIndicator type="beginning" />}

        {/* Debug info in development */}
        {process.env.NODE_ENV === "development" && (
          <div className="sticky top-0 right-0 text-xs opacity-50 z-50 text-right">
            Showing{" "}
            {apiMessagesResponse?.stats.returned_count ??
              paginationStats.displayed}{" "}
            of {apiMessagesResponse?.stats.total_count ?? paginationStats.total}{" "}
            messages
            {apiMessagesResponse?.stats.has_more && " (more available)"}
          </div>
        )}

        {/* Virtualized list for performance with large lists */}
        {shouldUseVirtualization ? (
          <VirtualList
            ref={listRef}
            height={containerSize.height || 600}
            width="100%"
            itemCount={visibleData.length}
            itemSize={getItemSize}
            overscanCount={5}
          >
            {renderMessage}
          </VirtualList>
        ) : (
          // Standard rendering for smaller lists
          visibleData.map((messageId, index) => {
            const message = messages[messageId];
            const isNew = isNewlyLoaded(index);

            return (
              <MessageItem
                key={messageId}
                messageId={messageId}
                message={message}
                isNew={isNew}
                maxWidth={maxWidth}
                showTimestamp={showTimestamps}
                showAvatar={showAvatars}
                userProfile={userProfile}
                controls={controls}
                controlsContext={controlsContext}
                onMessageAction={onMessageAction}
                className={getMessageClassName(isNew)}
              />
            );
          })
        )}

        {/* End of conversation indicator */}
        <ConversationIndicator type="end" />
      </div>
    );
  },
);

MessageList.displayName = "MessageList";
