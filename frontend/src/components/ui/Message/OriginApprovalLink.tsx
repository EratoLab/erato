import { t } from "@lingui/core/macro";
import { skipToken } from "@tanstack/react-query";

import { useChatDetail } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useDelegatedRunOpener } from "@/providers/DelegatedRunOpenProvider";
import { getChatUrl } from "@/utils/chat/urlUtils";

/**
 * Where a child's approval is actually being asked.
 *
 * This is the whole of the answer to a `409 covered_by_parent`, so it stands in
 * for the refusal rather than accompanying it: the card shows no error beside
 * it. The child card becomes answerable again by itself once the origin
 * settles, is withdrawn, or is archived.
 *
 * The origin chat is read off this chat's own provenance rather than from the
 * refusal, which names the parent message: a message id is not a route, and the
 * run already knows which conversation started it.
 */
export const OriginApprovalLink = ({
  chatId,
}: {
  chatId: string | null | undefined;
}) => {
  const openRun = useDelegatedRunOpener();
  const { data: chat } = useChatDetail(
    chatId ? { pathParams: { chatId } } : skipToken,
  );
  const label = t({
    id: "toolApproval.coveredByParent",
    message: "Decide this in the chat that started the task",
  });
  const originChatId = chat?.origin_chat_id;
  if (chat === undefined || originChatId === undefined) {
    // Nothing to navigate to (or not loaded yet). The sentence still has to be
    // said: it is the only explanation the card gives for the refusal.
    return (
      <p
        className="mt-2 text-sm text-theme-fg-secondary"
        data-testid="tool-approval-origin-notice"
      >
        {label}
      </p>
    );
  }
  if (openRun) {
    return (
      <button
        type="button"
        onClick={() => openRun(originChatId)}
        className="focus-ring-tight rounded-[var(--theme-radius-base)] text-sm text-theme-fg-secondary underline underline-offset-2 hover:text-theme-fg-primary"
        data-testid="tool-approval-origin-link"
      >
        {label}
      </button>
    );
  }
  return (
    <a
      href={getChatUrl(originChatId, chat.origin_assistant_id)}
      target="_blank"
      rel="noopener noreferrer"
      className="focus-ring-tight rounded-[var(--theme-radius-base)] text-sm text-theme-fg-secondary underline underline-offset-2 hover:text-theme-fg-primary"
      data-testid="tool-approval-origin-link"
    >
      {label}
    </a>
  );
};
