import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  quotedSelection,
  selectionExcerpt,
} from "../../core/selection/selectionExcerpt";
import {
  WordCommentDetail,
  WordOpenCommentsDetail,
} from "../components/WordCommentDetails";
import {
  WordDocumentDetail,
  WordSelectionDetail,
} from "../components/WordContextDetails";
import {
  wordCommentChangeDefaultText,
  wordCommentChooseText,
  wordCommentIncludeText,
  wordCommentSwitchToCommentText,
  wordCommentSwitchToPassageText,
} from "../utils/wordCommentText";

import type { WordCommentListThread } from "./useWordComments";
import type {
  WordCommentChipModel,
  WordOpenCommentsChipModel,
} from "../utils/wordCommentChips";
import type {
  WordDocumentChipModel,
  WordSelectionChipModel,
} from "../utils/wordContextChips";
import type { WordSelectionShowResult } from "../utils/wordSelectionTarget";
import type {
  ComposerContextDetailAction,
  ComposerContextItem,
} from "@erato/frontend/library";

export const WORD_SELECTION_CHIP_ID = "word-selection";
export const WORD_DOCUMENT_CHIP_ID = "word-document";
export const WORD_COMMENT_CHIP_ID = "word-comment";
export const WORD_OPEN_COMMENTS_CHIP_ID = "word-open-comments";

/**
 * Store writes only: the chips change when the resolver hands back new state. Pass stable
 * callbacks; a new one rebuilds every chip.
 */
export interface WordContextHandlers {
  dismissSelection: () => void;
  rearmSelection: () => void;
  armSelection: () => void;
  excludeDocument: () => void;
  includeDocument: () => void;
  retryDocument: () => void;
  sendDocumentInstead: () => void;
  /** "Send without comments" for the next message, or for the Send waiting on a choice. */
  withoutComments: () => void;
  /** Undoes "Send without comments" and a switch to the passage. */
  restoreComments: () => void;
  endPick: () => void;
  /** Ends a pick and sends the passage for this message. */
  sendPassageInstead: () => void;
  /** Sends the passage's one thread instead of it for this message. */
  sendCommentInstead: () => void;
  /** The document or the open comments go in place of the thread (and of a passage that would win). */
  sendInsteadOfComment: () => void;
  pickComment: (ref: string) => void;
  openPicker: () => void;
  changeDefault: () => void;
  includeOpenComments: () => void;
  excludeOpenComments: () => void;
  setPassageComments: (on: boolean) => void;
  /** Picks the thread first when `pickFirst`, so it stays the target once Word selects it. */
  showComment: (
    thread: WordCommentListThread,
    pickFirst: boolean,
  ) => Promise<WordSelectionShowResult>;
}

export interface WordContextItemsInput {
  selection: WordSelectionChipModel | null;
  document: WordDocumentChipModel | null;
  comment?: WordCommentChipModel | null;
  openComments?: WordOpenCommentsChipModel | null;
  documentName: string;
  /** The composer is locked: an archived chat, or a delegated run that is writing. */
  locked: boolean;
  reportOptions: { chatId: string | null };
  handlers: WordContextHandlers;
}

const sendInsteadText = () =>
  t({
    id: "officeAddin.word.context.sendInstead",
    message: "Send this instead",
  });

const lockReasonText = () =>
  t({
    id: "officeAddin.word.context.document.lockReason",
    message:
      "Can't change this while the chat is archived or a task is running",
  });

const passageInsteadAnnouncement = () =>
  t({
    id: "officeAddin.word.context.comment.announce.passageInstead",
    message: "Selection included. The comment is not sent with this message.",
  });

/**
 * The Word chips for the composer's lane, in the design's order: the selection, the document, the
 * comment, the open comments.
 */
export function useWordContextItems({
  selection,
  document,
  comment = null,
  openComments = null,
  documentName,
  locked,
  reportOptions,
  handlers,
}: WordContextItemsInput): ComposerContextItem[] {
  const {
    dismissSelection,
    rearmSelection,
    armSelection,
    excludeDocument,
    includeDocument,
    retryDocument,
    sendDocumentInstead,
    withoutComments,
    restoreComments,
    endPick,
    sendPassageInstead,
    sendCommentInstead,
    sendInsteadOfComment,
    pickComment,
    openPicker,
    changeDefault,
    includeOpenComments,
    excludeOpenComments,
    setPassageComments,
    showComment,
  } = handlers;
  // The models are plain data and hold everything a detail draws, so an open detail never shows
  // stale text, and an unrelated re-render keeps the same array.
  const modelKey = JSON.stringify([
    selection,
    document,
    comment,
    openComments,
    documentName,
    locked,
  ]);
  return useMemo(() => {
    const items: ComposerContextItem[] = [];
    const chooseAction: ComposerContextDetailAction = {
      id: "choose",
      label: wordCommentChooseText(),
      onSelect: openPicker,
    };
    const changeDefaultAction: ComposerContextDetailAction = {
      id: "change-default",
      label: wordCommentChangeDefaultText(),
      onSelect: changeDefault,
    };
    const lockedProps = locked
      ? { locked: true, lockReason: lockReasonText() }
      : {};

    if (selection) {
      const restore =
        selection.restore === "arm"
          ? armSelection
          : selection.restore === "rearm-and-arm"
            ? () => {
                rearmSelection();
                armSelection();
              }
            : rearmSelection;
      const switchTo = selection.comments?.switchTo ?? null;
      const actions: ComposerContextDetailAction[] = selection.actions.map(
        (action) => {
          switch (action) {
            case "send-instead":
              return {
                id: "send-instead",
                label: sendInsteadText(),
                variant: "primary",
                announcement: passageInsteadAnnouncement(),
                onSelect: sendPassageInstead,
              };
            case "comment-instead": {
              const author = switchTo?.author ?? "";
              return {
                id: "comment-instead",
                label: wordCommentSwitchToCommentText(author),
                announcement: t({
                  id: "officeAddin.word.context.comment.announce.commentInstead",
                  message: `Comment by ${author} included. It is sent instead of the passage.`,
                }),
                onSelect: sendCommentInstead,
              };
            }
            case "choose":
              return chooseAction;
            case "change-default":
              return changeDefaultAction;
          }
        },
      );
      items.push({
        id: WORD_SELECTION_CHIP_ID,
        kind: "word.selection",
        origin: "ambient",
        dismissScope: "selection",
        icon: "selection",
        state: selection.state,
        ...(selection.tone ? { tone: selection.tone } : {}),
        ...(selection.toneIcon ? { toneIcon: selection.toneIcon } : {}),
        ...(selection.meta ? { meta: selection.meta } : {}),
        label: quotedSelection(selectionExcerpt(selection.text)),
        spokenLabel: t({
          id: "officeAddin.word.context.selection.spoken",
          message: "Selection",
        }),
        ...(selection.removeLabel
          ? { onRemove: dismissSelection, removeLabel: selection.removeLabel }
          : {}),
        ...(selection.state === "suggested"
          ? { onRestore: restore, restoreLabel: selection.restoreLabel }
          : {}),
        ...(selection.restoredAnnouncement
          ? { announcements: { restored: selection.restoredAnnouncement } }
          : {}),
        detail: {
          title: selection.title,
          render: (context) => (
            <WordSelectionDetail
              model={selection}
              locked={context.locked}
              onSetPassageComments={setPassageComments}
            />
          ),
          ...(actions.length > 0 ? { actions } : {}),
        },
      });
    }
    if (document) {
      const label =
        documentName ||
        t({
          id: "officeAddin.word.context.document.unnamed",
          message: "This document",
        });
      // A locked chat keeps its document choice, and "Send this instead" would include it; a read
      // changes nothing that is sent, so "Try again" stays.
      const offered = locked
        ? document.actions.filter(
            (action) =>
              action !== "send-instead" && action !== "send-instead-of-comment",
          )
        : document.actions;
      const passageReplaced = selection?.state === "superseded";
      const actions: ComposerContextDetailAction[] = offered.map((action) => {
        switch (action) {
          case "send-instead":
            return {
              id: "send-instead",
              label: sendInsteadText(),
              variant: "primary",
              announcement: t({
                id: "officeAddin.word.context.document.announce.sentInstead",
                message:
                  "Document included. Your selection is off until it changes.",
              }),
              onSelect: sendDocumentInstead,
            };
          case "send-instead-of-comment":
            return {
              id: "send-instead",
              label: sendInsteadText(),
              variant: "primary",
              announcement: passageReplaced
                ? t({
                    id: "officeAddin.word.context.document.announce.sentInstead",
                    message:
                      "Document included. Your selection is off until it changes.",
                  })
                : t({
                    id: "officeAddin.word.context.document.announce.sentInsteadOfComment",
                    message:
                      "Document included. The comment is not sent with this message.",
                  }),
              onSelect: sendInsteadOfComment,
            };
          case "include-comments":
            return {
              id: "include-comments",
              label: wordCommentIncludeText(),
              onSelect: restoreComments,
            };
          case "choose":
            return chooseAction;
          case "retry":
            return {
              id: "retry",
              label: t({
                id: "officeAddin.word.context.retry",
                message: "Try again",
              }),
              variant: "primary",
              announcement: t({
                id: "officeAddin.word.context.document.announce.read",
                message: "Document read.",
              }),
              onSelect: retryDocument,
            };
        }
      });
      items.push({
        id: WORD_DOCUMENT_CHIP_ID,
        kind: "word.document",
        origin: "ambient",
        dismissScope: "chat",
        icon: "document",
        state: document.state,
        ...(document.tone ? { tone: document.tone } : {}),
        ...(document.meta ? { meta: document.meta } : {}),
        label,
        spokenLabel: t({
          id: "officeAddin.word.context.document.spoken",
          message: "Document",
        }),
        ...lockedProps,
        ...(document.state === "suggested"
          ? {
              onRestore:
                document.restore === "include-and-retry"
                  ? () => {
                      // Reading first, so the chip goes to loading, never to its old error.
                      retryDocument();
                      includeDocument();
                    }
                  : includeDocument,
              restoreLabel: document.restoreLabel,
            }
          : { onRemove: excludeDocument, removeLabel: document.removeLabel }),
        detail: {
          title: label,
          render: () => (
            <WordDocumentDetail
              model={document}
              reportOptions={reportOptions}
            />
          ),
          ...(actions.length > 0 ? { actions } : {}),
        },
      });
    }
    if (comment) {
      const actions: ComposerContextDetailAction[] = comment.actions.map(
        (action) => {
          switch (action) {
            case "choose":
              return chooseAction;
            case "passage-instead":
              return {
                id: "passage-instead",
                label: wordCommentSwitchToPassageText(),
                announcement: passageInsteadAnnouncement(),
                onSelect: sendPassageInstead,
              };
            case "change-default":
              return changeDefaultAction;
          }
        },
      );
      const suggested = comment.state === "suggested";
      const control = suggested
        ? { onRestore: restoreComments, restoreLabel: comment.restoreLabel }
        : {
            onRemove:
              comment.removeAction === "end-pick" ? endPick : withoutComments,
            removeLabel: comment.removeLabel,
            removeActionLabel: comment.removeLabel,
          };
      const base = {
        id: WORD_COMMENT_CHIP_ID,
        kind: "word.comment",
        // A choice turns the caret's comment into the user's, in the same place before open comments.
        placement: "ambient",
        icon: comment.variant === "choose" ? "comments" : "comment",
        state: comment.state,
        ...(comment.tone ? { tone: comment.tone } : {}),
        ...(comment.meta ? { meta: comment.meta } : {}),
        label: comment.label,
        spokenLabel: comment.spokenLabel,
        ...control,
        ...(comment.removedAnnouncement
          ? { announcements: { removed: comment.removedAnnouncement } }
          : {}),
        detail: {
          title: comment.detail.title,
          render: (context) => (
            <WordCommentDetail
              model={comment}
              context={context}
              onShowInWord={(thread) =>
                showComment(thread, comment.detail.showInWordPicks)
              }
              onPick={pickComment}
              onOpenPicker={openPicker}
            />
          ),
          ...(actions.length > 0 ? { actions } : {}),
        },
      } satisfies Omit<ComposerContextItem, "origin" | "dismissScope">;
      items.push(
        comment.origin === "user"
          ? { ...base, origin: "user" }
          : { ...base, origin: "ambient", dismissScope: "message" },
      );
    }
    if (openComments) {
      const offered = locked
        ? openComments.actions.filter((action) => action !== "send-instead")
        : openComments.actions;
      const actions: ComposerContextDetailAction[] = offered.map((action) =>
        action === "choose"
          ? chooseAction
          : {
              id: "send-instead",
              label: sendInsteadText(),
              variant: "primary",
              announcement: openComments.sendInsteadDismissesSelection
                ? t({
                    id: "officeAddin.word.context.openComments.announce.sentInsteadOfSelection",
                    message:
                      "Open comments included. Your selection is off until it changes.",
                  })
                : t({
                    id: "officeAddin.word.context.openComments.announce.sentInstead",
                    message:
                      "Open comments included. The comment is not sent with this message.",
                  }),
              onSelect: sendInsteadOfComment,
            },
      );
      items.push({
        id: WORD_OPEN_COMMENTS_CHIP_ID,
        kind: "word.openComments",
        origin: "ambient",
        dismissScope: "chat",
        icon: "comments",
        state: openComments.state,
        ...(openComments.tone ? { tone: openComments.tone } : {}),
        ...(openComments.meta ? { meta: openComments.meta } : {}),
        label: openComments.label,
        spokenLabel: t({
          id: "officeAddin.word.context.openComments.spoken",
          message: "Open comments",
        }),
        ...lockedProps,
        ...(openComments.state === "suggested"
          ? openComments.restore
            ? {
                onRestore:
                  openComments.restore === "restore-comments"
                    ? restoreComments
                    : includeOpenComments,
                restoreLabel: openComments.restoreLabel,
              }
            : {}
          : {
              onRemove: excludeOpenComments,
              removeLabel: openComments.removeLabel,
              removeActionLabel: openComments.removeLabel,
            }),
        detail: {
          title: openComments.label,
          render: () => <WordOpenCommentsDetail model={openComments} />,
          ...(actions.length > 0 ? { actions } : {}),
        },
      });
    }
    return items;
    // The models are compared by content; modelKey stands for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    modelKey,
    reportOptions,
    dismissSelection,
    rearmSelection,
    armSelection,
    excludeDocument,
    includeDocument,
    retryDocument,
    sendDocumentInstead,
    withoutComments,
    restoreComments,
    endPick,
    sendPassageInstead,
    sendCommentInstead,
    sendInsteadOfComment,
    pickComment,
    openPicker,
    changeDefault,
    includeOpenComments,
    excludeOpenComments,
    setPassageComments,
    showComment,
  ]);
}
