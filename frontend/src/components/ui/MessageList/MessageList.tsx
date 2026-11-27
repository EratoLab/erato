import clsx from "clsx";
import { debounce } from "lodash";
import {
  memo,
  useCallback,
  useMemo,
  useEffect,
  useInsertionEffect,
  useRef,
  useState,
} from "react";

import { messageAttachmentFileIds } from "@/components/ui/Chat/messageAttachmentFileIds";
import { useSpeechPlayback } from "@/hooks/audio/speechPlayback";
import { useFileUploadStore } from "@/hooks/files/useFileUploadStore";
import { useResolvedFiles } from "@/hooks/files/useResolvedFiles";
import { useMessageListVirtualization } from "@/hooks/ui";
import { usePaginatedData } from "@/hooks/ui/usePaginatedData";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";
import { getAssistantTurns } from "@/utils/chat/assistantTurns";
import {
  conversationRestingTop,
  usePersonTurn,
} from "@/utils/chat/conversationFollow";
import { contentSize } from "@/utils/chat/messageUtils";
import {
  isSameMessage,
  shallowEqual,
  useStableEntries,
  useStableValue,
} from "@/utils/chat/stableValues";
import { getTaskResultFolds, taskResultOf } from "@/utils/chat/taskResultFolds";
import { FileTypeUtil } from "@/utils/fileTypes";

import { MessageListHeader } from "./MessageListHeader";
import { useMessageClassNameHelper } from "./MessageListUtils";
import { MessageTextActionsToolbar } from "./MessageTextActionsToolbar";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { StandardMessageList } from "./StandardMessageList";
import { VirtualizedMessageList } from "./VirtualizedMessageList";
import { ConversationMessagesProvider } from "../Message/ConversationMessages";

import type { ChatMessageProps } from "../Chat/ChatMessage";
import type {
  ChatMessagesResponse,
  ContentPart,
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
import type { ModelSwitch } from "@/utils/chat/modelSwitches";
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
   * Optional override for the display name of user-authored messages
   */
  userDisplayNameOverride?: string;

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

  /** Historical model switches keyed by the user message they precede. */
  modelSwitches?: Record<string, ModelSwitch>;
}

const decodeRepeatedly = (value: string, maxIterations = 3): string => {
  let decoded = value;
  for (let i = 0; i < maxIterations; i += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        return decoded;
      }
      decoded = next;
    } catch {
      return decoded;
    }
  }

  return decoded;
};

const getImageFilePointerFilename = (
  url: string | null | undefined,
  fallbackId: string,
): string => {
  const fallbackFilename = `file-${fallbackId}`;

  if (!url) {
    return fallbackFilename;
  }

  try {
    const parsed = new URL(url);
    const rawContentDisposition = parsed.searchParams.get("rscd");

    if (rawContentDisposition) {
      const contentDisposition = decodeRepeatedly(rawContentDisposition);
      const filenameMatch = /filename\*?=(?:UTF-8''|")?([^;"]+)/i.exec(
        contentDisposition,
      );
      if (filenameMatch?.[1]) {
        const rawFilename = filenameMatch[1]
          .replace(/^"(.*)"$/, "$1")
          .replace(/^UTF-8''/i, "");
        return decodeRepeatedly(rawFilename);
      }
    }

    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const filename = pathSegments.at(-1);
    if (!filename) {
      return fallbackFilename;
    }

    return decodeURIComponent(filename);
  } catch {
    return fallbackFilename;
  }
};

const EMPTY_ASSISTANT_FILES: FileUploadItem[] = [];
const NO_MODEL_SWITCHES: Record<string, ModelSwitch> = {};
const mockImagePointerFiles = new WeakMap<ContentPart, FileUploadItem>();

const toMockImagePointerFile = (part: ContentPart): FileUploadItem | null => {
  if (part.content_type === "image_file_pointer") {
    const cached = mockImagePointerFiles.get(part);
    if (cached) return cached;
    const filename = getImageFilePointerFilename(
      part.preview_url ?? part.download_url,
      part.file_upload_id,
    );
    const fileCapability = FileTypeUtil.createMockFileCapability(filename);
    const capability: FileUploadItem["file_capability"] = {
      ...fileCapability,
      // eslint-disable-next-line lingui/no-unlocalized-strings
      operations: fileCapability.operations.includes("analyze_image")
        ? fileCapability.operations
        : // eslint-disable-next-line lingui/no-unlocalized-strings
          [...fileCapability.operations, "analyze_image"],
    };

    const file: FileUploadItem = {
      id: part.file_upload_id,
      filename,
      file_capability: capability,
      file_contents_unavailable_missing_permissions: false,
      is_sharepoint_file: false,
      download_url: part.download_url ?? "",
      preview_url: part.preview_url ?? part.download_url ?? undefined,
    };
    mockImagePointerFiles.set(part, file);
    return file;
  }
  return null;
};

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

interface LastSeenSnapshot {
  sessionId: string | null;
  messageId: string;
  createdAt: number;
  contentSize: number;
}

const takeLastSeenSnapshot = (
  messageOrder: string[],
  messages: Record<string, ChatMessage>,
  sessionId: string | null,
): LastSeenSnapshot | null => {
  const messageId = messageOrder.at(-1);
  if (messageId === undefined) return null;

  const message = messages[messageId];
  return {
    sessionId,
    messageId,
    createdAt: Date.parse(message.createdAt),
    contentSize: contentSize(message.content),
  };
};

// Counts assistant output that arrived below the viewport since the user left
// the bottom: messages after the last one they saw, plus that message itself
// if it kept streaming. The user's own sends are not counted.
function useUnseenMessageCount({
  messageOrder,
  messages,
  currentSessionId,
  isAwayFromBottom,
  foldedTaskResultRowIds,
}: {
  messageOrder: string[];
  messages: Record<string, ChatMessage>;
  currentSessionId: string | null;
  isAwayFromBottom: boolean;
  foldedTaskResultRowIds: ReadonlySet<string>;
}) {
  const [lastSeen, setLastSeen] = useState<LastSeenSnapshot | null>(null);

  useEffect(() => {
    if (!isAwayFromBottom) {
      setLastSeen(null);
      return;
    }

    // Switching chats keeps this list mounted with a stale scroll position,
    // so the new chat's existing messages become the baseline.
    setLastSeen((current) =>
      current?.sessionId === currentSessionId
        ? current
        : takeLastSeenSnapshot(messageOrder, messages, currentSessionId),
    );
  }, [isAwayFromBottom, currentSessionId, messageOrder, messages]);

  return useMemo(() => {
    if (!isAwayFromBottom || lastSeen?.sessionId !== currentSessionId) {
      return 0;
    }

    // The last seen message disappears when its optimistic id is replaced
    // (createdAt is preserved) or an edit/regenerate drops it, so fall back
    // to timestamps; history loaded above is never newer.
    const lastSeenIndex = messageOrder.indexOf(lastSeen.messageId);
    let count = 0;

    messageOrder.forEach((messageId, index) => {
      const message = messages[messageId];
      if (
        message.role === "user" &&
        (!taskResultOf(message) || foldedTaskResultRowIds.has(messageId))
      )
        return;

      const isUnseen =
        lastSeenIndex >= 0
          ? index > lastSeenIndex
          : Date.parse(message.createdAt) >= lastSeen.createdAt;
      if (isUnseen) count += 1;
    });

    if (lastSeenIndex >= 0) {
      const lastSeenMessage = messages[lastSeen.messageId];
      // Growth only: the post-stream refetch may normalize persisted content.
      if (
        lastSeenMessage.role !== "user" &&
        contentSize(lastSeenMessage.content) > lastSeen.contentSize
      ) {
        count += 1;
      }
    }

    return count;
  }, [
    isAwayFromBottom,
    lastSeen,
    currentSessionId,
    messageOrder,
    messages,
    foldedTaskResultRowIds,
  ]);
}

/**
 * MessageList component for rendering chat messages with scroll behavior
 */
export const MessageList = memo<MessageListProps>(
  ({
    messages: incomingMessages,
    messageOrder: incomingMessageOrder,
    loadOlderMessages,
    hasOlderMessages,
    isPending,
    currentSessionId,
    apiMessagesResponse,
    pageSize = 6,
    maxWidth,
    showTimestamps = true,
    showAvatars = false,
    userProfile,
    userDisplayNameOverride,
    controls,
    messageRenderer,
    controlsContext: incomingControlsContext,
    onMessageAction: incomingOnMessageAction,
    className,
    useVirtualization = false,
    virtualizationThreshold = 30,
    onScrollToBottomRef,
    onFilePreview,
    assistantFiles = EMPTY_ASSISTANT_FILES,
    onViewFeedback,
    isTransitioning,
    emptyStateComponent,
    modelSwitches: incomingModelSwitches,
  }) => {
    // Hosts rebuild these on every streamed update; the memoized rows below
    // should re-render only for the message that actually changed.
    const messages = useStableEntries(incomingMessages, isSameMessage);
    const messageOrder = useStableValue(incomingMessageOrder);
    const modelSwitches = useStableEntries(
      incomingModelSwitches ?? NO_MODEL_SWITCHES,
      shallowEqual,
    );
    const taskResultFolds = useMemo(
      () => getTaskResultFolds(messages, messageOrder),
      [messages, messageOrder],
    );
    const assistantTurns = useMemo(() => {
      const markedIds = new Set(
        messageOrder.filter((id) => {
          const fold = taskResultFolds.byReplyId[id];
          return Boolean(
            modelSwitches[id] ?? (fold && modelSwitches[fold.rowId]),
          );
        }),
      );
      return getAssistantTurns(
        messages,
        messageOrder,
        taskResultFolds.foldedRowIds,
        markedIds,
      );
    }, [messages, messageOrder, taskResultFolds, modelSwitches]);
    const controlsContext = useStableValue(incomingControlsContext);
    const latestOnMessageAction = useRef(incomingOnMessageAction);
    // Before any layout effect, so a row calling it from one sees this render's.
    useInsertionEffect(() => {
      latestOnMessageAction.current = incomingOnMessageAction;
    });
    const onMessageAction = useCallback(
      (action: MessageAction) => latestOnMessageAction.current(action),
      [],
    );
    const uploadedFiles = useFileUploadStore((state) => state.uploadedFiles);

    // Audio mode with spoken replies: a waiting card and the start of a
    // written answer stay in view while the person listens.
    const followsConversation = useSpeechPlayback(
      (state) => state.conversational,
    );
    const { turn, replying } = usePersonTurn(messageOrder, messages);
    const lastMessageId = useRef(messageOrder.at(-1));
    lastMessageId.current = messageOrder.at(-1);
    const restingTopInList = useMemo(
      () =>
        followsConversation
          ? (container: HTMLDivElement) =>
              conversationRestingTop(container, lastMessageId.current)
          : undefined,
      [followsConversation],
    );

    const { containerRef, isScrolledUp, isNearTop, scrollToBottom } =
      useScrollToBottom({
        isTransitioning: isPending || isTransitioning,
        chat: currentSessionId ?? "",
        turn,
        replying,
        content: messages,
        restingTop: restingTopInList,
      });

    // Expose scrollToBottom function to parent component
    useEffect(() => {
      if (onScrollToBottomRef) {
        onScrollToBottomRef(scrollToBottom);
      }
    }, [onScrollToBottomRef, scrollToBottom]);

    // Set up pagination for message data
    const { visibleData, hasMore, loadMore, isNewlyLoaded } = usePaginatedData({
      data: messageOrder,
      initialCount: pageSize,
      pageSize: pageSize,
      enabled: hasOlderMessages,
      direction: "backward", // Use backward pagination for chat (older messages first)
    });

    const newMessageCount = useUnseenMessageCount({
      messageOrder,
      messages,
      currentSessionId,
      isAwayFromBottom: isScrolledUp,
      foldedTaskResultRowIds: taskResultFolds.foldedRowIds,
    });

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

    // Use our hook to load more messages when scrolling to top
    useLoadMoreOnScroll({
      isNearTop,
      hasOlderMessages,
      isPending,
      handleLoadMore,
    });

    // Collect all known file records for attachment previews and
    // erato-file:// link resolution.
    const knownFilesById = useMemo(() => {
      const fileMap: Record<string, FileUploadItem> = {};

      // Assistant files are available even before they appear in message payloads.
      assistantFiles.forEach((file) => {
        fileMap[file.id] = file;
      });

      // Newly uploaded files may be referenced by an optimistic user message
      // before that message is rehydrated with full file metadata from the API.
      uploadedFiles.forEach((file) => {
        fileMap[file.id] = file;
      });

      // Message files override assistant URLs, preserving freshest data from chat API.
      messageOrder.forEach((messageId) => {
        const message = messages[messageId] as UiChatMessage;
        (message.files ?? []).forEach((file) => {
          fileMap[file.id] = file;
        });

        message.content.forEach((part) => {
          const pointerFile = toMockImagePointerFile(part);
          if (pointerFile && !(pointerFile.id in fileMap)) {
            fileMap[pointerFile.id] = pointerFile;
          }
        });
      });
      return fileMap;
    }, [assistantFiles, messageOrder, messages, uploadedFiles]);

    const attachmentIds = useMemo(
      () =>
        messageOrder.flatMap((id) =>
          messageAttachmentFileIds(messages[id] as UiChatMessage),
        ),
      [messageOrder, messages],
    );
    const allFilesById = useStableValue(
      useResolvedFiles(attachmentIds, knownFilesById),
    );

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
        />
      );
    }, [
      apiMessagesResponse?.stats.has_more,
      hasOlderMessages,
      isPending,
      messageOrder.length,
      handleLoadMore,
    ]);

    // Add optimized container class based on state
    const containerClass = useMemo(() => {
      return clsx(
        "chat-body-skin flex flex-1 flex-col overflow-y-auto",
        // A composer or top bar floating over the list (globals.css) sets
        // the overlaps, so the first and last messages scroll clear of them.
        "[padding:calc(var(--theme-spacing-shell-padding-y)+var(--chat-top-overlap,0px))_calc(var(--theme-spacing-shell-padding-x)/2)_calc(var(--theme-spacing-shell-padding-y)+var(--chat-composer-overlap,0px))]",
        "gap-[var(--theme-spacing-shell-gap)]",
        "sm:[padding:calc(var(--theme-spacing-shell-padding-y)+var(--chat-top-overlap,0px))_var(--theme-spacing-shell-padding-x)_calc(var(--theme-spacing-shell-padding-y)+var(--chat-composer-overlap,0px))]",
        className,
        // Apply transition properties without changing opacity
        // This creates a smoother experience when content changes
        // eslint-disable-next-line lingui/no-unlocalized-strings
        "transition-[opacity,transform] duration-300 ease-in-out",
        // Only change opacity when explicitly transitioning (not during normal message updates)
        isTransitioning ? "opacity-0" : "opacity-100",
      );
    }, [className, isTransitioning]);

    const contentWidthStyle = useMemo(
      () => ({
        maxWidth:
          typeof maxWidth === "number"
            ? `${maxWidth}px`
            : "var(--theme-layout-chat-content-max-width)",
      }),
      [maxWidth],
    );

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
          event.clipboardData.setData("text/html", sanitizedHtml);
        }
      },
      [],
    );

    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={containerRef}
          className={containerClass}
          data-testid="message-list"
          data-ui="chat-body"
          onCopy={handleCopyPlainText}
        >
          {renderMessageListHeader}
          {showEmptyState && emptyStateComponent ? (
            <div className="flex min-h-[300px] w-full items-center justify-center pb-6 pt-16 sm:pb-10 sm:pt-24">
              {emptyStateComponent}
            </div>
          ) : (
            <div className="mx-auto w-full" style={contentWidthStyle}>
              <ConversationMessagesProvider messages={messages}>
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
                    userDisplayNameOverride={userDisplayNameOverride}
                    controls={controls}
                    messageRenderer={messageRenderer}
                    controlsContext={controlsContext}
                    onMessageAction={onMessageAction}
                    onFilePreview={onFilePreview}
                    onViewFeedback={onViewFeedback}
                    allFilesById={allFilesById}
                    modelSwitches={modelSwitches}
                    taskResultFolds={taskResultFolds}
                    assistantTurns={assistantTurns}
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
                    userDisplayNameOverride={userDisplayNameOverride}
                    controls={controls}
                    messageRenderer={messageRenderer}
                    controlsContext={controlsContext}
                    onMessageAction={onMessageAction}
                    onFilePreview={onFilePreview}
                    onViewFeedback={onViewFeedback}
                    allFilesById={allFilesById}
                    modelSwitches={modelSwitches}
                    taskResultFolds={taskResultFolds}
                    assistantTurns={assistantTurns}
                  />
                )}
              </ConversationMessagesProvider>
            </div>
          )}
        </div>
        {newMessageCount > 0 && (
          <ScrollToBottomButton
            onClick={scrollToBottom}
            newMessageCount={newMessageCount}
          />
        )}
        <MessageTextActionsToolbar
          containerRef={containerRef}
          messages={messages}
          messageOrder={messageOrder}
        />
      </div>
    );
  },
);

// eslint-disable-next-line lingui/no-unlocalized-strings
MessageList.displayName = "MessageList";
