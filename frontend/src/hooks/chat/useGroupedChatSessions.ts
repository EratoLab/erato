import { useLingui } from "@lingui/react";
import { useMemo } from "react";

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
