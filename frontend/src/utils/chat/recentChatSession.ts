/**
 * Converts a listed recent chat into the sidebar's session row model. The
 * chat page uses it for both the recent and the pinned list; the two must
 * stay identical, and `assistantId` has to survive the conversion for the
 * type grouping and the assistant-aware row links.
 */
import { t } from "@lingui/core/macro";

import type { RecentChat } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ChatSession } from "@/types/chat";

/** `title_resolved` sentinel the backend returns while a chat has no title. */
export const UNTITLED_BACKEND_SENTINEL = "Untitled Chat";

/** `provenance_kind` of a chat spawned by in-chat delegation. */
export const DELEGATION_PROVENANCE_KIND = "delegation";

export function isDelegatedRun(
  chat: Pick<RecentChat, "provenance_kind">,
): boolean {
  return chat.provenance_kind === DELEGATION_PROVENANCE_KIND;
}

export function mapRecentChatToSession(chat: RecentChat): ChatSession {
  return {
    id: chat.id,
    assistantId: chat.assistant_id,
    provenanceKind: chat.provenance_kind,
    originChatId: chat.origin_chat_id,
    originChatTitle: chat.origin_chat_title,
    title:
      chat.title_resolved ||
      t({ id: "chat.newChat.title", message: "New Chat" }),
    titleResolved: chat.title_resolved,
    titleBySummary: chat.title_by_summary ?? null,
    titleByUserProvided: chat.title_by_user_provided ?? null,
    canEdit: chat.can_edit,
    isPinned: chat.is_pinned,
    updatedAt: chat.last_message_at || new Date().toISOString(),
    messages: [],
    metadata: {
      lastMessage: {
        content: chat.title_resolved || "",
        timestamp: chat.last_message_at || new Date().toISOString(),
      },
      fileCount: chat.file_uploads.length,
    },
  };
}
