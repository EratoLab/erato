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

/**
 * A real, displayable title — or `null` when the backend has none yet, so
 * the caller can fall through to its own placeholder.
 */
export function resolveRecentChatTitle(
  title: string | null | undefined,
): string | null {
  return title && title !== UNTITLED_BACKEND_SENTINEL ? title : null;
}

/** `provenance_kind` of a chat spawned by in-chat delegation. */
export const DELEGATION_PROVENANCE_KIND = "delegation";

/** `provenance_run_mode` of a delegated run that detached from its origin turn. */
export const BACKGROUND_RUN_MODE = "background";

/**
 * `provenance_run_mode` of a detached run whose answer is delivered back into
 * the conversation that started it.
 */
export const ASYNC_RUN_MODE = "async";

/** Every run mode that detaches from its origin turn. */
export const DETACHED_RUN_MODES: readonly string[] = [
  BACKGROUND_RUN_MODE,
  ASYNC_RUN_MODE,
];

export function isDelegatedRun(
  chat: Pick<RecentChat, "provenance_kind">,
): boolean {
  return chat.provenance_kind === DELEGATION_PROVENANCE_KIND;
}

/**
 * A delegated run with a life of its own: it detached at dispatch, so the
 * origin turn ended without it.
 *
 * Both detached modes count. A `background` run's answer only ever lives in
 * its own chat; an `async` run's is also delivered back to the origin later.
 * They are equally "not part of the turn that started them", which is what
 * every caller here is asking about — so a sidebar that recognised only
 * `background` would simply hide async runs.
 */
export function isBackgroundRun(
  chat: Pick<RecentChat, "provenance_kind" | "provenance_run_mode">,
): boolean {
  return (
    isDelegatedRun(chat) &&
    chat.provenance_run_mode !== undefined &&
    chat.provenance_run_mode !== null &&
    DETACHED_RUN_MODES.includes(chat.provenance_run_mode)
  );
}

export function mapRecentChatToSession(chat: RecentChat): ChatSession {
  return {
    id: chat.id,
    assistantId: chat.assistant_id,
    provenanceKind: chat.provenance_kind,
    delegatedRunOutcome: chat.delegated_run_outcome,
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
    archivedAt: chat.archived_at,
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
