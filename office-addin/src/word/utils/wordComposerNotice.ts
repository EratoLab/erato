import { t } from "@lingui/core/macro";

import { wordAuthoringIssueText } from "./wordAuthoringMessages";
import {
  wordCommentChooseText,
  wordCommentReadingCountText,
  wordCommentReadingText,
  wordCommentSendWithoutText,
} from "./wordCommentText";

import type { WordCommentBlock } from "./wordCommentSend";
import type { ComposerNotice } from "@erato/frontend/library";

export type WordCaptureNotice = "previous-capture" | "not-included";
export type WordBudgetNotice = "model-budget" | "budget-unavailable";

export interface WordComposerNoticeState {
  /** A Send waits on the user. */
  commentBlock: WordCommentBlock | null;
  /** The thread facet is advertised, so the picker can answer a block. */
  threadAdvertised: boolean;
  /** The document chip is on: the capture prompts concern it. */
  chipEnabled: boolean;
  /** The Send has waited long for Word to hand over the document. */
  slowCapture: boolean;
  commentProgress: { done: number; total: number } | null;
  selectionReadFailed: boolean;
  captureNotice: WordCaptureNotice | null;
  budgetIssue: WordBudgetNotice | undefined;
  budgetDetails?: readonly string[];
  /** Notices the user dismissed since the last Send. */
  dismissed: ReadonlySet<string>;
}

export interface WordComposerNoticeHandlers {
  openPicker: () => void;
  sendWithoutComments: () => void;
  sendWithoutDocument: () => void;
  dismissSelectionReadFailed: () => void;
  dismiss: (id: string) => void;
}

/**
 * The one-off prompt of the Word composer's send, one at a time and first match first: a Send that
 * waits on the user, then the slow capture, the comment reads, a failed selection read, and the
 * notes the last Send left. Null when there is none.
 */
export function wordComposerNotice(
  state: WordComposerNoticeState,
  handlers: WordComposerNoticeHandlers,
): ComposerNotice | null {
  const sendWithout = {
    id: "send-without-comments",
    label: wordCommentSendWithoutText(),
    onSelect: handlers.sendWithoutComments,
  };
  const choose = {
    id: "choose-comment",
    label: wordCommentChooseText(),
    onSelect: handlers.openPicker,
  };
  const blockActions = state.threadAdvertised
    ? [choose, sendWithout]
    : [sendWithout];

  switch (state.commentBlock) {
    case "choose-comment":
      return {
        id: "word.comments.block.choose",
        tone: "warning",
        text: t({
          id: "officeAddin.word.comments.blocked.chooseComment",
          message:
            "Your cursor is in more than one comment, so Erato does not know which one you mean.",
        }),
        actions: blockActions,
      };
    case "picked-gone":
      return {
        id: "word.comments.block.gone",
        tone: "warning",
        text: t({
          id: "officeAddin.word.comments.blocked.pickedGone",
          message: "The comment you chose is no longer in the document.",
        }),
        actions: blockActions,
      };
    case "read-failed":
      return {
        id: "word.comments.block.readFailed",
        tone: "error",
        text: t({
          id: "officeAddin.word.comments.blocked.readFailed",
          message: "Erato could not read the comments in Word.",
        }),
        actions: [sendWithout],
      };
    default:
      break;
  }

  if (state.chipEnabled && state.slowCapture)
    return {
      id: "word.send.slowCapture",
      tone: "info",
      busy: true,
      text: t({
        id: "officeAddin.word.send.stillReading",
        message: "Word is still handing over the document.",
      }),
      actions: [
        {
          id: "send-without-document",
          label: t({
            id: "officeAddin.word.send.withoutDocument",
            message: "Send without document",
          }),
          onSelect: handlers.sendWithoutDocument,
        },
      ],
    };

  if (state.commentProgress)
    return {
      id: "word.comments.progress",
      tone: "info",
      busy: true,
      text: wordCommentReadingText(null),
      ...(state.commentProgress.total > 0
        ? { progressLabel: wordCommentReadingCountText(state.commentProgress) }
        : {}),
    };

  if (state.selectionReadFailed)
    return {
      id: "word.selection.readFailed",
      tone: "error",
      text: t({
        id: "officeAddin.word.selection.readFailed",
        message:
          "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
      }),
      onDismiss: handlers.dismissSelectionReadFailed,
    };

  if (state.chipEnabled && state.captureNotice) {
    const id =
      state.captureNotice === "previous-capture"
        ? "word.send.previousCapture"
        : "word.send.notIncluded";
    if (!state.dismissed.has(id))
      return {
        id,
        tone: "warning",
        text:
          state.captureNotice === "previous-capture"
            ? t({
                id: "officeAddin.word.send.previousCapture",
                message:
                  "Reading the document took too long, so Erato used an earlier copy. Recent edits may be missing.",
              })
            : t({
                id: "officeAddin.word.send.notIncluded",
                message:
                  "Reading the document took too long, so this message was sent without it.",
              }),
        onDismiss: () => handlers.dismiss(id),
      };
  }

  if (state.chipEnabled && state.budgetIssue) {
    const id = `word.send.budget.${state.budgetIssue}`;
    if (!state.dismissed.has(id))
      return {
        id,
        tone: "warning",
        text: wordAuthoringIssueText(state.budgetIssue, state.budgetDetails),
        onDismiss: () => handlers.dismiss(id),
      };
  }

  return null;
}
