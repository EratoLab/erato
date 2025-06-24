import { t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { ChatHistorySidebar } from "@/components/ui/Chat/ChatHistorySidebar";
import { useSidebar } from "@/hooks/ui";
import { useProfile } from "@/hooks/useProfile";
import { useChatContext } from "@/providers/ChatProvider";
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
    createNewChat: createChat,
    isHistoryLoading: chatHistoryLoading,
    historyError: chatHistoryError,
  } = useChatContext();

  const { profile } = useProfile();
  const { isOpen: sidebarCollapsed, toggle: onToggleCollapse } = useSidebar();
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
  const sessions: ChatSession[] = Array.isArray(chatHistory)
    ? chatHistory.map((chat) => ({
        id: chat.id,
        title: chat.title_by_summary || t`New Chat`,
        updatedAt: chat.last_message_at || new Date().toISOString(),
        messages: [],
        metadata: {
          lastMessage: {
            content: chat.title_by_summary || "",
            timestamp: chat.last_message_at || new Date().toISOString(),
          },
          fileCount: chat.file_uploads.length,
        },
      }))
    : [];

  // Handle session select
  const handleSessionSelect = (sessionId: string) => {
    logger.log(
      `[SEARCH_FLOW] Handling session select in SearchPageStructure for session: ${sessionId}`,
    );
    switchSession(sessionId);
  };

  // Handle archiving a session
  const handleArchiveSession = (sessionId: string) => {
    void archiveChat(sessionId);
  };

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

  return (
    <div className="flex size-full flex-col sm:flex-row">
      <ChatHistorySidebar
        collapsed={sidebarCollapsed}
        onNewChat={() => void handleNewChat()}
        onToggleCollapse={onToggleCollapse}
        sessions={sessions}
        currentSessionId={currentChatId ?? ""}
        onSessionSelect={handleSessionSelect}
        onSessionArchive={handleArchiveSession}
        showTimestamps={true}
        isLoading={chatHistoryLoading}
        error={chatHistoryError instanceof Error ? chatHistoryError : undefined}
        className="fixed inset-0 z-50 sm:relative sm:z-auto"
        userProfile={profile}
      />

      {/* Main search content area */}
      <div className="flex h-full min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
