/**
 * Where a delegated run came from, resolved for display.
 *
 * Provenance ids are deliberately dangling-tolerant: the chat that dispatched
 * a run can be deleted while the run stays. So the origin resolves to a label
 * in every case and to a link only when the chat is still there — a link to a
 * dead chat is worse than no link.
 */
import { t } from "@lingui/core/macro";

import {
  DELEGATION_PROVENANCE_KIND,
  UNTITLED_BACKEND_SENTINEL,
} from "./recentChatSession";

/** The provenance fields a delegated run carries, however they were fetched. */
export interface DelegatedRunProvenance {
  provenanceKind?: string;
  originChatId?: string;
  /** Absent once the origin chat is gone, even while `originChatId` is set. */
  originChatTitle?: string;
  originAssistantId?: string;
}

export interface DelegatedRunOrigin {
  label: string;
  /** Set only while the origin chat still exists to be opened. */
  chatId?: string;
  assistantId?: string;
}

/**
 * Null for anything that is not a delegated run, so callers can use it as the
 * "is there provenance to show" test as well.
 */
export const delegatedRunOrigin = ({
  provenanceKind,
  originChatId,
  originChatTitle,
  originAssistantId,
}: DelegatedRunProvenance): DelegatedRunOrigin | null => {
  if (provenanceKind !== DELEGATION_PROVENANCE_KIND) {
    return null;
  }
  if (originChatTitle === UNTITLED_BACKEND_SENTINEL) {
    return {
      label: t({
        id: "assistant.welcome.delegated.origin.untitled",
        message: "From an untitled conversation",
      }),
      chatId: originChatId,
      assistantId: originAssistantId,
    };
  }
  if (originChatTitle) {
    return {
      label: t({
        id: "assistant.welcome.delegated.origin",
        message: `From ${originChatTitle}`,
      }),
      chatId: originChatId,
      assistantId: originAssistantId,
    };
  }
  if (originChatId) {
    return {
      label: t({
        id: "assistant.welcome.delegated.origin.deleted",
        message: "From a conversation that no longer exists",
      }),
    };
  }
  return null;
};
