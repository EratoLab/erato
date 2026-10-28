import { useCallback, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { CopyErrorButton } from "@/components/ui/Feedback/CopyErrorButton";

import type {
  ComposerContextDetailAction,
  ComposerContextItem,
  ComposerContextTone,
} from "@/components/ui/Chat/ComposerContext/types";
import type { ReactNode } from "react";

/*
 * Word's selection and document chips as the Office add-in builds them, played
 * from data. The rules are those of office-addin/src/word/utils/wordContextChips.ts
 * and the copy is the add-in's English catalog; the add-in's tests pin the real
 * output, so these stories show the lane, not the add-in's strings.
 */

export const WORD_DOCUMENT_NAME = "Supply agreement.docx";
export const WORD_SELECTION_TEXT =
  "The Supplier shall deliver the Goods no later than the delivery date stated in the Order.\nAny delay must be notified to the Buyer in writing without undue delay.";
export const WORD_ERATO_TEXT =
  "The Buyer may audit the Supplier's records once per contract year, with 30 days' notice.";
export const WORD_LONG_PARAGRAPHS = 14;
/** The comments in the document, which its comment map lists while the document goes. */
export const WORD_COMMENT_COUNT = 12;
/** What Send carries of the long passage: its first whole paragraphs up to the send limit. */
export const WORD_LONG_SENT_PARAGRAPHS = 9;
export const WORD_LONG_TEXT = Array.from(
  { length: WORD_LONG_SENT_PARAGRAPHS },
  (_, index) =>
    `Clause ${index + 1}. The Supplier warrants that the Goods conform to the specification, are free from defects in design, material and workmanship, and remain fit for the purpose made known to it.`,
).join("\n");

type DocumentStatus =
  | "unknown"
  | "ready"
  | "reading"
  | "error"
  | "empty"
  | "noFacet"
  | "noFacetEmpty";

export interface WordStorySeed {
  /** The document's file name. */
  name?: string;
  selection?: "user" | "erato" | null;
  selectionOff?: boolean;
  selectionFailed?: boolean;
  /** Too long to send whole: only the beginning goes. */
  long?: boolean;
  documentOff?: boolean;
  status?: DocumentStatus;
  /** Where a read started by + or "Try again" lands. */
  retryLandsOn?: "ready" | "error";
  track?: boolean;
  changed?: boolean;
  readInParts?: boolean;
  bodyOnly?: boolean;
  readOnly?: boolean;
  cannotEdit?: boolean;
  coverage?: { sent: number; total: number };
  /** The first paragraph alone is over the send limit, so only its beginning goes. */
  partialParagraph?: boolean;
  /** A comment thread goes in place of the passage and the document. */
  commentReplaces?: boolean;
  commentLines?: string[];
  locked?: boolean;
}

type WordStoryState = Required<Omit<WordStorySeed, "selection">> & {
  selection: "user" | "erato" | null;
};

const DEFAULTS: WordStoryState = {
  name: WORD_DOCUMENT_NAME,
  selection: null,
  selectionOff: false,
  selectionFailed: false,
  long: false,
  documentOff: false,
  status: "ready",
  retryLandsOn: "ready",
  track: false,
  changed: false,
  readInParts: false,
  bodyOnly: false,
  readOnly: false,
  cannotEdit: false,
  coverage: { sent: 86, total: 86 },
  partialParagraph: false,
  commentReplaces: false,
  commentLines: [
    `A list of the ${WORD_COMMENT_COUNT} comments in the document: each one's author, place, status and how it starts.`,
    "If your question needs them, Erato may read the other comments in the document.",
  ],
  locked: false,
};

const READ_MS = 600;
const count = (value: number) => value.toLocaleString("en");

const excerpt = (text: string) => {
  const characters = Array.from(text.replace(/\s+/g, " ").trim());
  return characters.length > 60
    ? `${characters.slice(0, 60).join("").trimEnd()}…`
    : characters.join("");
};

interface Note {
  tone: "info" | "warning" | "error";
  text: string;
}

const DetailNote = ({ note }: { note: Note }) => (
  <div data-ui="word-context-detail-note" data-tone={note.tone}>
    <Alert role="none" type={note.tone}>
      {note.text}
    </Alert>
  </div>
);

const Section = ({
  title,
  dataUi,
  children,
}: {
  title: string;
  dataUi: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-1" data-ui={dataUi}>
    <h3 className="text-xs font-semibold text-theme-fg-secondary">{title}</h3>
    {children}
  </section>
);

const Lifetime = ({ text }: { text: string }) => (
  <p
    className="text-xs text-theme-fg-secondary"
    data-ui="word-context-detail-lifetime"
  >
    {text}
  </p>
);

const SelectionDetail = ({
  text,
  cut,
  paragraphs,
  notes,
}: {
  text: string;
  cut: boolean;
  paragraphs: string;
  notes: Note[];
}) => (
  <div className="flex flex-col gap-3">
    <blockquote
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
      tabIndex={0}
      aria-label="Selected text"
      data-ui="word-context-detail-quote"
      className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
    >
      {cut ? `${text}…` : text}
    </blockquote>
    <p className="text-xs text-theme-fg-secondary">{paragraphs}</p>
    {notes.map((note) => (
      <DetailNote key={note.text} note={note} />
    ))}
    <Lifetime text="Leaving it out lasts until the selection changes." />
  </div>
);

interface Coverage {
  heading: string;
  lines: string[];
  hint?: string;
}

const DocumentDetail = ({
  notes,
  coverage,
  comments,
  readReport,
}: {
  notes: Note[];
  coverage: Coverage | null;
  comments: string[];
  readReport?: string;
}) => (
  <div className="flex flex-col gap-3">
    {notes.map((note) => (
      <DetailNote key={note.text} note={note} />
    ))}
    {coverage && (
      <Section title={coverage.heading} dataUi="word-context-detail-coverage">
        {coverage.lines.slice(0, 1).map((line) => (
          <p key={line}>{line}</p>
        ))}
        {coverage.hint && (
          <p className="text-xs text-theme-fg-secondary">{coverage.hint}</p>
        )}
        {coverage.lines.slice(1).map((line) => (
          <p key={line} className="text-xs text-theme-fg-secondary">
            {line}
          </p>
        ))}
      </Section>
    )}
    {comments.length > 0 && (
      <Section title="Comments" dataUi="word-context-detail-comments">
        {comments.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </Section>
    )}
    {readReport && <CopyErrorButton report={readReport} />}
    <Lifetime text="Leaving it out lasts for this chat. New chats follow your setting “Include the open document in new chats”." />
  </div>
);

const TRACKING_NOTE =
  "Track Changes is on, so Erato reads this document as if every tracked change were accepted, without seeing who changed what, and doesn't edit it.";
const READ_ONLY_NOTE =
  "This file is too large for Erato to open completely. Erato receives only the included text and can reword it, but not change its structure or formatting.";
const CANNOT_EDIT_NOTE =
  "Word did not supply a complete editable structure for this document. No rewrite was applied.";
const BODY_ONLY_NOTE =
  "Word for the web didn't hand over the complete file, for example because the document has a sensitivity label. Erato read the body only, so it can't change headers, footers or page layout, and any change replaces the whole body instead of editing passages in place.";
const READ_REPORT =
  "Word add-in document read failed\nStatus: unreadable\nError: GeneralException: The operation failed because of a backend error.";
const SELECT_LATER_PART =
  "Only the beginning is sent. To work on a later part, select it in Word.";

export interface WordStorySimulations {
  selectPassage: () => void;
  eratoShowsPassage: () => void;
  clearSelection: () => void;
  editDocument: () => void;
  toggleTrackChanges: () => void;
  failNextRead: () => void;
}

/**
 * Plays the add-in's resolver: (x) and (+) change the story's state and both
 * chips are derived from it again, as `previewWordSend()` does in the add-in.
 */
export const useWordStoryResolver = (
  seed: WordStorySeed,
): { items: ComposerContextItem[]; simulate: WordStorySimulations } => {
  const [state, setState] = useState<WordStoryState>(() => ({
    ...DEFAULTS,
    ...seed,
  }));
  const timer = useRef<number | null>(null);

  const read = useCallback(() => {
    setState((current) => ({ ...current, status: "reading" }));
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setState((current) => ({ ...current, status: current.retryLandsOn }));
    }, READ_MS);
  }, []);

  const simulate = useMemo<WordStorySimulations>(
    () => ({
      selectPassage: () =>
        setState((current) => ({
          ...current,
          selection: "user",
          selectionOff: false,
          selectionFailed: false,
          long: false,
        })),
      eratoShowsPassage: () =>
        setState((current) => ({
          ...current,
          selection: "erato",
          selectionOff: false,
          selectionFailed: false,
          long: false,
        })),
      clearSelection: () =>
        setState((current) => ({ ...current, selection: null })),
      editDocument: () =>
        setState((current) => ({ ...current, changed: true })),
      toggleTrackChanges: () =>
        setState((current) => ({ ...current, track: !current.track })),
      failNextRead: () =>
        setState((current) => ({ ...current, retryLandsOn: "error" })),
    }),
    [],
  );

  const items = useMemo(() => {
    const result: ComposerContextItem[] = [];
    const passageGoes = state.selection === "user" && !state.selectionOff;
    const documentGoes =
      !state.documentOff &&
      !passageGoes &&
      !state.commentReplaces &&
      (state.status === "ready" || state.status === "empty");

    if (state.selection) {
      const text =
        state.selection === "erato"
          ? WORD_ERATO_TEXT
          : state.long
            ? WORD_LONG_TEXT
            : WORD_SELECTION_TEXT;
      const erato = state.selection === "erato";
      const paragraphCount = state.long
        ? WORD_LONG_PARAGRAPHS
        : text.split("\n").length;
      const counted = `${count(paragraphCount)} ${paragraphCount === 1 ? "paragraph" : "paragraphs"}`;
      let paragraphs = erato
        ? `${counted} · Shown by Erato after Show in Word`
        : counted;
      const notes: Note[] = [];
      let selectionActions: ComposerContextDetailAction[] = [];
      let item: Partial<ComposerContextItem> & {
        state: ComposerContextItem["state"];
      };
      if (state.selectionOff || erato) {
        if (erato)
          notes.push({
            tone: "info",
            text: "Erato selected this passage. It is shown, but not sent until you use it.",
          });
        item = {
          state: "suggested",
          ...(erato && !state.selectionOff
            ? { meta: `Shown by Erato · ${count(paragraphCount)} ¶` }
            : {}),
          restoreLabel: erato ? "Use this selection" : "Include selection",
          onRestore: () =>
            setState((current) => ({
              ...current,
              selection: "user",
              selectionOff: false,
            })),
        };
      } else if (state.selectionFailed) {
        notes.push({
          tone: "error",
          text: "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
        });
        item = {
          state: "error",
          tone: "error",
          meta: "Couldn't read · send again",
        };
      } else if (state.commentReplaces) {
        notes.push({
          tone: "info",
          text: "A comment is sent instead of this passage.",
        });
        item = { state: "superseded", meta: "Replaced by comment" };
        selectionActions = [
          {
            id: "send-instead",
            label: "Send this instead",
            variant: "primary",
            announcement:
              "Selection included. The comment is not sent with this message.",
            onSelect: () =>
              setState((current) => ({ ...current, commentReplaces: false })),
          },
        ];
      } else {
        if (state.long)
          paragraphs = `Erato receives the first ${WORD_LONG_SENT_PARAGRAPHS} of ${WORD_LONG_PARAGRAPHS} paragraphs.`;
        if (state.long)
          notes.push({
            tone: "warning",
            text: "Too long to send in full. Only the beginning is sent.",
          });
        if (!state.documentOff)
          notes.push({ tone: "info", text: "Sent instead of the document." });
        item = {
          state: "included",
          ...(state.long
            ? {
                tone: "warning" as ComposerContextTone,
                toneIcon: "tone" as const,
                meta: "Too long · beginning only",
              }
            : { meta: `Selected passage · ${count(paragraphCount)} ¶` }),
          ...(!state.documentOff
            ? {
                announcements: {
                  restored:
                    "Selection included. It is sent instead of the document.",
                },
              }
            : {}),
        };
      }
      result.push({
        id: "word-selection",
        kind: "word.selection",
        origin: "ambient",
        dismissScope: "selection",
        icon: "selection",
        label: `“${excerpt(text)}”`,
        spokenLabel: "Selection",
        ...(item.state === "suggested"
          ? {}
          : {
              removeLabel: "Dismiss selection",
              onRemove: () =>
                setState((current) => ({
                  ...current,
                  selectionOff: true,
                  selectionFailed: false,
                })),
            }),
        detail: {
          title: erato ? "Passage Erato selected" : "Selected passage",
          render: () => (
            <SelectionDetail
              text={text}
              cut={state.long}
              paragraphs={paragraphs}
              notes={notes}
            />
          ),
          ...(selectionActions.length > 0 ? { actions: selectionActions } : {}),
        },
        ...item,
      } as ComposerContextItem);
    }

    const { sent, total } = state.coverage;
    const truncated = sent < total;
    const lasting: Note[] = [
      ...(state.track
        ? [{ tone: "warning" as const, text: TRACKING_NOTE }]
        : []),
      ...(state.readOnly
        ? [{ tone: "warning" as const, text: READ_ONLY_NOTE }]
        : []),
      ...(state.cannotEdit
        ? [{ tone: "warning" as const, text: CANNOT_EDIT_NOTE }]
        : []),
      ...(state.bodyOnly
        ? [{ tone: "info" as const, text: BODY_ONLY_NOTE }]
        : []),
    ];
    const authoring = state.readInParts || state.bodyOnly || state.cannotEdit;
    const empty = state.status === "empty";
    const coverageLines = empty
      ? ["The document is empty, so only its name is sent."]
      : authoring
        ? ["Erato reads the parts of the document your request needs."]
        : state.partialParagraph
          ? [
              "Erato receives only the beginning of the first paragraph, because it alone exceeds the send limit.",
            ]
          : truncated
            ? [
                `Erato receives the first ${count(sent)} of ${count(total)} paragraphs.`,
              ]
            : [
                `Erato receives the whole document, ${count(total)} paragraphs.`,
              ];
    const hint = state.readInParts
      ? "This document is too large to rewrite as a whole. Erato can still read and edit it section by section."
      : !authoring && (truncated || state.partialParagraph)
        ? SELECT_LATER_PART
        : undefined;

    let document: Partial<ComposerContextItem> & {
      state: ComposerContextItem["state"];
    };
    const coverageFor = (superseded: boolean): Coverage => ({
      heading: superseded ? "If sent instead" : "Coverage",
      // Something else goes with this message, so nothing is read again.
      lines:
        state.changed && !superseded
          ? [
              ...coverageLines,
              "Changed since last send: Erato reads it again with this message.",
            ]
          : coverageLines,
      ...(hint ? { hint } : {}),
    });
    let notes: Note[] = lasting;
    let actions: ComposerContextDetailAction[] = [];
    let shownCoverage: Coverage | null = coverageFor(false);
    if (state.documentOff) {
      document = {
        state: "suggested",
        restoreLabel: "Include this document",
        onRestore: () => {
          if (state.status === "error") read();
          setState((current) => ({ ...current, documentOff: false }));
        },
      };
      notes = [];
      shownCoverage = null;
    } else if (passageGoes && !state.commentReplaces) {
      document = { state: "superseded", meta: "Replaced by selection" };
      shownCoverage = coverageFor(true);
      notes = [
        {
          tone: "info",
          text: "Your selection is sent instead of the document.",
        },
        ...lasting,
      ];
      // A locked chat keeps its document choice, so it cannot be sent instead.
      actions = state.locked
        ? []
        : [
            {
              id: "send-instead",
              label: "Send this instead",
              variant: "primary",
              announcement:
                "Document included. Your selection is off until it changes.",
              onSelect: () =>
                setState((current) => ({ ...current, selectionOff: true })),
            },
          ];
    } else if (state.commentReplaces) {
      document = { state: "superseded", meta: "Replaced by comment" };
      shownCoverage = coverageFor(true);
      notes = [
        { tone: "info", text: "A comment is sent instead of the document." },
        ...lasting,
      ];
      // The thread goes in place of the passage too, so sending the document instead also ends that.
      const passageReplaced = state.selection === "user" && !state.selectionOff;
      actions = state.locked
        ? []
        : [
            {
              id: "send-instead",
              label: "Send this instead",
              variant: "primary",
              announcement: passageReplaced
                ? "Document included. Your selection is off until it changes."
                : "Document included. The comment is not sent with this message.",
              onSelect: () =>
                setState((current) => ({
                  ...current,
                  commentReplaces: false,
                  ...(passageReplaced ? { selectionOff: true } : {}),
                })),
            },
          ];
    } else if (state.status === "reading") {
      document = { state: "loading", meta: "Reading document…" };
      notes = [];
      shownCoverage = null;
    } else if (state.status === "unknown") {
      // Before the first read nothing is known yet, and Send reads first.
      document = { state: "included" };
      notes = [];
      shownCoverage = null;
    } else if (state.status === "error") {
      document = {
        state: "error",
        tone: "error",
        meta: "Couldn't read the document",
        removeLabel: "Dismiss document",
      };
      notes = [
        {
          tone: "error",
          text: "Word did not hand over this document, so it is not sent. Try again, or leave it out.",
        },
      ];
      shownCoverage = null;
      actions = [
        {
          id: "retry",
          label: "Try again",
          variant: "primary",
          announcement: "Document read.",
          onSelect: read,
        },
      ];
    } else if (state.status === "noFacet" || state.status === "noFacetEmpty") {
      document = {
        state: "error",
        tone: "error",
        meta: "Can't be sent in this chat",
        removeLabel: "Dismiss document",
      };
      notes = [
        {
          tone: "error",
          text:
            state.status === "noFacetEmpty"
              ? "This chat can only work with documents that have text, so an empty document is not sent."
              : "This chat can only start new documents, so a document with text is not sent.",
        },
      ];
      shownCoverage = null;
    } else {
      const lead = state.track
        ? "Track Changes on"
        : state.readOnly
          ? "Read only"
          : state.cannotEdit
            ? "Can't edit"
            : state.readInParts
              ? "Read in parts"
              : state.bodyOnly
                ? "Body only"
                : undefined;
      const tail = state.changed
        ? "Changed since last send"
        : empty
          ? "New document"
          : !authoring && state.partialParagraph
            ? "Beginning only"
            : !authoring && truncated
              ? `First ${count(sent)} of ${count(total)} ¶`
              : `${count(total)} ¶`;
      // Two facts at most: the comments come third only where nothing leads and nothing changed.
      const commentFact =
        !lead && !state.changed && !empty && state.commentLines.length > 0
          ? `${WORD_COMMENT_COUNT} comments`
          : undefined;
      document = {
        state: "included",
        meta: [lead, tail, commentFact].filter(Boolean).join(" · "),
        ...(state.track || state.readOnly || state.cannotEdit
          ? { tone: "warning" as ComposerContextTone }
          : {}),
      };
    }

    result.push({
      id: "word-document",
      kind: "word.document",
      origin: "ambient",
      dismissScope: "chat",
      icon: "document",
      label: state.name,
      spokenLabel: "Document",
      removeLabel: "Don't include this document",
      ...(state.locked
        ? {
            locked: true,
            lockReason:
              "Can't change this while the chat is archived or a task is running",
          }
        : {}),
      ...(document.state === "suggested"
        ? {}
        : {
            onRemove: () =>
              setState((current) => ({ ...current, documentOff: true })),
          }),
      detail: {
        title: state.name,
        render: () => (
          <DocumentDetail
            notes={notes}
            coverage={shownCoverage}
            comments={
              documentGoes && state.status !== "empty" ? state.commentLines : []
            }
            readReport={state.status === "error" ? READ_REPORT : undefined}
          />
        ),
        ...(actions.length > 0 ? { actions } : {}),
      },
      ...document,
    } as ComposerContextItem);
    return result;
  }, [state, read]);

  return { items, simulate };
};
