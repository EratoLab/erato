import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  quotedSelection,
  selectionExcerpt,
} from "../../core/selection/selectionExcerpt";
import {
  WordDocumentDetail,
  WordSelectionDetail,
} from "../components/WordContextDetails";

import type {
  WordDocumentChipModel,
  WordSelectionChipModel,
} from "../utils/wordContextChips";
import type {
  ComposerContextDetailAction,
  ComposerContextItem,
} from "@erato/frontend/library";

export const WORD_SELECTION_CHIP_ID = "word-selection";
export const WORD_DOCUMENT_CHIP_ID = "word-document";

/** Store writes only: the chips change when the resolver hands back new state. */
export interface WordContextHandlers {
  dismissSelection: () => void;
  rearmSelection: () => void;
  armSelection: () => void;
  excludeDocument: () => void;
  includeDocument: () => void;
  retryDocument: () => void;
  sendDocumentInstead: () => void;
}

export interface WordContextItemsInput {
  selection: WordSelectionChipModel | null;
  document: WordDocumentChipModel | null;
  documentName: string;
  /** The composer is locked: an archived chat, or a delegated run that is writing. */
  locked: boolean;
  reportOptions: { chatId: string | null };
  handlers: WordContextHandlers;
}

/** The Word chips for the composer's lane: the selection first, then the document. */
export function useWordContextItems({
  selection,
  document,
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
  } = handlers;
  // The models are plain data and hold everything a detail draws, so an open detail never shows
  // stale text, and an unrelated re-render keeps the same array.
  const modelKey = JSON.stringify([selection, document, documentName, locked]);
  return useMemo(() => {
    const items: ComposerContextItem[] = [];
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
          render: () => <WordSelectionDetail model={selection} />,
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
        ? document.actions.filter((action) => action !== "send-instead")
        : document.actions;
      const actions: ComposerContextDetailAction[] = offered.map((action) =>
        action === "send-instead"
          ? {
              id: "send-instead",
              label: t({
                id: "officeAddin.word.context.sendInstead",
                message: "Send this instead",
              }),
              variant: "primary",
              announcement: t({
                id: "officeAddin.word.context.document.announce.sentInstead",
                message:
                  "Document included. Your selection is off until it changes.",
              }),
              onSelect: sendDocumentInstead,
            }
          : {
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
            },
      );
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
        ...(locked
          ? {
              locked: true,
              lockReason: t({
                id: "officeAddin.word.context.document.lockReason",
                message:
                  "Can't change this while the chat is archived or a task is running",
              }),
            }
          : {}),
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
  ]);
}
