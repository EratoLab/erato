/* eslint-disable lingui/no-unlocalized-strings -- log lines and wire constants, never user-facing */
import { useEffect } from "react";

import {
  approvalItemsOf,
  approvalStopState,
  isWaitingItem,
} from "@/components/ui/Message/approvalItems";
import { createLogger } from "@/utils/debugLogger";

import { readConflictRefusal } from "./conflictRefusal";
import { useGenerationStatusStore } from "./store/generationStatusStore";
import { getStreamKey, useMessagingStore } from "./store/messagingStore";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { Message } from "@/types/chat";

const logger = createLogger("HOOK", "useResumeSettledWaitingStop");

/**
 * How long a settled stop stays parked before this client asks: the server
 * resumes the turn itself from the task's own tail, and that must win.
 */
export const SETTLED_STOP_GRACE_MS = 5_000;

// Parts a stop can be followed by while no answer has been written to it.
const UNANSWERING_PARTS: ReadonlySet<string> = new Set([
  "tool_approval",
  "tool_rejection",
  "tool_use",
  "text_file_pointer",
  "image_file_pointer",
  "audio_file_pointer",
]);

/**
 * The message's last stop when it waited for tasks that have all finished and
 * nothing on it is left to decide, or `null`. Read as the server reads it:
 * a waiting item settles with the last `tool_use` of its call.
 */
export const settledWaitingStopOf = (
  content: readonly ContentPart[],
): { index: number; toolCallId: string } | null => {
  let index = content.length - 1;
  while (index >= 0 && content[index].content_type !== "tool_approval_request")
    index--;
  const request = content[index] as ContentPart | undefined;
  if (request?.content_type !== "tool_approval_request") return null;
  const after = content.slice(index + 1);
  if (!after.every((part) => UNANSWERING_PARTS.has(part.content_type)))
    return null;
  if (!approvalItemsOf(request).some(isWaitingItem)) return null;
  const slots: Record<string, string | undefined> = {};
  content.forEach((part) => {
    if (part.content_type === "tool_use" && part.tool_call_id)
      slots[part.tool_call_id] = part.status;
  });
  const state = approvalStopState(request, after, { slots, isLastStop: true });
  return state.open.length === 0 && state.waiting.length === 0
    ? { index, toolCallId: request.tool_call_id }
    : null;
};

// Each stop is asked about once per session, whatever the answer.
const askedStops = new Set<string>();

export const resetSettledStopAsksForTest = (): void => {
  askedStops.clear();
};

export interface UseResumeSettledWaitingStopOptions {
  chatId: string | null;
  messages: Record<string, Message>;
  messageOrder: string[];
  /** Whether this client streams into the chat or is about to. */
  isBusy: boolean;
  /** Resumes the parked turn with nothing to decide, streaming it here. */
  resume: (messageId: string, toolCallId: string) => Promise<void>;
  /** Attaches to a generation another request started in this chat. */
  attach: (chatId: string) => void;
  refetch: () => unknown;
}

/**
 * The open chat's backstop for a parked turn whose waiting tasks all finished.
 *
 * The server resumes such a turn itself when the last task's continuation
 * ends; this only covers a resume that never ran (a crash between the task's
 * end and its tail, which the cleanup tick repairs on the row but cannot
 * continue without the user's request). It waits a grace period first, and
 * every refusal that says the turn moved on is silent.
 */
export function useResumeSettledWaitingStop({
  chatId,
  messages,
  messageOrder,
  isBusy,
  resume,
  attach,
  refetch,
}: UseResumeSettledWaitingStopOptions): void {
  const actionRequired = useGenerationStatusStore(
    (state) =>
      chatId !== null &&
      state.statusByChatId[chatId]?.kind === "action_required",
  );
  const hasOpenSocket = useMessagingStore(
    (state) =>
      chatId !== null && getStreamKey(chatId) in state.sseAbortCallbacksByKey,
  );

  const tipId = messageOrder.at(-1);
  const tip = tipId === undefined ? undefined : messages[tipId];
  const stop =
    tip?.role === "assistant" ? settledWaitingStopOf(tip.content) : null;
  const askKey =
    chatId && tip && stop ? `${chatId}:${tip.id}:${stop.index}` : undefined;
  const toolCallId = stop?.toolCallId;

  useEffect(() => {
    if (
      !chatId ||
      !tipId ||
      !askKey ||
      !toolCallId ||
      !actionRequired ||
      isBusy ||
      hasOpenSocket ||
      askedStops.has(askKey)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      askedStops.add(askKey);
      logger.log(
        `[DEBUG_STREAMING] Resuming ${tipId} in ${chatId}: its waiting tasks finished`,
      );
      resume(tipId, toolCallId).catch((error: unknown) => {
        const refusal = readConflictRefusal(error);
        if (refusal?.status === 409 && refusal.code === "generation_running") {
          attach(chatId);
          return;
        }
        if (
          refusal?.status === 409 &&
          (refusal.code === "children_waiting" ||
            refusal.code === "already_continued")
        ) {
          void refetch();
          return;
        }
        logger.warn(
          `[DEBUG_STREAMING] Resuming the settled stop of ${tipId} failed`,
          error,
        );
      });
    }, SETTLED_STOP_GRACE_MS);
    return () => clearTimeout(timer);
  }, [
    actionRequired,
    askKey,
    attach,
    chatId,
    hasOpenSocket,
    isBusy,
    refetch,
    resume,
    tipId,
    toolCallId,
  ]);
}
