import { t } from "@lingui/core/macro";

import { ArchiveIcon, UndoIcon } from "../icons";

import type { DropdownMenuItem } from "../Controls/DropdownMenu";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

export const archivedChatLabel = () =>
  t({ id: "chat.history.item.archived", message: "Archived" });

export const unarchiveActionLabel = () =>
  t({ id: "chat.history.menu.unarchive", message: "Unarchive" });

export const ArchivedChatPill = ({ label }: { label: string }) => (
  <span
    className="pill-geometry inline-flex shrink-0 items-center border border-theme-border bg-theme-bg-secondary px-2 py-0.5 text-xs font-medium text-theme-fg-muted"
    data-testid="chat-history-item-archived"
  >
    {label}
  </span>
);

/**
 * The archive/unarchive pair, shared so the sidebar list and the search page
 * cannot drift apart on labels, test ids or the confirm rule.
 */
export const buildArchiveMenuItems = ({
  archived,
  status,
  onArchive,
  onUnarchive,
}: {
  archived: boolean;
  status: ChatAttentionStatus | null;
  onArchive?: () => void;
  onUnarchive?: () => void;
}): DropdownMenuItem[] => {
  if (archived) {
    return [
      {
        label: unarchiveActionLabel(),
        icon: <UndoIcon className="size-4" />,
        onClick: onUnarchive ?? (() => {}),
        testId: "chat-history-menu-unarchive",
      },
    ];
  }

  // Archiving is reversible, so only work already under way is worth asking
  // about — that is the part unarchiving cannot put back.
  const warning =
    status === "running"
      ? t({
          id: "chat.history.menu.confirm_archive.running",
          message:
            "This chat is still generating. Archiving will not stop the response.",
        })
      : status === "action_required"
        ? t({
            id: "chat.history.menu.confirm_archive.action_required",
            message:
              "This chat is waiting for a tool approval. Archiving abandons it, and unarchiving will not resume the response.",
          })
        : null;

  return [
    {
      label: t({ id: "chat.history.menu.remove", message: "Archive" }),
      icon: <ArchiveIcon className="size-4" />,
      onClick: onArchive ?? (() => {}),
      testId: "chat-history-menu-archive",
      confirmAction: warning != null,
      confirmTitle: t({
        id: "chat.history.menu.confirm_remove.title",
        message: "Archive this chat?",
      }),
      confirmMessage: warning ?? undefined,
    },
  ];
};
