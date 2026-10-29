import { useLingui } from "@lingui/react";
import { useMemo, useState } from "react";

import {
  groupChatSessions,
  sessionNeedsAttention,
} from "@/utils/chatHistoryGrouping";

import { useConfirmationRegistryStore } from "./store/confirmationRegistryStore";
import { useGenerationStatusStore } from "./store/generationStatusStore";

import type { ChatHistoryGroupBy } from "./store/chatHistoryFilterStore";
import type { ChatSession } from "@/types/chat";
import type { ChatSessionGroup } from "@/utils/chatHistoryGrouping";

/**
 * `groupChatSessions` wired to its live inputs: the current locale plus the
 * attention signal a row needs — generation status merged with pending tool
 * confirmations, the same pair behind the row status dot.
 */
export function useGroupedChatSessions(
  sessions: ChatSession[],
  groupBy: ChatHistoryGroupBy,
): ChatSessionGroup[] {
  const statusByChatId = useGenerationStatusStore(
    (state) => state.statusByChatId,
  );
  const pendingIdsByChatId = useConfirmationRegistryStore(
    (state) => state.pendingIdsByChatId,
  );
  const { i18n } = useLingui();

  return useMemo(
    () =>
      groupChatSessions(sessions, groupBy, {
        now: new Date(),
        locale: i18n.locale,
        needsAttention: (session) =>
          sessionNeedsAttention(
            session,
            statusByChatId[session.id],
            (pendingIdsByChatId[session.id]?.length ?? 0) > 0,
          ),
      }),
    [sessions, groupBy, i18n.locale, statusByChatId, pendingIdsByChatId],
  );
}

/**
 * Whether a grouped history list should stop loading older chats. Older pages
 * can land only in collapsed groups (a collapsed "Older" takes every one), and
 * then the sentinel never leaves the screen; a page that adds no visible rows
 * pauses loading until the collapsed groups change.
 */
export function useGroupedLoadMorePaused(
  groups: readonly ChatSessionGroup[],
  collapsedGroupKeys: ReadonlySet<string>,
  isLoadingMore: boolean,
): boolean {
  const visibleCount = useMemo(
    () =>
      groups.reduce(
        (count, group) =>
          collapsedGroupKeys.has(group.key)
            ? count
            : count + group.sessions.length,
        0,
      ),
    [groups, collapsedGroupKeys],
  );
  const [loadStartCount, setLoadStartCount] = useState<number | null>(null);
  const [pause, setPause] = useState<{
    visibleCount: number;
    collapsedGroupKeys: ReadonlySet<string>;
  } | null>(null);
  // Adjusted during render, so the list drops its sentinel in the same commit
  // the fruitless page lands in, before a new observer could fire.
  if (isLoadingMore && loadStartCount === null) {
    setLoadStartCount(visibleCount);
  } else if (!isLoadingMore && loadStartCount !== null) {
    setLoadStartCount(null);
    if (visibleCount === loadStartCount) {
      setPause({ visibleCount, collapsedGroupKeys });
    }
  }
  return (
    pause !== null &&
    pause.visibleCount === visibleCount &&
    pause.collapsedGroupKeys === collapsedGroupKeys
  );
}
