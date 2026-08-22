/**
 * The run header for a delegated chat, and whether its composer should be
 * closed.
 *
 * Keyed off the chat-detail route rather than the sidebar's session model on
 * purpose: `/me/recent_chats` hides delegated runs, so a chat opened by link
 * has no listing row, and a header reading from one would render nothing and
 * look like it had worked.
 */
import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import { DelegatedRunHeader } from "@/components/ui/Chat/DelegatedRunHeader";
import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { isDelegatedRun } from "@/utils/chat/recentChatSession";

import { useGenerationStatusFor } from "./store/generationStatusStore";

import type { ReactNode } from "react";

export interface DelegatedRunHeaderState {
  /** Null unless the chat is a delegated run. */
  header: ReactNode | null;
  /**
   * A run still being written by its delegate, or an archived one, refuses
   * writes with a 409. Closing the composer is how the user learns that
   * instead of by sending something into an error.
   */
  composerLocked: boolean;
}

/**
 * A generation in a run the owner has taken over is their own turn, and the
 * composer already handles that like any other chat. Only a delegate still
 * writing the run is someone else holding the chat.
 */
const delegateIsWriting = (
  generationKind: string | undefined,
  adoptedAt: string | undefined,
): boolean =>
  (generationKind === "running" || generationKind === "action_required") &&
  !adoptedAt;

export const useDelegatedRunHeader = (
  chatId: string | null | undefined,
  options?: {
    /** Forwarded to the header's origin link; see `DelegatedRunHeaderProps`. */
    onOpenOrigin?: (chatId: string) => void;
  },
): DelegatedRunHeaderState => {
  const onOpenOrigin = options?.onOpenOrigin;
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  // A run started by the conversation that dispatched it has no local
  // streaming state here; the generating poll is what knows it is live.
  const generationKind = useGenerationStatusFor(chatId ?? "")?.kind;

  return useMemo(() => {
    if (!chat || !isDelegatedRun(chat)) {
      return { header: null, composerLocked: false };
    }
    const isRunning = delegateIsWriting(generationKind, chat.adopted_at);
    const isArchived = Boolean(chat.archived_at);
    return {
      header: (
        <DelegatedRunHeader
          assistantName={chat.assistant_name}
          provenanceKind={chat.provenance_kind}
          originChatId={chat.origin_chat_id}
          originChatTitle={chat.origin_chat_title}
          originAssistantId={chat.origin_assistant_id}
          expectedOutput={chat.expected_output}
          constraints={chat.constraints}
          isRunning={isRunning}
          isArchived={isArchived}
          onOpenOrigin={onOpenOrigin}
        />
      ),
      composerLocked: isRunning || isArchived,
    };
  }, [chat, generationKind, onOpenOrigin]);
};
