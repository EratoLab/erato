import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { runWithGraphTimeout } from "../../utils/graph/graphRequestTimeout";
import { parseTeamsChat } from "../utils/parsedTeamsChat";
import { runWithChatReadSlot } from "../utils/teamsChatRateGate";
import { TEAMS_GRAPH_LIST_TIMEOUT_MS } from "../utils/teamsGraphTimeouts";

import type {
  ParsedTeamsChat,
  TeamsSelfIdentity,
} from "../utils/parsedTeamsChat";
import type { TeamsChatFetcher } from "../utils/teamsChatFetcher";
import type { GraphChat } from "../utils/teamsChatGraph";

/** Bound on how many chats one search page may resolve, one request each. */
export const MAX_RESOLVED_CHAT_TITLES = 25;

/**
 * Resolves chats a search hit points at but the browsed window never listed.
 * `useQueries` starts every one of them at once and the per-chat gate does not
 * hold back different chats, so the shared read slot is what keeps a search
 * page from landing as a single burst. Each chat is fetched at most once and
 * then cached for the session.
 */
export function useTeamsChatTitles(
  fetcher: TeamsChatFetcher | null,
  chatIds: readonly string[],
  self?: TeamsSelfIdentity,
): ReadonlyMap<string, ParsedTeamsChat> {
  const wanted = useMemo(
    () => Array.from(new Set(chatIds)).slice(0, MAX_RESOLVED_CHAT_TITLES),
    [chatIds],
  );

  const resolved = useQueries({
    queries: wanted.map((chatId) => ({
      queryKey: ["office-addin", "teams", "chat", chatId],
      enabled: fetcher !== null,
      retry: false,
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!fetcher) return null;
        // Timeout inside the slot: queueing is not the request's own budget.
        return runWithChatReadSlot(() =>
          runWithGraphTimeout(
            TEAMS_GRAPH_LIST_TIMEOUT_MS,
            `Teams chat lookup timed out after ${TEAMS_GRAPH_LIST_TIMEOUT_MS}ms`,
            signal,
            (timeoutSignal) =>
              fetcher.getChat(chatId, { signal: timeoutSignal }),
          ),
        );
      },
    })),
    combine: (results) => results.map((result) => result.data ?? null),
  });

  // `combine` returns a fresh array every render, so memo identity comes from
  // the ids that landed rather than from the array reference.
  const signature = resolved
    .map((chat) => chat?.id ?? "")
    .join("|")
    .concat(`#${self?.userId ?? ""}:${self?.userPrincipalName ?? ""}`);

  return useMemo(
    () => buildChatTitleMap(resolved, self),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands in for the freshly-built `resolved` array
    [signature],
  );
}

function buildChatTitleMap(
  chats: readonly (GraphChat | null)[],
  self?: TeamsSelfIdentity,
): ReadonlyMap<string, ParsedTeamsChat> {
  const byId = new Map<string, ParsedTeamsChat>();
  for (const chat of chats) {
    const parsed = chat ? parseTeamsChat(chat, self) : null;
    if (parsed) byId.set(parsed.chatId, parsed);
  }
  return byId;
}
