/**
 * The strip above a chat explaining a state that refuses messages, and
 * whether the composer should be closed for it.
 *
 * Keyed off the chat-detail route rather than the sidebar's session model on
 * purpose: `/me/recent_chats` hides delegated runs and its status filter hides
 * archived chats, so a chat opened by link has no listing row, and a header
 * reading from one would render nothing and look like it had worked.
 */
import { skipToken } from "@tanstack/react-query";
import { useMemo } from "react";

import { ArchivedChatNotice } from "@/components/ui/Chat/ArchivedChatNotice";
import { DelegatedRunHeader } from "@/components/ui/Chat/DelegatedRunHeader";
import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { isDelegatedRun } from "@/utils/chat/recentChatSession";

import { useGenerationStatusFor } from "./store/generationStatusStore";

import type { ReactNode } from "react";

export interface ChatHeaderState {
  /** Null unless the chat is a delegated run, archived, or both. */
  header: ReactNode | null;
  /**
   * A run still being written by its delegate, or an archived chat, refuses
   * writes with a 409. Closing the composer is how the user learns that
   * instead of by sending something into an error.
   */
  composerLocked: boolean;
}

const NO_HEADER: ChatHeaderState = { header: null, composerLocked: false };

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

export const useChatHeader = (
  chatId: string | null | undefined,
  options?: {
    /** Forwarded to the header's origin link; see `DelegatedRunHeaderProps`. */
    onOpenOrigin?: (chatId: string) => void;
  },
): ChatHeaderState => {
  const onOpenOrigin = options?.onOpenOrigin;
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  // A run started by the conversation that dispatched it has no local
  // streaming state here; the generating poll is what knows it is live.
  const generationKind = useGenerationStatusFor(chatId ?? "")?.kind;

  return useMemo(() => {
    if (!chat) {
      return NO_HEADER;
    }
    const isArchived = Boolean(chat.archived_at);
    if (!isDelegatedRun(chat)) {
      return isArchived
        ? {
            header: <ArchivedChatNotice chatId={chat.id} />,
            composerLocked: true,
          }
        : NO_HEADER;
    }
    const isRunning = delegateIsWriting(generationKind, chat.adopted_at);
    const runHeader = (
      <DelegatedRunHeader
        assistantName={chat.assistant_name}
        provenanceKind={chat.provenance_kind}
        originChatId={chat.origin_chat_id}
        originChatTitle={chat.origin_chat_title}
        originAssistantId={chat.origin_assistant_id}
        expectedOutput={chat.expected_output}
        constraints={chat.constraints}
        isRunning={isRunning}
        onOpenOrigin={onOpenOrigin}
      />
    );
    return {
      // A run is archived and restored by the chat that dispatched it, so the
      // notice states the fact without offering the way back, as its row does.
      header: isArchived ? (
        <div className="space-y-1.5">
          {runHeader}
          <ArchivedChatNotice chatId={chat.id} canUnarchive={false} />
        </div>
      ) : (
        runHeader
      ),
      composerLocked: isRunning || isArchived,
    };
  }, [chat, generationKind, onOpenOrigin]);
};
