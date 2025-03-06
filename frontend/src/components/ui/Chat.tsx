import clsx from "clsx";
import { debounce } from "lodash";
import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";

import { useProfile } from "@/hooks/useProfile";

import { ChatHistorySidebar } from "./ChatHistorySidebar";
import { ChatInput } from "./ChatInput";
import { ChatMessage } from "./ChatMessage";
import { useChatHistory } from "../containers/ChatHistoryProvider";
import { useChat } from "../containers/ChatProvider";

import type {
  MessageAction,
  MessageControlsComponent,
  MessageControlsContext,
} from "../../types/message-controls";
import type { ChatMessage as ChatMessageType } from "../containers/ChatProvider";
import type { UserProfile } from "@/types/chat";
import type { FileType } from "@/utils/fileTypes";

export interface ChatProps {
  className?: string;
  /**
   * Layout configuration
   */
  layout?: "default" | "compact" | "comfortable";
  /**
   * Maximum width of messages
   */
  maxWidth?: number;
  /**
   * Whether to show avatars
   */
  showAvatars?: boolean;
  /**
   * Whether to show timestamps
   */
  showTimestamps?: boolean;
  // New unified handler
  onMessageAction?: (action: MessageAction) => void | Promise<void>;
  // Context for controls
  controlsContext: MessageControlsContext;
  // Optional custom controls component
  messageControls?: MessageControlsComponent;
  onNewChat?: () => void;
  onAddFile?: (files: File[]) => void;
  onRegenerate?: () => void;
  // Add new prop for sidebar collapsed state
  sidebarCollapsed?: boolean;
  onToggleCollapse: () => void;
  /** Optional array of accepted file types */
  acceptedFileTypes?: FileType[];
}

// Define prop types for our memoized components
interface LoadMoreButtonProps {
  onClick: () => void;
  isLoading: boolean;
}

interface ChatMessageProps {
  message: ChatMessageType;
  maxWidth: number;
  showTimestamp: boolean;
  showAvatar: boolean;
  userProfile: UserProfile | undefined;
  controls: MessageControlsComponent | undefined;
  controlsContext: MessageControlsContext;
  onMessageAction: (action: MessageAction) => Promise<void>;
  className: string;
}

// Add a LoadingSpinner component
const LoadingSpinner = React.memo(() => (
  <div
    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-solid border-current border-e-transparent align-[-0.125em] text-theme-text-secondary motion-reduce:animate-[spin_1.5s_linear_infinite]"
    role="status"
  >
    <span className="!absolute !-m-px !h-px !w-px !overflow-hidden !whitespace-nowrap !border-0 !p-0 ![clip:rect(0,0,0,0)]">
      Loading...
    </span>
  </div>
));
LoadingSpinner.displayName = "LoadingSpinner";

// Memoized ChatMessage wrapper
const MemoizedChatMessage = React.memo<ChatMessageProps>(
  ({
    message,
    maxWidth,
    showTimestamp,
    showAvatar,
    userProfile,
    controls,
    controlsContext,
    onMessageAction,
    className,
  }) => (
    <ChatMessage
      message={message}
      maxWidth={maxWidth}
      showTimestamp={showTimestamp}
      showAvatar={showAvatar}
      userProfile={userProfile}
      controls={controls}
      controlsContext={controlsContext}
      onMessageAction={onMessageAction}
      className={className}
    />
  ),
);
MemoizedChatMessage.displayName = "MemoizedChatMessage";

// Memoized beginning of conversation indicator
const BeginningIndicator = React.memo(() => (
  <div className="flex justify-center py-2 text-xs text-theme-text-secondary">
    <span>Beginning of conversation</span>
  </div>
));
BeginningIndicator.displayName = "BeginningIndicator";

// Memoized load more button
const LoadMoreButton = React.memo<LoadMoreButtonProps>(
  ({ onClick, isLoading }) => (
    <div className="sticky top-0 z-10 flex justify-center py-2 bg-theme-bg-secondary">
      <button
        onClick={onClick}
        className="px-4 py-2 text-sm bg-theme-bg-primary text-theme-text-primary rounded-full hover:bg-theme-bg-tertiary focus:outline-none focus:ring-2 focus:ring-theme-primary transition-colors flex items-center gap-2"
        disabled={isLoading}
      >
        {isLoading && <LoadingSpinner />}
        {isLoading ? "Loading..." : "Load more messages"}
      </button>
    </div>
  ),
);
LoadMoreButton.displayName = "LoadMoreButton";

export const Chat = ({
  className,
  layout = "default",
  maxWidth = 768,
  showAvatars = false,
  showTimestamps = true,
  onMessageAction,
  controlsContext,
  messageControls,
  onNewChat,
  onAddFile,
  onRegenerate,
  sidebarCollapsed = false,
  onToggleCollapse,
  acceptedFileTypes,
}: ChatProps) => {
  // Get chat messages using the hook
  const {
    messages,
    messageOrder,
    sendMessage,
    isLoading: chatLoading,
    hasOlderMessages,
    loadOlderMessages,
  } = useChat();
  const { profile } = useProfile();
  const {
    sessions,
    currentSessionId,
    switchSession,
    deleteSession,
    isLoading: chatHistoryLoading,
    error: chatHistoryError,
  } = useChatHistory();

  // Track scroll position and show load more button
  const [showLoadMoreButton, setShowLoadMoreButton] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Track if we've loaded all messages
  const [allMessagesLoaded, setAllMessagesLoaded] = useState(false);

  // Update allMessagesLoaded when hasOlderMessages changes
  useEffect(() => {
    setAllMessagesLoaded(!hasOlderMessages && messageOrder.length > 0);
  }, [hasOlderMessages, messageOrder.length]);

  // Debounced scroll handler to minimize performance impact
  const debouncedScrollHandler = useMemo(
    () =>
      debounce(() => {
        if (!chatContainerRef.current || !hasOlderMessages) return;

        // Show the load more button when user scrolls near the top (within 100px)
        const { scrollTop } = chatContainerRef.current;
        setShowLoadMoreButton(scrollTop < 100);
      }, 100), // 100ms debounce time
    [hasOlderMessages],
  );

  // Handle scroll event with debounced function
  const handleScroll = useCallback(() => {
    debouncedScrollHandler();
  }, [debouncedScrollHandler]);

  // Add scroll event listener
  useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);

      // Cleanup function
      return () => {
        container.removeEventListener("scroll", handleScroll);
        debouncedScrollHandler.cancel(); // Cancel any pending debounced calls
      };
    }
  }, [handleScroll, debouncedScrollHandler]);

  // Ref for initial render and auto-scroll tracking
  const hasScrolledToBottomRef = useRef(false);
  const previousSessionIdRef = useRef(currentSessionId);

  // Effect to scroll to bottom when messages are loaded for a chat
  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container || !messageOrder.length) return;

    // Check if we've switched chats or if messages were just loaded
    const isNewChat = previousSessionIdRef.current !== currentSessionId;

    // Reset our scroll tracking when switching chats
    if (isNewChat) {
      hasScrolledToBottomRef.current = false;
      previousSessionIdRef.current = currentSessionId;
    }

    // Only scroll to bottom on initial load of messages and not loading
    if (!chatLoading && !hasScrolledToBottomRef.current) {
      // Use RAF for better performance and to ensure DOM is updated
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
        hasScrolledToBottomRef.current = true;
      });
    }
  }, [currentSessionId, messageOrder.length, chatLoading]);

  // Simple handler for the load more button
  const handleLoadMore = useCallback(() => {
    loadOlderMessages();
  }, [loadOlderMessages]);

  // Memoize layout styles to prevent recalculation
  const layoutStyles = useMemo(
    () => ({
      default: "space-y-4 p-4",
      compact: "space-y-2 p-2",
      comfortable: "space-y-6 p-6",
    }),
    [],
  );

  // Memoize message action handler
  const handleMessageAction = useCallback(
    async (action: MessageAction) => {
      if (onMessageAction) {
        await onMessageAction(action);
      }
    },
    [onMessageAction],
  );

  // Memoize message class strings
  const getMessageClassName = useCallback((layoutType: string) => {
    return clsx(
      "mx-auto w-full sm:w-[85%]",
      layoutType === "compact" && "py-2",
      layoutType === "comfortable" && "py-6",
    );
  }, []);

  // Memoize the message classes to avoid recalculation
  const messageClassName = useMemo(
    () => getMessageClassName(layout),
    [getMessageClassName, layout],
  );

  // Memoize the main container class to avoid recalculation
  const containerClassName = useMemo(
    () =>
      clsx(
        "flex-1 flex flex-col h-full bg-theme-bg-secondary min-w-0",
        "mt-14 sm:mt-0",
        className,
      ),
    [className],
  );

  // Memoize the chat area class to avoid recalculation
  const chatAreaClassName = useMemo(
    () =>
      clsx(
        "flex-1 overflow-y-auto",
        "bg-theme-bg-secondary",
        "px-2 sm:px-4",
        layoutStyles[layout],
      ),
    [layoutStyles, layout],
  );

  // Wrap the sendMessage with a void handler for ChatInput
  const handleSendMessage = useCallback(
    (message: string) => {
      void sendMessage(message);
    },
    [sendMessage],
  );

  return (
    <div className="flex h-full w-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={onNewChat}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSessionSelect={switchSession}
        onSessionDelete={deleteSession}
        isLoading={chatHistoryLoading}
        error={chatHistoryError}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />
      <div
        className={containerClassName}
        role="region"
        aria-label="Chat conversation"
      >
        <div ref={chatContainerRef} className={chatAreaClassName}>
          {hasOlderMessages && showLoadMoreButton && (
            <LoadMoreButton onClick={handleLoadMore} isLoading={chatLoading} />
          )}

          {allMessagesLoaded && messageOrder.length > 0 && (
            <BeginningIndicator />
          )}

          {messageOrder.map((messageId) => (
            <MemoizedChatMessage
              key={messageId}
              message={messages[messageId]}
              maxWidth={maxWidth}
              showTimestamp={showTimestamps}
              showAvatar={showAvatars}
              userProfile={profile}
              controls={messageControls}
              controlsContext={controlsContext}
              onMessageAction={handleMessageAction}
              className={messageClassName}
            />
          ))}
        </div>

        <ChatInput
          onSendMessage={handleSendMessage}
          acceptedFileTypes={acceptedFileTypes}
          onAddFile={onAddFile}
          className="border-t border-theme-border bg-theme-bg-primary p-2 sm:p-4"
          isLoading={chatLoading}
          showControls
          onRegenerate={onRegenerate}
        />
      </div>
    </div>
  );
};
