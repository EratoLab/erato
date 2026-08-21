/**
 * Surfaces a background delegated run above the composer the moment its
 * dispatch frame arrives on the stream, instead of when the turn ends.
 *
 * The run's chat exists server-side from launch, but the origin-filtered
 * listing only refetches on the terminal invalidation — and an immediate
 * refetch would race the detached run's first message write, which the
 * listing's join requires. So the dispatch frame seeds the listing cache
 * with a provisional row instead; the turn-end invalidation replaces it
 * with server truth.
 *
 * The row carries no generation markers on purpose: a run between dispatch
 * and its generation lease resolves as running anyway, and a fabricated
 * marker would enroll the run in the generating poll before its lease
 * exists, inviting a false terminal transition.
 */
import {
  DELEGATION_TOOL_NAME,
  parseDelegationEnvelope,
} from "@/lib/delegation/delegationEnvelope";
import { recentChatsQuery } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import {
  BACKGROUND_RUN_MODE,
  DELEGATION_PROVENANCE_KIND,
  UNTITLED_BACKEND_SENTINEL,
} from "./recentChatSession";

import type {
  MessageSubmitStreamingResponseToolCallUpdate,
  RecentChat,
  RecentChatsResponse,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { QueryClient } from "@tanstack/react-query";

/**
 * The section is a recency window, not a paginated history: one page, sized
 * to comfortably cover a chat's recent runs.
 */
export const DELEGATED_RUNS_LISTING_LIMIT = 50;

/**
 * The one query-params shape the delegated-runs listing is cached under.
 * The seeding below writes to the cache by exact key, so the listing surface
 * and the seed must build their params here and nowhere else.
 *
 * The origin filter composes with `include_delegated` rather than implying
 * it — without the latter, delegated children stay hidden and the query
 * returns nothing.
 */
export const delegatedRunsListingParams = (originChatId: string) => ({
  origin_chat_id: originChatId,
  include_delegated: true,
  limit: DELEGATED_RUNS_LISTING_LIMIT,
});

/**
 * Seed the origin chat's delegated-runs listing from a dispatch frame.
 *
 * Acts only on the frozen background-dispatch part (`background: true`, a
 * run to point at, no status) of the delegation tool; every other tool
 * update passes through untouched. Returns whether a row was seeded.
 */
export function seedDispatchedDelegatedRun(
  queryClient: QueryClient,
  originChatId: string,
  update: MessageSubmitStreamingResponseToolCallUpdate,
): boolean {
  if (update.tool_name !== DELEGATION_TOOL_NAME) {
    return false;
  }
  const envelope = parseDelegationEnvelope(update.output ?? undefined);
  const delegateChatId = envelope?.delegateChatId;
  if (!envelope?.background || delegateChatId === undefined) {
    return false;
  }

  const { queryKey } = recentChatsQuery({
    queryParams: delegatedRunsListingParams(originChatId),
  });
  let seeded = false;
  queryClient.setQueryData<RecentChatsResponse>(queryKey, (current) => {
    if (current?.chats.some((chat) => chat.id === delegateChatId)) {
      return current;
    }
    seeded = true;
    // The sentinel title lets the row fall through to the assistant's name;
    // the run's real title arrives with the refetched listing.
    const row: RecentChat = {
      id: delegateChatId,
      title_resolved: UNTITLED_BACKEND_SENTINEL,
      assistant_id: envelope.assistantId,
      assistant_name: envelope.assistantName,
      provenance_kind: DELEGATION_PROVENANCE_KIND,
      provenance_run_mode: BACKGROUND_RUN_MODE,
      origin_chat_id: originChatId,
      last_message_at: new Date().toISOString(),
      can_edit: true,
      is_pinned: false,
      file_uploads: [],
    };
    if (!current) {
      return {
        chats: [row],
        stats: {
          current_offset: 0,
          has_more: false,
          returned_count: 1,
          total_count: 1,
        },
      };
    }
    return { ...current, chats: [row, ...current.chats] };
  });
  return seeded;
}
