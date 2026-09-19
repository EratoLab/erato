/* eslint-disable lingui/no-unlocalized-strings -- log lines and wire constants, never user-facing */
import { useEffect } from "react";

import { createLogger } from "@/utils/debugLogger";
import { createSSEConnection, type SSEEvent } from "@/utils/sse/sseClient";

import { readConflictRefusal } from "./conflictRefusal";
import { getStreamKey } from "./store/messagingStore";

import type { Message } from "@/types/chat";

const logger = createLogger("HOOK", "useReactToTaskResult");

const X_ERATO_PLATFORM_HEADER = "X-Erato-Platform";

/**
 * `(chatId, task_result_message_id)` pairs this session has already asked
 * about, module-scoped rather than per-mount on purpose.
 *
 * The commonest reason a delivered result has no answer is a reaction the
 * server already ran and lost (`deliver_task_result` logs "The reaction to a
 * delivered task result failed" and still reports `Delivered`). If a
 * client-driven retry fails the same way, the row stays the active-thread tip
 * and the predicate stays true — so a per-mount set would fire a fresh
 * generation on every remount and every re-open of the chat, against a
 * provider that has already failed twice. One attempt per row per session.
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
  onGenerationRunningRefusal,
}: UseReactToTaskResultOptions): void {
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
    // Marked before the attempt, not after: a refused attach (a socket for
    // this chat is already open) or a failed request must not re-enter on the
    // next render. One ask per row per session, win or lose.
    attemptedByRow.add(attemptKey);

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
        logger.log(
          `[DEBUG_STREAMING] Asking for the reaction to ${targetMessageId} in chat ${targetChatId}`,
        );
        const cleanup = createSSEConnection(
          `/api/v1beta/me/chats/${targetChatId}/react`,
          {
            method: "POST",
            headers: { [X_ERATO_PLATFORM_HEADER]: platform },
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
