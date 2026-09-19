/**
 * Retrying a failed delegated task from wherever its failure is visible.
 *
 * A task child that died — most sharply, one reaped after the replica running
 * it crashed — leaves nothing behind in the origin conversation: no delivery
 * row for the backstop sweep to find, and a dispatch slot still reading
 * "dispatched". The runs-list badge is the only signal, so the affordance that
 * acts on it has to live wherever that badge does. This hook is that
 * affordance's whole behaviour, so the three carriers (the runs bar, the
 * frozen trace slot, the delivered result card) cannot drift apart.
 *
 * Deliberately outside `src/components/`: the shared-kit registry re-exports
 * every module reachable from its roots that lives there, and this is internal
 * behaviour, not a kit contract. See `listedDelegatedRun.ts` for the same
 * reasoning.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import {
  recentChatsQuery,
  useRetryDelegatedRun as useRetryDelegatedRunMutation,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useAssistantsFeature } from "@/providers/FeatureConfigProvider";
import { delegatedRunsListingParams } from "@/utils/chat/delegatedRunDispatch";

import { findListedChat } from "./listedDelegatedRun";
import { useGenerationStatusStore } from "./store/generationStatusStore";

import type { NotRetryableState } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Why the server would not start the retry.
 *
 * `code` is what a caller discriminates on, never the status: the route
 * answers `409` in three different shapes — a `not_retryable` envelope, a
 * `generation_running` envelope, and plain text for an archived origin — and
 * the OpenAPI document collapses them into one `CONFLICT` entry, so the
 * generated error union names only the first. Casting every `409` to it would
 * be wrong about two thirds of them.
 *
 * The generated fetcher throws the parsed JSON body itself when there is one,
 * and `{ status, payload }` when the body would not parse — which is how a
 * plain-text `409` and the `422` for an unknown `kind` both arrive.
 */
export interface DelegatedRunRetryRefusal {
  /** Known only for a body that did not parse as JSON. */
  status?: number;
  /** `not_retryable` or `generation_running`; absent for a plain-text body. */
  code?: string;
  /** `not_retryable` only — the closed vocabulary the server publishes. */
  state?: NotRetryableState;
}

export interface DelegatedRunRetry {
  /**
   * Whether to offer the control at all. False when the deployment cannot run
   * an async task (so the route itself is a 404), when there is no run or no
   * origin to name, and after the server has said this client is asking for
   * something it does not understand.
   */
  enabled: boolean;
  /**
   * The run that already replaced this one, read off the listing's `retry_of`
   * whenever the listing carries it. That is the whole reason the field is on
   * the wire: a reload must not bring the retry button back on a run that has
   * already been retried.
   *
   * The id this client was just handed by the `202` is a FALLBACK for the
   * window before the listing catches up, never a substitute. The two are not
   * interchangeable: remembering the dispatch instead of reading `retry_of`
   * would put the button back on the next reload, which is the retry storm the
   * wire field bounds.
   */
  retriedByChatId: string | undefined;
  isRetrying: boolean;
  refusal: DelegatedRunRetryRefusal | null;
  retry: () => void;
}

const readRefusal = (error: unknown): DelegatedRunRetryRefusal => {
  if (typeof error !== "object" || error === null) {
    return {};
  }
  const body = error as { status?: unknown; code?: unknown; state?: unknown };
  return {
    ...(typeof body.status === "number" ? { status: body.status } : {}),
    ...(typeof body.code === "string" ? { code: body.code } : {}),
    ...(typeof body.state === "string"
      ? { state: body.state as NotRetryableState }
      : {}),
  };
};

/**
 * @param childChatId the failed run to replace; `undefined` disables the hook
 * @param originChatId the chat the run was dispatched from. Left unset, the
 *   open chat is assumed — true for the trace and the result card, which only
 *   ever render inside the origin conversation. The runs bar passes its own
 *   chat id, because it knows it without depending on navigation state.
 */
export function useDelegatedRunRetry(
  childChatId: string | undefined,
  originChatId?: string | null,
): DelegatedRunRetry {
  const { delegationTasksAllowAsync } = useAssistantsFeature();
  const queryClient = useQueryClient();
  const currentChatId = useGenerationStatusStore(
    (state) => state.currentChatId,
  );
  const origin = originChatId ?? currentChatId;

  // A refusal this client cannot act on — an unknown `kind`, or a route this
  // server does not serve — means the control is a lie, so it is withdrawn
  // rather than left to fail again.
  const [isUnsupported, setIsUnsupported] = useState(false);
  const [refusal, setRefusal] = useState<DelegatedRunRetryRefusal | null>(null);
  /**
   * The replacement this client just started, held only until the listing
   * names it.
   *
   * The listing cannot always name it straight away: a brief dispatched
   * without conversation context seeds no messages, and the listing
   * inner-joins each chat's latest message, so the refetch this success
   * triggers can come back before the child's own first row exists. Nothing
   * would invalidate it a second time — the status poller only refreshes the
   * listing for runs it already knows about — so the control would sit on
   * "Retry task" until a window focus, and a second click would be answered
   * `retry_in_flight` while a replacement was in fact running.
   */
  const [dispatchedChildId, setDispatchedChildId] = useState<
    string | undefined
  >(undefined);

  const mutation = useRetryDelegatedRunMutation({
    onSuccess: (response) => {
      setRefusal(null);
      setDispatchedChildId(response.child_chat_id);
      if (origin) {
        // The new child is server-side state this client has never seen; only
        // the origin-filtered listing coming back carries its `retry_of`, and
        // that is what swaps this run's button for a link to its replacement.
        void queryClient.invalidateQueries({
          queryKey: recentChatsQuery({
            queryParams: delegatedRunsListingParams(origin),
          }).queryKey,
        });
      }
    },
    onError: (error) => {
      const parsed = readRefusal(error);
      setRefusal(parsed);
      // A refusal that can never turn into a yes for this run withdraws the
      // control instead of leaving a button that only ever fails again: a
      // route this server does not serve (404), a `kind` it does not
      // understand (422), and `not_a_task_run`, which is a property of how the
      // run was dispatched and cannot change afterwards.
      if (
        parsed.status === 404 ||
        parsed.status === 422 ||
        parsed.state === "not_a_task_run"
      ) {
        setIsUnsupported(true);
      }
    },
  });

  // React Query's structural sharing keeps an unchanged row referentially
  // stable across refetches, so this snapshot only changes when a listing
  // actually gained or lost the replacement row. A plain `getQueriesData` read
  // would never re-render when the invalidated listing returns.
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      queryClient.getQueryCache().subscribe(onStoreChange),
    [queryClient],
  );
  const retriedBy = useSyncExternalStore(subscribe, () =>
    childChatId
      ? findListedChat(queryClient, (chat) => chat.retry_of === childChatId)
      : undefined,
  );

  const enabled =
    delegationTasksAllowAsync &&
    childChatId !== undefined &&
    Boolean(origin) &&
    !isUnsupported;

  const retry = useCallback(() => {
    if (!childChatId || !origin) {
      return;
    }
    mutation.mutate({
      // The one variant the server accepts. `kind` exists so the endpoint can
      // later also retry a stuck delivery; until it can, anything else is a
      // 422 rather than a silently different action.
      body: { kind: "task" },
      pathParams: { chatId: origin, childChatId },
    });
  }, [childChatId, mutation, origin]);

  return useMemo(
    () => ({
      enabled,
      // The wire first, this client's memory only while the wire is silent.
      retriedByChatId: retriedBy?.id ?? dispatchedChildId,
      isRetrying: mutation.isPending,
      refusal,
      retry,
    }),
    [
      dispatchedChildId,
      enabled,
      mutation.isPending,
      refusal,
      retriedBy?.id,
      retry,
    ],
  );
}
