import { t } from "@lingui/core/macro";

import { CHAT_HISTORY_ROW_MENU_ID } from "@/components/ui/Chat/chatHistoryRowMenuIds";

import { confirmLabels } from "./confirmLabels";

import type { MenuEntry } from "./menuEntry";
import type { ChatHistoryRowMenuId } from "@/components/ui/Chat/chatHistoryRowMenuIds";
import type { ChatAttentionStatus } from "@/utils/chatHistoryGrouping";

/** What the gates read, for a row that is not a `ChatSession`. */
export interface RowMenuState {
  archived: boolean;
  isPinned: boolean;
  canEdit: boolean;
  isRun: boolean;
  status: ChatAttentionStatus | null;
  waitingOnly: boolean;
}

export interface RowMenuGates {
  pinnedChatsCount: number;
  pinnedChatsLimit: number;
  /** The actions the surface handles; an entry without one is left out. */
  handles: Readonly<Partial<Record<ChatHistoryRowMenuId, boolean>>>;
}

/** Archive or unarchive, and the confirm rule, wherever a chat is listed. */
export function describeArchiveEntries({
  archived,
  status,
  waitingOnly = false,
  handles,
}: {
  archived: boolean;
  status: ChatAttentionStatus | null;
  /** The chat is parked, waiting for an app or its tasks, which shows no status. */
  waitingOnly?: boolean;
  handles: RowMenuGates["handles"];
}): MenuEntry[] {
  if (archived) {
    return handles.unarchive
      ? [
          {
            id: CHAT_HISTORY_ROW_MENU_ID.unarchive,
            label: unarchiveActionLabel(),
            icon: { name: "unarchive" },
          },
        ]
      : [];
  }
  if (!handles.archive) return [];

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
        : waitingOnly
          ? t({
              id: "chat.history.menu.confirm_archive.waiting",
              message:
                "This chat is waiting for a connected app or for its tasks. Archiving abandons the wait, and unarchiving will not resume the response.",
            })
          : null;

  return [
    {
      id: CHAT_HISTORY_ROW_MENU_ID.archive,
      label: t({ id: "chat.history.menu.remove", message: "Archive" }),
      icon: { name: "archive" },
      ...(warning != null
        ? {
            confirm: {
              title: t({
                id: "chat.history.menu.confirm_remove.title",
                message: "Archive this chat?",
              }),
              message: warning,
              ...confirmLabels(),
            },
          }
        : {}),
    },
  ];
}

export const unarchiveActionLabel = () =>
  t({ id: "chat.history.menu.unarchive", message: "Unarchive" });

/**
 * The row's menu, already gated. A caller draws the entries as they come;
 * nothing it leaves out can drop a rule.
 */
export function describeRowMenu(
  { archived, isPinned, canEdit, isRun, status, waitingOnly }: RowMenuState,
  { pinnedChatsCount, pinnedChatsLimit, handles }: RowMenuGates,
): MenuEntry[] {
  const isPinLimitReached = !isPinned && pinnedChatsCount >= pinnedChatsLimit;
  const pinLabel = isPinLimitReached
    ? t({
        id: "chat.history.menu.pinLimitReached",
        message: "Pin limit reached",
      })
    : isPinned
      ? t({ id: "chat.history.menu.unpin", message: "Unpin" })
      : t({ id: "chat.history.menu.pin", message: "Pin" });

  const entries: MenuEntry[] = [];
  if (handles.pin && !archived) {
    entries.push({
      id: CHAT_HISTORY_ROW_MENU_ID.pin,
      label: pinLabel,
      icon: { name: isPinned ? "unpin" : "pin" },
      ...(!canEdit || isPinLimitReached ? { disabled: true } : {}),
    });
  }
  if (handles.share && !archived) {
    entries.push({
      id: CHAT_HISTORY_ROW_MENU_ID.share,
      label: t({ id: "chat.share.button", message: "Share" }),
      icon: { name: "share" },
      ...(!canEdit ? { disabled: true } : {}),
    });
  }
  if (handles.rename) {
    entries.push({
      id: CHAT_HISTORY_ROW_MENU_ID.rename,
      label: t({ id: "chat.history.menu.rename", message: "Rename" }),
      icon: { name: "rename" },
      ...(!canEdit ? { disabled: true } : {}),
    });
  }
  // Runs get neither: archiving cannot cancel a live generation or free a
  // parked approval, and cleanup re-archives unadopted runs.
  if (!isRun) {
    entries.push(
      ...describeArchiveEntries({
        archived,
        status,
        waitingOnly,
        handles,
      }),
    );
  }
  return entries;
}
