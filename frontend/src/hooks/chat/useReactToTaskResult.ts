/* eslint-disable lingui/no-unlocalized-strings -- log lines and wire constants, never user-facing */
import { useEffect } from "react";

import { createLogger } from "@/utils/debugLogger";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

import { getClientToolHeaders } from "./clientToolExecutors";
import { readConflictRefusal } from "./conflictRefusal";
import { getStreamKey, useMessagingStore } from "./store/messagingStore";

import type { Message } from "@/types/chat";

const logger = createLogger("HOOK", "useReactToTaskResult");

const X_ERATO_PLATFORM_HEADER = "X-Erato-Platform";

/**
 * `(chatId, task_result_message_id)` pairs this session has actually ASKED
 * about, module-scoped rather than per-mount on purpose.
 *
 * The commonest reason a delivered result has no answer is a reaction the
 * server already ran and lost (`deliver_task_result` logs "The reaction to a
 * delivered task result failed" and still reports `Delivered`). If a
 * client-driven retry fails the same way, the row stays the active-thread tip
 * and the predicate stays true — so a per-mount set would fire a fresh
 * generation on every remount and every re-open of the chat, against a
 * provider that has already failed twice. One attempt per row per session.
 *
 * Written only when a socket was really opened (inside the `open` callback).
 * A request that was never made is not an attempt: entering a chat opens a
 * resumestream first, and that socket holds the chat until it 404s, so a mark
 * taken before the attach was accepted would burn the row's single ask on a
 * refusal — permanently, since this set outlives the mount.
 */
const attemptedByRow = new Set<string>();

/** Test seam: the suppression set is session-scoped, so it outlives a mount. */
export const resetReactAttemptsForTest = (): void => {
  attemptedByRow.clear();
};

export interface UseReactToTaskResultOptions {
  chatId: string | null;
  platform: string;
  messages: Record<string, Message>;
  messageOrder: string[];
  processStreamEvent: (
    event: SSEEvent,
    streamKeyRef?: { current: string },
  ) => void;
  /**
   * The one door onto a socket for a generation this client did not start.
   * Passed in rather than re-implemented so the `/react` socket takes the
   * same live-connection lock as the enter-chat and in-place attaches.
   */
  attachToServerGeneration: (options: {
    reason: string;
    chatId: string;
    startedAt?: string | null;
    dedupe?: boolean;
    open?: (chatId: string) => boolean;
  }) => boolean;
  setSSECleanupForKey: (key: string, cleanup: (() => void) | null) => void;
  setSSEAbortCallback: (cleanup: (() => void) | null, key: string) => void;
  /**
   * Drops the chat's optimistic "a turn is coming" placeholder. Part of the
   * tail every other streaming socket in `useChatMessaging` runs; see the
   * reconciliation comment on the handlers below.
   */
  clearPendingChat: (streamKey: string) => void;
  /** Re-reads the conversation from the server and clears local stream state. */
  handleRefetchAndClear: (options: { logContext: string }) => unknown;
  /** Wired in the commit that adds the handoff; absent means "log only". */
  onGenerationRunningRefusal?: (chatId: string) => void;
}

/**
 * Asks the server to run the reaction turn a delivered task result never got.
 *
 * `deliver_task_result` normally runs that turn itself, under the origin
 * chat's lease. When it does not — the reaction errored, or the process died
 * between writing the delivered row and running it — the answer is simply
 * missing, and nothing on the wire says so: `reaction_message_id` lives in the
 * CHILD chat's provenance, which no `/me/chats/{id}` or listing response
 * exposes. So the predicate is a proxy, and `already_reacted` is only ever
 * learned by asking and being refused. That is fine: the refusal is cheap and
 * permanently suppressive.
 */
export function useReactToTaskResult({
  chatId,
  platform,
  messages,
  messageOrder,
  processStreamEvent,
  attachToServerGeneration,
  setSSECleanupForKey,
  setSSEAbortCallback,
  clearPendingChat,
  handleRefetchAndClear,
  onGenerationRunningRefusal,
}: UseReactToTaskResultOptions): void {
  /**
   * Whether this client already holds a socket for the chat — the same lock
   * `attachToServerGeneration` takes, subscribed rather than read once.
   *
   * It is a dependency, not just a guard: entering a chat opens a forced
   * resumestream before the fetched rows reach the store, so the trigger's
   * first look at a delivered tip is always refused. Without a dep that moves
   * when that socket is released, the effect would never look again, and the
   * refusal would be the only thing the feature ever did for that chat.
   */
  const hasOpenSocket = useMessagingStore(
    (state) =>
      // `in`, not `!== undefined`: the store DELETES the entry on release, and
      // the record's type says a lookup is always defined.
      chatId !== null && getStreamKey(chatId) in state.sseAbortCallbacksByKey,
  );

  useEffect(() => {
    if (!chatId) {
      return;
    }

    // The TIP, not "some row carries a task_result". Precondition 11 of
    // `task_result_still_reactable` requires
    // `get_active_thread_tip(chat_id).id == task_result_message_id`, so an
    // "any row" predicate earns a `tip_moved` 409 on every chat that has ever
    // moved past one delivery — and once a reaction has run, its assistant row
    // IS the tip, which is exactly how this predicate goes false again.
    //
    // No active-thread filter here: both ingestion paths already drop
    // `is_message_in_active_thread === false` before anything reaches this
    // record, so a second filter would assert a guarantee this module cannot
    // make.
    const tipId = messageOrder.at(-1);
    const tip = tipId === undefined ? undefined : messages[tipId];
    if (tip?.role !== "user") {
      return;
    }
    const delivery = tip.task_result;
    if (!delivery) {
      return;
    }
    // The server's `/react` handler has no `scheduling` check, deliberately: a
    // client call is a person's request, not a re-application of the task
    // author's policy. An automatic fire is not a person's request, so it
    // reproduces the gate `deliver_task_result` itself applies. A `silent`
    // result was parked at `delivered` on purpose — "stored, not answered".
    if (delivery.scheduling === "silent") {
      return;
    }

    const attemptKey = `${chatId}:${tip.id}`;
    if (attemptedByRow.has(attemptKey)) {
      return;
    }
    if (hasOpenSocket) {
      // Someone is already streaming into this chat — usually the enter-chat
      // resume, which is about to 404 because nothing is running. Wait for it
      // rather than spending the row's one ask on a refusal: this effect
      // re-runs when that socket is released.
      logger.log(
        `[DEBUG_STREAMING] Not asking for a reaction in ${chatId} yet: a socket is open for it`,
      );
      return;
    }

    const streamKey = getStreamKey(chatId);
    const streamKeyRef = { current: streamKey };
    const targetMessageId = tip.id;

    const opened = attachToServerGeneration({
      reason: "react-to-task-result",
      chatId,
      // The row's own suppression set is the dedup here, and it is stronger
      // than the attach key: on this path there is no `startedAt` to key on,
      // so the key would collapse onto the enter-chat `:enter` key and
      // suppress the trigger outright.
      dedupe: false,
      open: (targetChatId) => {
        // The ask is real from here on, so this is where the row is marked —
        // and before the socket exists, so the store update that registering
        // it causes cannot re-enter this effect into a second request.
        attemptedByRow.add(attemptKey);
        logger.log(
          `[DEBUG_STREAMING] Asking for the reaction to ${targetMessageId} in chat ${targetChatId}`,
        );
        const cleanup = createSSEConnection(
          `/api/v1beta/me/chats/${targetChatId}/react`,
          {
            method: "POST",
            headers: {
              [X_ERATO_PLATFORM_HEADER]: platform,
              ...getClientToolHeaders(),
            },
            body: JSON.stringify({
              task_result_message_id: targetMessageId,
            }),
            // The same handler the resume socket uses. `/react` calls
            // `run_generation_after_user_message` directly — the user row
            // already exists — so the stream opens straight into assistant
            // deltas with no `user_message_saved` and no `chat_created`,
            // exactly as `resumestream` does.
            onMessage: (sseEvent) => processStreamEvent(sseEvent, streamKeyRef),
            onError: (errorEvent) => {
              setSSECleanupForKey(streamKey, null);
              setSSEAbortCallback(null, streamKey);
              reconcileAbandonedStream(
                streamKey,
                clearPendingChat,
                handleRefetchAndClear,
                "react stream error",
              );
              handleReactError(
                errorEvent,
                targetChatId,
                targetMessageId,
                onGenerationRunningRefusal,
              );
            },
            onClose: () => {
              setSSECleanupForKey(streamKey, null);
              setSSEAbortCallback(null, streamKey);
              reconcileAbandonedStream(
                streamKey,
                clearPendingChat,
                handleRefetchAndClear,
                "react stream closed without completion",
              );
            },
          },
        );
        setSSECleanupForKey(streamKey, cleanup);
        setSSEAbortCallback(cleanup, streamKey);
        return true;
      },
    });

    if (!opened) {
      logger.log(
        `[DEBUG_STREAMING] Not asking for a reaction in ${chatId}: a socket is already open for it`,
      );
    }
  }, [
    attachToServerGeneration,
    chatId,
    clearPendingChat,
    handleRefetchAndClear,
    hasOpenSocket,
    messageOrder,
    messages,
    onGenerationRunningRefusal,
    platform,
    processStreamEvent,
    setSSEAbortCallback,
    setSSECleanupForKey,
  ]);
}

/**
 * The tail every streaming socket in `useChatMessaging` runs, mirrored here.
 *
 * `processStreamEvent` sets `isStreaming` for this key on the first assistant
 * delta. A react turn that ends without a terminal event — a dropped connection, or a close
 * after the backend's broadcast filter swallowed `Error`/`StreamEnd` — would
 * otherwise leave `isPendingResponse` true, which disables the composer until
 * the user leaves the chat and comes back. Deliberately no `setError`: the
 * whole route is silent by design (a 404 means the feature is simply off), so
 * it reconciles from the server instead of painting an error the user did not
 * ask for.
 */
const reconcileAbandonedStream = (
  streamKey: string,
  clearPendingChat: (streamKey: string) => void,
  handleRefetchAndClear: (options: { logContext: string }) => unknown,
  logContext: string,
): void => {
  // Not gated on `isStreaming`: a placeholder can leak past the point where
  // streaming state was already reset, and clearing it is idempotent.
  clearPendingChat(streamKey);
  if (!useMessagingStore.getState().getStreaming(streamKey).isStreaming) {
    return;
  }
  logger.warn(
    `[DEBUG_STREAMING] The reaction stream ended while still streaming — reconciling from server (${logContext})`,
  );
  useMessagingStore.getState().resetStreaming(streamKey);
  void handleRefetchAndClear({ logContext });
};

/**
 * Every refusal this route can give, and why none of them reaches the user.
 *
 * Nothing here calls `setError`. A `404` covers a disabled feature, an unknown
 * chat, a foreign row and a plain miss with the same plain-text answer — the
 * anti-prober shape — so a deployment running `run_modes = ["wait"]` would
 * paint a red error on every delivered tip if this surfaced.
 */
const handleReactError = (
  errorEvent: Error | Event,
  chatId: string,
  messageId: string,
  onGenerationRunningRefusal?: (chatId: string) => void,
): void => {
  const refusal = readConflictRefusal(errorEvent);
  if (!refusal) {
    logger.log(
      `[DEBUG_STREAMING] The reaction request for ${messageId} failed without a response`,
    );
    return;
  }
  if (refusal.status === 404) {
    // Async delivery is off, or this row is not ours. Indistinguishable, and
    // both mean "there is nothing here" — stay silent.
    logger.log(
      `[DEBUG_STREAMING] No reaction route for ${messageId} (async delivery off, or the row is not reachable)`,
    );
    return;
  }
  if (refusal.status !== 409) {
    logger.error(
      `[DEBUG_STREAMING] The reaction request for ${messageId} failed with ${refusal.status}`,
    );
    return;
  }
  // Both refusals are 409. Discriminating on the status would take the wrong
  // branch for roughly half of them.
  if (refusal.code === "generation_running") {
    onGenerationRunningRefusal?.(chatId);
    return;
  }
  if (refusal.code !== "nothing_to_react") {
    // An archived chat answers 409 as plain text.
    logger.log(
      `[DEBUG_STREAMING] The reaction request for ${messageId} was refused without a code`,
    );
    return;
  }
  switch (refusal.reason) {
    case "already_reacted":
      // Someone already answered it. Permanently suppressed — the attempt set
      // is session-scoped, so this does not come back on the next mount.
      logger.log(
        `[DEBUG_STREAMING] ${messageId} has already been answered; suppressing`,
      );
      return;
    case "tip_moved":
      // NOT the same as `already_reacted`, and deliberately not collapsed into
      // it: the backend tests `already_reacted` first precisely so a client
      // can tell "suppress" from "offer a re-anchor". 779-B renders no
      // affordance yet, so the distinction lives in this log line — reversing
      // the two arms is the exact UI degradation the backend doc comment
      // warns about.
      logger.log(
        `[DEBUG_STREAMING] The conversation moved past ${messageId}; a re-anchor would be needed to answer it`,
      );
      return;
    case "not_delivered":
      // The wire reason collapses "a drain will get to it shortly"
      // (pending/claimed) with "never" (superseded/failed/a different row).
      // The client cannot tell them apart, and the recoverable half resolves
      // by itself, so a retry buys nothing on the good path and hammers a
      // dead delivery on the bad one.
      logger.log(
        `[DEBUG_STREAMING] ${messageId} is not in a delivered state; not retrying`,
      );
      return;
    default:
      // `not_a_task_result` and anything new: this client picked the wrong row.
      logger.warn(
        `[DEBUG_STREAMING] ${messageId} cannot be reacted to (${refusal.reason ?? "no reason"})`,
      );
  }
};
