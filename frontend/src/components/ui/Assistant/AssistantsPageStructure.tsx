import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

import { ChatHistorySidebar } from "@/components/ui/Chat/ChatHistorySidebar";
import { EditChatTitleDialog } from "@/components/ui/Chat/EditChatTitleDialog";
import { useSidebar } from "@/hooks/ui";
import { useProfile } from "@/hooks/useProfile";
import { useChatContext } from "@/providers/ChatProvider";
import { useSidebarFeature } from "@/providers/FeatureConfigProvider";
import { createLogger } from "@/utils/debugLogger";

import type { ChatSession } from "@/types/chat";

const logger = createLogger("UI", "AssistantsPageStructure");

export default function AssistantsPageStructure({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    chats: chatHistory,
    currentChatId,
    navigateToChat: switchSession,
    archiveChat,
    createNewChat: createChat,
    updateChatTitle,
    refetchHistory,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
  } = useChatContext();

  const { profile } = useProfile();
  const {
    isOpen: sidebarCollapsed,
    toggle: onToggleCollapse,
    collapsedMode,
  } = useSidebar();
  const { chatHistoryShowMetadata } = useSidebarFeature();

  const location = useLocation();
  const pathname = location.pathname;
  const prevPathnameRef = useRef<string>(pathname);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      logger.log(
        `AssistantsPageStructure: pathname changed from ${prevPathnameRef.current} to ${pathname}`,
      );
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  // Convert the chat history data to the format expected by the sidebar
  const sessions = useMemo<ChatSession[]>(
    () =>
      Array.isArray(chatHistory)
        ? chatHistory.map((chat) => ({
            id: chat.id,
            title: chat.title_resolved,
            titleResolved: chat.title_resolved,
            titleBySummary: chat.title_by_summary,
            titleByUserProvided: chat.title_by_user_provided,
            updatedAt: chat.last_message_at,
            messages: [],
            metadata: {
              lastMessage: {
                content: chat.title_resolved,
                timestamp: chat.last_message_at,
              },
              fileCount: chat.file_uploads.length,
            },
            assistantId: chat.assistant_id as string | null | undefined,
          }))
        : [],
    [chatHistory],
  );

  // Handle session select
  const handleSessionSelect = (sessionId: string) => {
    logger.log(
      `[ASSISTANTS_FLOW] Handling session select in AssistantsPageStructure for session: ${sessionId}`,
    );
    switchSession(sessionId);
  };

  // Handle archiving a session
  const handleArchiveSession = (sessionId: string) => {
    void archiveChat(sessionId);
  };

  const [titleDialogChatId, setTitleDialogChatId] = useState<string | null>(
    null,
  );
  const [isUpdatingChatTitle, setIsUpdatingChatTitle] = useState(false);

  const handleEditTitleSession = useCallback((sessionId: string) => {
    setTitleDialogChatId(sessionId);
  }, []);

  const handleCloseEditTitleDialog = useCallback(() => {
    if (isUpdatingChatTitle) return;
    setTitleDialogChatId(null);
  }, [isUpdatingChatTitle]);

  const activeTitleDialogSession = useMemo(
    () => sessions.find((session) => session.id === titleDialogChatId) ?? null,
    [sessions, titleDialogChatId],
  );

  const handleSubmitEditTitleDialog = useCallback(
    async (title: string) => {
      if (!titleDialogChatId) {
        return;
      }

      try {
        setIsUpdatingChatTitle(true);
        await updateChatTitle(titleDialogChatId, title);
        await refetchHistory();
        setTitleDialogChatId(null);
      } finally {
        setIsUpdatingChatTitle(false);
      }
    },
    [refetchHistory, titleDialogChatId, updateChatTitle],
  );

  // Handle creating a new chat
  const handleNewChat = async () => {
    logger.log("[ASSISTANTS_FLOW] New chat button clicked from assistants");
    try {
      await createChat();
      logger.log("[ASSISTANTS_FLOW] New chat creation completed");
    } catch (error) {
      logger.log("[ASSISTANTS_FLOW] Error creating new chat:", error);
    }
  };

  logger.log(
    `AssistantsPageStructure render. Path: ${pathname}, currentChatId: ${currentChatId ?? "null"}`,
  );

  return (
    <div className="flex size-full flex-col sm:flex-row" data-ui="page-shell">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={() => void handleNewChat()}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId ?? ""}
        onSessionSelect={handleSessionSelect}
        onSessionArchive={handleArchiveSession}
        onSessionEditTitle={handleEditTitleSession}
        showTimestamps={chatHistoryShowMetadata}
        isLoading={chatHistoryLoading}
        error={chatHistoryError instanceof Error ? chatHistoryError : undefined}
        userProfile={profile}
      />

      {/* Main assistants content area */}
      <div
        className={clsx(
          "flex h-full min-w-0 flex-1 flex-col",
          // Add left margin based on sidebar state to prevent overlap with fixed sidebar
          // Transition margin to match sidebar animation (300ms)
          "transition-[margin] duration-300 ease-in-out motion-reduce:transition-none",
          // When expanded: full width (320px)
          !sidebarCollapsed && "sm:ml-[var(--theme-layout-sidebar-width)]",
          // When collapsed in slim mode: narrow width (64px)
          sidebarCollapsed && collapsedMode === "slim" && "sm:ml-16",
          // When collapsed in hidden mode: no margin (sidebar is off-screen)
          // (default, no class needed)
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
    </div>
  );
}
