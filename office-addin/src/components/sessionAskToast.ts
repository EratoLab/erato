import { toast, type ToastAction } from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

interface RecentChatSummary {
  id: string;
  title: string | null;
}

export interface ShowSessionAskToastParams {
  suggestedChat: RecentChatSummary | null;
  recentChats: readonly RecentChatSummary[];
  onResume: (chatId: string) => void;
  onPickRecent: (chatId: string) => void;
  onNew: () => void;
}

const DEDUPE_KEY = "outlook-session-ask";
const PICK_DEDUPE_KEY = "outlook-session-pick";
const MAX_RECENT_OPTIONS = 4;

const defaultChatTitle = () =>
  t({
    id: "officeAddin.sessionAsk.untitledChat",
    message: "Untitled chat",
  });

/**
 * Show the "switched conversation, what now?" toast. Three actions:
 *
 * - **Continue** — resume the suggested chat (the one that was active before
 *   the switch). Hidden when there is no suggested chat.
 * - **Pick from recent** — opens a follow-up toast listing the most recent
 *   chats as buttons. Hidden when there's only the suggested chat to choose.
 * - **New** — start a fresh chat for the new context.
 *
 * Deduped by key, so re-emitting (e.g. after another context change) replaces
 * the existing toast rather than stacking.
 */
export function showSessionAskToast(params: ShowSessionAskToastParams) {
  const { suggestedChat, recentChats, onResume, onPickRecent, onNew } = params;

  const recentBeyondSuggested = recentChats.filter(
    (chat) => chat.id !== suggestedChat?.id,
  );
  const showPickAction = recentBeyondSuggested.length > 0;

  const actions: ToastAction[] = [];

  if (suggestedChat) {
    actions.push({
      id: "resume",
      label: t({
        id: "officeAddin.sessionAsk.actions.continue",
        message: "Continue",
      }),
      variant: "primary",
      onClick: () => onResume(suggestedChat.id),
    });
  }

  if (showPickAction) {
    actions.push({
      id: "pick",
      label: t({
        id: "officeAddin.sessionAsk.actions.pickFromRecent",
        message: "Pick from recent",
      }),
      onClick: () => {
        showSessionPickToast({
          recentChats: recentBeyondSuggested,
          onPick: onPickRecent,
          onNew,
        });
      },
    });
  }

  actions.push({
    id: "new",
    label: t({
      id: "officeAddin.sessionAsk.actions.startNew",
      message: "Start new",
    }),
    variant: suggestedChat ? "secondary" : "primary",
    onClick: onNew,
  });

  toast.custom({
    variant: "info",
    dedupeKey: DEDUPE_KEY,
    title: t({
      id: "officeAddin.sessionAsk.title",
      message: "You switched conversation",
    }),
    description: suggestedChat
      ? t({
          id: "officeAddin.sessionAsk.descriptionWithSuggestion",
          message:
            "Continue the previous chat for this email, or start a fresh one?",
        })
      : t({
          id: "officeAddin.sessionAsk.descriptionNoSuggestion",
          message: "Start a fresh chat for this email?",
        }),
    actions,
  });
}

interface ShowSessionPickToastParams {
  recentChats: readonly RecentChatSummary[];
  onPick: (chatId: string) => void;
  onNew: () => void;
}

function showSessionPickToast(params: ShowSessionPickToastParams) {
  const { recentChats, onPick, onNew } = params;

  const options = recentChats.slice(0, MAX_RECENT_OPTIONS);
  const actions: ToastAction[] = options.map((chat) => ({
    id: `pick-${chat.id}`,
    label: chat.title?.trim() || defaultChatTitle(),
    onClick: () => onPick(chat.id),
  }));

  actions.push({
    id: "new",
    label: t({
      id: "officeAddin.sessionPick.actions.startNew",
      message: "Start new",
    }),
    variant: "primary",
    onClick: onNew,
  });

  toast.custom({
    variant: "info",
    dedupeKey: PICK_DEDUPE_KEY,
    title: t({
      id: "officeAddin.sessionPick.title",
      message: "Pick a recent chat",
    }),
    actions,
  });
}
