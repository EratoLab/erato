import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { ChatHistorySidebar } from "@/components/ui/Chat/ChatHistorySidebar";
import { ChatShareDialog } from "@/components/ui/Chat/ChatShareDialog";
import { EditChatTitleDialog } from "@/components/ui/Chat/EditChatTitleDialog";
import {
  dismissChatActionFailure,
  runChatAction,
} from "@/components/ui/Chat/chatActionFeedback";
import { useSidebarPage } from "@/components/ui/Chat/sidebarPage";
import { useSidebar } from "@/hooks/ui";
import { useProfile } from "@/hooks/useProfile";
import { useChatSession } from "@/providers/ChatProvider";
import {
  useChatSharingFeature,
  usePinnedChatsFeature,
  useSidebarFeature,
} from "@/providers/FeatureConfigProvider";
import { mapRecentChatToSession } from "@/utils/chat/recentChatSession";
import { createLogger } from "@/utils/debugLogger";

import type { ChatSession } from "@/types/chat";

const logger = createLogger("UI", "SearchPageStructure");

export default function SearchPageStructure({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    chats: chatHistory,
    currentChatId,
    navigateToChat: switchSession,
    archiveChat,
    unarchiveChat,
    createNewChat: createChat,
    updateChatTitle,
    pinChat,
    pinnedChats: pinnedChatHistory,
    fetchNextHistoryPage,
    hasNextHistoryPage,
    isFetchingNextHistoryPage,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
  } = useChatSession();

  const { profile } = useProfile();
  const {
    isOpen: sidebarCollapsed,
    toggle: onToggleCollapse,
    collapsedMode,
  } = useSidebar();
  const { chatHistoryShowMetadata } = useSidebarFeature();
  const { enabled: chatSharingEnabled } = useChatSharingFeature();
  const { enabled: pinnedChatsEnabled, maxItems: pinnedChatsLimit } =
    usePinnedChatsFeature();
  const location = useLocation();
  const pathname = location.pathname;
  const prevPathnameRef = useRef<string>(pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      logger.log(
        `SearchPageStructure: pathname changed from ${prevPathnameRef.current} to ${pathname}`,
      );
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  // Convert the chat history data to the format expected by the sidebar
  const sessions: ChatSession[] = useMemo(
    () =>
      Array.isArray(chatHistory) ? chatHistory.map(mapRecentChatToSession) : [],
    [chatHistory],
  );
  const pinnedSessions = useMemo(
    () => pinnedChatHistory.map(mapRecentChatToSession),
    [pinnedChatHistory],
  );

  // Handle session select
  const handleSessionSelect = (sessionId: string) => {
    logger.log(
      `[SEARCH_FLOW] Handling session select in SearchPageStructure for session: ${sessionId}`,
    );
    switchSession(sessionId);
  };

  // Handle archiving a session
  const handleArchiveSession = (sessionId: string) => {
    void runChatAction("archive", sessionId, () => archiveChat(sessionId));
  };

  const handleUnarchiveSession = (sessionId: string) => {
    void runChatAction("unarchive", sessionId, () => unarchiveChat(sessionId));
  };

  const handlePinSession = useCallback(
    (sessionId: string, isPinned: boolean) => {
      void runChatAction(isPinned ? "pin" : "unpin", sessionId, () =>
        pinChat(sessionId, isPinned),
      );
    },
    [pinChat],
  );

  const [titleDialogChatId, setTitleDialogChatId] = useState<string | null>(
    null,
  );
  const [shareDialogChatId, setShareDialogChatId] = useState<string | null>(
    null,
  );
  const [isUpdatingChatTitle, setIsUpdatingChatTitle] = useState(false);

  const handleEditTitleSession = useCallback((sessionId: string) => {
    setTitleDialogChatId(sessionId);
  }, []);

  const handleOpenShareDialog = useCallback((sessionId: string) => {
    setShareDialogChatId(sessionId);
  }, []);

  const handleCloseShareDialog = useCallback(() => {
    setShareDialogChatId(null);
  }, []);

  const handleCloseEditTitleDialog = useCallback(() => {
    if (isUpdatingChatTitle) return;
    if (titleDialogChatId) {
      dismissChatActionFailure("rename", titleDialogChatId);
    }
    setTitleDialogChatId(null);
  }, [isUpdatingChatTitle, titleDialogChatId]);

  const activeTitleDialogSession = useMemo(
    () =>
      pinnedSessions.find((session) => session.id === titleDialogChatId) ??
      sessions.find((session) => session.id === titleDialogChatId) ??
      null,
    [pinnedSessions, sessions, titleDialogChatId],
  );

  const handleSubmitEditTitleDialog = useCallback(
    async (title: string) => {
      if (!titleDialogChatId) {
        return;
      }

      try {
        setIsUpdatingChatTitle(true);
        // updateChatTitle already invalidates the recent-chats query, which
        // refetches every loaded page — no extra refetch needed here.
        if (
          await runChatAction("rename", titleDialogChatId, () =>
            updateChatTitle(titleDialogChatId, title),
          )
        ) {
          setTitleDialogChatId(null);
        }
      } finally {
        setIsUpdatingChatTitle(false);
      }
    },
    [titleDialogChatId, updateChatTitle],
  );

  // Handle creating a new chat
  const handleNewChat = async () => {
    logger.log("[SEARCH_FLOW] New chat button clicked from search");
    try {
      await createChat();
      logger.log("[SEARCH_FLOW] New chat creation completed");
    } catch (error) {
      logger.log("[SEARCH_FLOW] Error creating new chat:", error);
    }
  };

  logger.log(
    `SearchPageStructure render. Path: ${pathname}, currentChatId: ${currentChatId ?? "null"}`,
  );

  const sidebarPage = useSidebarPage(sidebarCollapsed, collapsedMode);

  return (
    <div className="flex size-full flex-col sm:flex-row" data-ui="page-shell">
      <ChatHistorySidebar
        pageRef={sidebarPage.ref}
        collapsed={sidebarCollapsed}
        onNewChat={() => void handleNewChat()}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId ?? ""}
        onSessionSelect={handleSessionSelect}
        onSessionArchive={handleArchiveSession}
        onSessionUnarchive={handleUnarchiveSession}
        onSessionEditTitle={handleEditTitleSession}
        onSessionShare={chatSharingEnabled ? handleOpenShareDialog : undefined}
        pinnedSessions={pinnedSessions}
        pinnedChatsLimit={pinnedChatsLimit}
        onSessionPin={pinnedChatsEnabled ? handlePinSession : undefined}
        showTimestamps={chatHistoryShowMetadata}
        isLoading={chatHistoryLoading}
        hasMoreSessions={hasNextHistoryPage}
        isLoadingMoreSessions={isFetchingNextHistoryPage}
        onLoadMoreSessions={() => {
          void fetchNextHistoryPage();
        }}
        error={chatHistoryError instanceof Error ? chatHistoryError : undefined}
        userProfile={profile}
      />

      {/* Main search content area */}
      <div
        {...sidebarPage}
        className={clsx(
          "flex h-full min-w-0 flex-1 flex-col",
          sidebarPage.className,
        )}
      >
        {children}
      </div>

      <EditChatTitleDialog
        isOpen={titleDialogChatId !== null && activeTitleDialogSession !== null}
        generatedTitle={activeTitleDialogSession?.titleBySummary ?? ""}
        initialUserProvidedTitle={
          activeTitleDialogSession?.titleByUserProvided ?? null
        }
        isSubmitting={isUpdatingChatTitle}
        onClose={handleCloseEditTitleDialog}
        onSubmit={handleSubmitEditTitleDialog}
      />

      <ChatShareDialog
        isOpen={shareDialogChatId !== null}
        chatId={shareDialogChatId}
        onClose={handleCloseShareDialog}
      />
    </div>
  );
}
