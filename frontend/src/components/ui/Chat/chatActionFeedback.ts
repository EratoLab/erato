import { t } from "@lingui/core/macro";

import { toast } from "../Toast/toast";

export type ChatAction = "rename" | "archive" | "unarchive" | "pin" | "unpin";

const failureTitle = (action: ChatAction) => {
  switch (action) {
    case "rename":
      return t({
        id: "chat.history.renameFailed",
        message: "Couldn't rename the chat",
      });
    case "archive":
      return t({
        id: "chat.history.archiveFailed",
        message: "Couldn't archive the chat",
      });
    case "unarchive":
      return t({
        id: "chat.history.unarchiveFailed",
        message: "Couldn't unarchive the chat",
      });
    case "pin":
      return t({
        id: "chat.history.pinFailed",
        message: "Couldn't pin the chat",
      });
    case "unpin":
      return t({
        id: "chat.history.unpinFailed",
        message: "Couldn't unpin the chat",
      });
  }
};

// Error toasts stay until dismissed, so each chat gets one slot per action
// that a retry from any surface replaces or retracts.
const toastKey = (action: ChatAction, chatId: string) =>
  `chat-${action === "unpin" ? "pin" : action}:${chatId}`;

export const dismissChatActionFailure = (action: ChatAction, chatId: string) =>
  toast.dismissKey(toastKey(action, chatId));

// Resolves whether the action worked. A failed one leaves the row as it was (a
// failed archive puts it back), so the toast is the only signal.
export async function runChatAction(
  action: ChatAction,
  chatId: string,
  perform: () => Promise<unknown>,
): Promise<boolean> {
  dismissChatActionFailure(action, chatId);
  try {
    await perform();
  } catch {
    toast.error({
      dedupeKey: toastKey(action, chatId),
      title: failureTitle(action),
    });
    return false;
  }
  dismissChatActionFailure(action, chatId);
  return true;
}
