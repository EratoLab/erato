import {
  MessageTimestamp,
  toast,
  type ToastAction,
} from "@erato/frontend/library";
import { t } from "@lingui/core/macro";

interface RecentChatSummary {
  id: string;
  title: string | null;
  /** ISO timestamp of the chat's last message, used for the picker subline. */
  lastMessageAt: string | null;
}

export interface ShowSessionAskToastParams {
  suggestedChat: RecentChatSummary | null;
  recentChats: readonly RecentChatSummary[];
  onResume: (chatId: string) => void;
  onPickRecent: (chatId: string) => void;
  onNew: () => void;
}

const DEDUPE_KEY = "outlook-session-ask";
const ASK_TOAST_ID = `${DEDUPE_KEY}-toast`;
const PICK_DEDUPE_KEY = "outlook-session-pick";
const PICK_TOAST_ID = `${PICK_DEDUPE_KEY}-toast`;
const MAX_RECENT_OPTIONS = 6;

/**
 * Dismiss any open ask/pick toast. Call this from the policy when it decides
 * that the prompt is no longer relevant (e.g. the user navigated back to the
 * original conversation without clicking anything in the toast).
 */
export function dismissSessionToasts() {
  toast.dismiss(ASK_TOAST_ID);
  toast.dismiss(PICK_TOAST_ID);
}

const defaultChatTitle = () =>
  t({
    id: "officeAddin.sessionAsk.untitledChat",
    message: "Untitled chat",
  });

const sidebarRowStyle = {
  minHeight: "var(--theme-spacing-sidebar-row-height)",
  borderRadius: "var(--theme-radius-shell)",
} as const;

/**
 * Show the "switched conversation, what now?" toast. Three actions:
 *
 * - **Continue** — resume the suggested chat (the one that was active before
 *   the switch). Hidden when there is no suggested chat.
 * - **Pick** — opens a follow-up toast listing the most recent chats as
 *   sidebar-styled rows. Hidden when there's only the suggested chat to
 *   choose.
 * - **New** — start a fresh chat for the new context.
 *
 * Deduped by key, so re-emitting (e.g. after another context change) replaces
 * the existing toast rather than stacking.
 */
export function showSessionAskToast(params: ShowSessionAskToastParams) {
  const { suggestedChat, recentChats, onResume, onNew } = params;

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
        id: "officeAddin.sessionAsk.actions.pick",
        message: "Pick",
      }),
      onClick: () => {
        showSessionPickToast(params);
      },
    });
  }

  actions.push({
    id: "new",
    label: t({
      id: "officeAddin.sessionAsk.actions.new",
      message: "New",
    }),
    variant: suggestedChat ? "secondary" : "primary",
    onClick: onNew,
  });

  toast.custom({
    id: ASK_TOAST_ID,
    variant: "info",
    hideIcon: true,
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

interface RecentChatPickerProps {
  chats: readonly RecentChatSummary[];
  onPick: (chatId: string) => void;
}

function RecentChatPicker({ chats, onPick }: RecentChatPickerProps) {
  const dismissPicker = () => toast.dismiss(PICK_TOAST_ID);

  return (
    <div className="-mx-1 mt-1 flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-1">
      {chats.map((chat) => {
        const title = chat.title?.trim() || defaultChatTitle();
        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => {
              onPick(chat.id);
              dismissPicker();
            }}
            title={title}
            style={sidebarRowStyle}
            className="theme-transition flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-[var(--theme-shell-sidebar-hover)] focus-visible:bg-[var(--theme-shell-sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
          >
            <span className="truncate text-sm font-medium text-theme-fg-primary">
              {title}
            </span>
            {chat.lastMessageAt ? (
              <span className="text-xs text-theme-fg-secondary">
                <MessageTimestamp createdAt={new Date(chat.lastMessageAt)} />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function showSessionPickToast(askParams: ShowSessionAskToastParams) {
  const { suggestedChat, recentChats, onPickRecent } = askParams;
  const recentBeyondSuggested = recentChats.filter(
    (chat) => chat.id !== suggestedChat?.id,
  );
  const options = recentBeyondSuggested.slice(0, MAX_RECENT_OPTIONS);

  toast.custom({
    id: PICK_TOAST_ID,
    variant: "info",
    hideIcon: true,
    dedupeKey: PICK_DEDUPE_KEY,
    title: t({
      id: "officeAddin.sessionPick.title",
      message: "Pick a recent chat",
    }),
    description: <RecentChatPicker chats={options} onPick={onPickRecent} />,
    actions: [
      {
        id: "back",
        label: t({
          id: "officeAddin.sessionPick.actions.back",
          message: "Back",
        }),
        onClick: () => {
          showSessionAskToast(askParams);
        },
      },
    ],
  });
}
