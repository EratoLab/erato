import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";

import {
  trackingReadOnlyText,
  wordAuthoringIssueText,
} from "./wordAuthoringMessages";

import type { WordDocumentCoverage } from "./buildWordDocumentArgs";
import type { WordSendPreview } from "./wordSendPreview";
import type { WordDocumentStatus } from "../hooks/useWordDocumentSource";
import type {
  ComposerContextState,
  ComposerContextTone,
} from "@erato/frontend/library";

export interface WordContextNote {
  tone: "info" | "warning" | "error";
  text: string;
  /** Kept where tests already find the text. */
  testId?: string;
}

export interface WordSelectionChipInput {
  /** What Send carries, one line per paragraph. */
  text: string;
  paragraphCount: number;
  truncated: boolean;
  /** False for a passage Erato selected: shown, not sent until the user takes it over. */
  armed: boolean;
  dismissed: boolean;
  /** The last Send could not read this very selection. */
  readFailed: boolean;
}

export interface WordDocumentChipInput {
  /** Some document facet is advertised. */
  available: boolean;
  /** The chat's choice, before any facet or read is considered. */
  included: boolean;
  status: WordDocumentStatus;
  reading: boolean;
  coverage: WordDocumentCoverage | null;
  changed: boolean;
  /** Authoring, not its read-only fallback: Erato reads parts through its tools. */
  authoringRoute: boolean;
  readInParts: boolean;
  /** Read as if every tracked change were accepted, and not edited. */
  trackChanges: boolean;
  /** A capture issue that lasts until the document changes; never a Send's budget check. */
  lastingIssue: { text: string; readOnly: boolean } | null;
  /** Word for the web handed over the body only. */
  bodyOnly: boolean;
  /** The comment map's lines, when the message carries the map. */
  commentLines: string[];
  /** The copyable report of a failed read. */
  readReport?: string;
}

export interface WordContextChipInput {
  /** From previewWordSend(), the order Send runs in. */
  preview: WordSendPreview;
  /** Null without a passage the selection facet can carry. */
  selection: WordSelectionChipInput | null;
  document: WordDocumentChipInput;
}

export interface WordSelectionChipModel {
  state: ComposerContextState;
  tone?: ComposerContextTone;
  /** The warning glyph, not the quote: what goes is cut. */
  toneIcon?: "tone";
  meta?: string;
  /** Null: no (x), as for a passage Erato selected. */
  removeLabel: string | null;
  restoreLabel?: string;
  /** What (+) does: undo the dismissal, take over Erato's passage, or both. */
  restore: "rearm" | "arm" | "rearm-and-arm";
  /** Replaces the lane's "Selection included." once (+) lands. */
  restoredAnnouncement?: string;
  title: string;
  text: string;
  /** The text stops where the send stops, before the end of the passage. */
  cut: boolean;
  paragraphs: string;
  notes: WordContextNote[];
  lifetime: string;
}

export type WordDocumentChipAction = "send-instead" | "retry";

export interface WordDocumentChipModel {
  state: ComposerContextState;
  tone?: ComposerContextTone;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  /** (+) on a document whose last read failed reads it again. */
  restore: "include" | "include-and-retry";
  actions: WordDocumentChipAction[];
  notes: WordContextNote[];
  /** Null before anything is known of the document, or while nothing of it is sent. */
  coverage: { heading: string; lines: string[]; hint?: string } | null;
  comments: string[];
  readReport?: string;
  lifetime: string;
}

/** Counts in the meta read as the detail's plurals do: "1,590" in English, "1.590" in German. */
const count = (value: number) => i18n.number(value);

const dismissSelectionText = () =>
  t({
    id: "officeAddin.chatInput.dismissSelection",
    message: "Dismiss selection",
  });

const dontIncludeText = () =>
  t({
    id: "officeAddin.word.chip.dismiss",
    message: "Don't include this document",
  });

const dismissErrorText = () =>
  t({
    id: "officeAddin.word.context.document.dismissError",
    message: "Dismiss document",
  });

function selectionParagraphsText(count: number): string {
  return t({
    id: "officeAddin.word.context.selection.paragraphs",
    message: plural(count, { one: "# paragraph", other: "# paragraphs" }),
  });
}

function eratoParagraphsText(count: number): string {
  return t({
    id: "officeAddin.word.context.selection.paragraphsErato",
    message: plural(count, {
      one: "# paragraph · Shown by Erato after Show in Word",
      other: "# paragraphs · Shown by Erato after Show in Word",
    }),
  });
}

function firstParagraphsText(sentCount: number, total: number): string {
  const sent = count(sentCount);
  return t({
    id: "officeAddin.word.context.document.coverage.first",
    message: plural(total, {
      one: `Erato receives the first ${sent} of # paragraph.`,
      other: `Erato receives the first ${sent} of # paragraphs.`,
    }),
  });
}

const partialParagraphText = () =>
  t({
    id: "officeAddin.word.context.document.coverage.partial",
    message:
      "Erato receives only the beginning of the first paragraph, because it alone exceeds the send limit.",
  });

/** What of a passage cut to the send limit goes: its first whole lines, or the start of its one paragraph. */
function sentParagraphsText(selection: WordSelectionChipInput): string {
  const lines = selection.text.split("\n").length;
  if (lines < selection.paragraphCount)
    return firstParagraphsText(lines, selection.paragraphCount);
  return selection.paragraphCount <= 1
    ? partialParagraphText()
    : selectionParagraphsText(selection.paragraphCount);
}

/**
 * The selection chip as the Send would treat the passage: included only when it goes, superseded
 * when a comment thread goes in its place, suggested while dismissed or still Erato's.
 */
export function wordSelectionChip(
  input: WordContextChipInput,
): WordSelectionChipModel | null {
  const selection = input.selection;
  if (!selection) return null;
  const { preview } = input;
  const paragraphs = count(selection.paragraphCount);
  const base = {
    text: selection.text,
    cut: selection.truncated,
    paragraphs: selection.armed
      ? selectionParagraphsText(selection.paragraphCount)
      : eratoParagraphsText(selection.paragraphCount),
    title: selection.armed
      ? t({
          id: "officeAddin.word.context.selection.title",
          message: "Selected passage",
        })
      : t({
          id: "officeAddin.word.context.selection.titleErato",
          message: "Passage Erato selected",
        }),
    lifetime: t({
      id: "officeAddin.word.context.selection.lifetime",
      message: "Leaving it out lasts until the selection changes.",
    }),
  };
  const eratoNote: WordContextNote = {
    tone: "info",
    text: t({
      id: "officeAddin.word.context.selection.eratoNote",
      message:
        "Erato selected this passage. It is shown, but not sent until you use it.",
    }),
  };
  const takeOverText = () =>
    t({ id: "officeAddin.selection.useThis", message: "Use this selection" });

  if (selection.dismissed)
    return {
      ...base,
      state: "suggested",
      removeLabel: null,
      restore: selection.armed ? "rearm" : "rearm-and-arm",
      restoreLabel: selection.armed
        ? t({
            id: "officeAddin.word.context.selection.include",
            message: "Include selection",
          })
        : takeOverText(),
      notes: selection.armed ? [] : [eratoNote],
    };
  if (!selection.armed)
    return {
      ...base,
      state: "suggested",
      meta: t({
        id: "officeAddin.word.context.selection.meta.shownByErato",
        message: `Shown by Erato · ${paragraphs} ¶`,
      }),
      removeLabel: null,
      restore: "arm",
      restoreLabel: takeOverText(),
      notes: [eratoNote],
    };

  const included = {
    removeLabel: dismissSelectionText(),
    restore: "rearm" as const,
  };
  if (selection.readFailed)
    return {
      ...base,
      ...included,
      state: "error",
      tone: "error",
      meta: t({
        id: "officeAddin.word.context.selection.meta.readFailed",
        message: "Couldn't read · send again",
      }),
      notes: [
        {
          tone: "error",
          text: t({
            id: "officeAddin.word.selection.readFailed",
            message:
              "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
          }),
        },
      ],
    };
  if (preview.selection === "replaced-by-comment")
    return {
      ...base,
      ...included,
      state: "superseded",
      meta: t({
        id: "officeAddin.word.context.selection.meta.replacedByComment",
        message: "Replaced by comment",
      }),
      notes: [
        {
          tone: "info",
          text: t({
            id: "officeAddin.word.context.selection.commentInstead",
            message: "A comment is sent instead of this passage.",
          }),
        },
      ],
    };
  // An armed, kept passage always goes or gives way to a thread; anything else would draw a dead +.
  if (preview.selection !== "sent") return null;

  const notes: WordContextNote[] = [];
  if (selection.truncated)
    notes.push({
      tone: "warning",
      text: t({
        id: "officeAddin.word.selection.truncated",
        message: "Too long to send in full. Only the beginning is sent.",
      }),
    });
  const replacesDocument = preview.document === "replaced-by-selection";
  if (replacesDocument)
    notes.push({
      tone: "info",
      text: t({
        id: "officeAddin.word.selection.sentInsteadOfDocument",
        message: "Sent instead of the document.",
      }),
    });
  return {
    ...base,
    ...included,
    state: "included",
    ...(selection.truncated
      ? {
          tone: "warning" as const,
          toneIcon: "tone" as const,
          paragraphs: sentParagraphsText(selection),
          meta: t({
            id: "officeAddin.word.context.selection.meta.tooLong",
            message: "Too long · beginning only",
          }),
        }
      : {
          meta: t({
            id: "officeAddin.word.context.selection.meta",
            message: `Selected passage · ${paragraphs} ¶`,
          }),
        }),
    // The lane reads this from the chip (+) lands on, so the included selection carries it.
    ...(replacesDocument
      ? {
          restoredAnnouncement: t({
            id: "officeAddin.word.context.selection.announce.usedInstead",
            message: "Selection included. It is sent instead of the document.",
          }),
        }
      : {}),
    notes,
  };
}

function coverageMeta(document: WordDocumentChipInput): string | undefined {
  if (document.status === "empty")
    return t({
      id: "officeAddin.word.chip.newDocument",
      message: "New document",
    });
  const coverage = document.coverage;
  if (!coverage) return undefined;
  const total = count(coverage.paragraphsTotal);
  const sent = count(coverage.paragraphsSent);
  if (!document.authoringRoute && coverage.partialParagraph)
    return t({
      id: "officeAddin.word.context.document.meta.beginningOnly",
      message: "Beginning only",
    });
  if (!document.authoringRoute && coverage.truncated)
    return t({
      id: "officeAddin.word.context.document.meta.firstOf",
      message: `First ${sent} of ${total} ¶`,
    });
  return t({
    id: "officeAddin.word.context.document.meta.paragraphs",
    message: `${total} ¶`,
  });
}

/** The lasting fact that leads the meta, and whether it warns. */
function leadFact(
  document: WordDocumentChipInput,
): { text: string; warning: boolean } | null {
  if (document.trackChanges)
    return {
      text: t({
        id: "officeAddin.word.context.document.meta.trackChanges",
        message: "Track Changes on",
      }),
      warning: true,
    };
  if (document.lastingIssue)
    return document.lastingIssue.readOnly
      ? {
          text: t({
            id: "officeAddin.word.context.document.meta.readOnly",
            message: "Read only",
          }),
          warning: true,
        }
      : {
          text: t({
            id: "officeAddin.word.context.document.meta.cannotEdit",
            message: "Can't edit",
          }),
          warning: true,
        };
  if (document.readInParts)
    return {
      text: t({
        id: "officeAddin.word.context.document.meta.readInParts",
        message: "Read in parts",
      }),
      warning: false,
    };
  if (document.bodyOnly)
    return {
      text: t({
        id: "officeAddin.word.context.document.meta.bodyOnly",
        message: "Body only",
      }),
      warning: false,
    };
  return null;
}

function coverageSection(
  document: WordDocumentChipInput,
  { superseded }: { superseded: boolean },
): WordDocumentChipModel["coverage"] {
  const coverage = document.coverage;
  const known =
    document.status === "empty" ||
    (document.status === "included" && document.authoringRoute) ||
    !!coverage;
  if (!known) return null;
  const lines: string[] = [];
  let hint: string | undefined;
  const selectLaterPart = () =>
    t({
      id: "officeAddin.word.chip.selectLaterPart",
      message:
        "Only the beginning is sent. To work on a later part, select it in Word.",
    });
  if (document.status === "empty") {
    lines.push(
      t({
        id: "officeAddin.word.context.document.coverage.empty",
        message: "The document is empty, so only its name is sent.",
      }),
    );
  } else if (document.authoringRoute || !coverage) {
    lines.push(
      t({
        id: "officeAddin.word.context.document.coverage.authoring",
        message: "Erato reads the parts of the document your request needs.",
      }),
    );
    if (document.readInParts) hint = wordAuthoringIssueText("too-large");
  } else {
    const total = coverage.paragraphsTotal;
    if (coverage.partialParagraph) {
      lines.push(partialParagraphText());
      hint = selectLaterPart();
    } else if (coverage.truncated) {
      lines.push(firstParagraphsText(coverage.paragraphsSent, total));
      hint = selectLaterPart();
    } else {
      lines.push(
        t({
          id: "officeAddin.word.context.document.coverage.whole",
          message: plural(total, {
            one: "Erato receives the whole document, # paragraph.",
            other: "Erato receives the whole document, # paragraphs.",
          }),
        }),
      );
    }
  }
  // Something else goes with this message, so it reads nothing again.
  if (document.changed && !superseded)
    lines.push(
      t({
        id: "officeAddin.word.context.document.coverage.changed",
        message:
          "Changed since last send: Erato reads it again with this message.",
      }),
    );
  const heading = superseded
    ? t({
        id: "officeAddin.word.context.document.coverageIfSentHeading",
        message: "If sent instead",
      })
    : t({
        id: "officeAddin.word.context.document.coverageHeading",
        message: "Coverage",
      });
  return hint ? { heading, lines, hint } : { heading, lines };
}

/** What lasts about the document, whatever goes in its place this time. */
function lastingNotes(document: WordDocumentChipInput): WordContextNote[] {
  const notes: WordContextNote[] = [];
  if (document.trackChanges)
    notes.push({ tone: "warning", text: trackingReadOnlyText() });
  if (document.lastingIssue)
    notes.push({ tone: "warning", text: document.lastingIssue.text });
  if (document.bodyOnly)
    notes.push({
      tone: "info",
      testId: "word-document-read-note",
      text: t({
        id: "officeAddin.word.authoring.packageBlocked",
        message:
          "Word for the web didn't hand over the complete file, for example because the document has a sensitivity label. Erato read the body only, so it can't change headers, footers or page layout, and any change replaces the whole body instead of editing passages in place.",
      }),
    });
  return notes;
}

/**
 * The document chip as the Send would treat the document. Included only when a document facet
 * goes, with one documented exception: before the first read nothing is known, and Send reads
 * first. Superseded when a passage or a thread goes in its place, suggested when off, an error
 * when it is on but cannot go.
 */
export function wordDocumentChip(
  input: WordContextChipInput,
): WordDocumentChipModel | null {
  const { document, preview } = input;
  if (!document.available) return null;
  const setting = t({
    id: "officeAddin.word.settings.includeDocument",
    message: "Include the open document in new chats",
  });
  const restore: WordDocumentChipModel["restore"] =
    document.status === "unreadable" ? "include-and-retry" : "include";
  const base = {
    removeLabel: dontIncludeText(),
    restore,
    actions: [] as WordDocumentChipAction[],
    coverage: coverageSection(document, { superseded: false }),
    comments: [] as string[],
    lifetime: t({
      id: "officeAddin.word.context.document.lifetime",
      message: `Leaving it out lasts for this chat. New chats follow your setting “${setting}”.`,
    }),
  };

  // Off: nothing of it is sent, so the detail claims no coverage.
  if (!document.included || preview.document === "off")
    return {
      ...base,
      state: "suggested",
      restoreLabel: t({
        id: "officeAddin.word.chip.include",
        message: "Include this document",
      }),
      coverage: null,
      notes: [],
    };
  const supersededCoverage = coverageSection(document, { superseded: true });
  if (preview.document === "replaced-by-selection")
    return {
      ...base,
      state: "superseded",
      coverage: supersededCoverage,
      meta: t({
        id: "officeAddin.word.context.document.meta.replacedBySelection",
        message: "Replaced by selection",
      }),
      actions: ["send-instead"],
      notes: [
        {
          tone: "info",
          text: t({
            id: "officeAddin.word.chip.selectionInstead",
            message: "Your selection is sent instead of the document.",
          }),
        },
        ...lastingNotes(document),
      ],
    };
  if (preview.document === "replaced-by-comment")
    return {
      ...base,
      state: "superseded",
      coverage: supersededCoverage,
      meta: t({
        id: "officeAddin.word.context.document.meta.replacedByComment",
        message: "Replaced by comment",
      }),
      notes: [
        {
          tone: "info",
          text: t({
            id: "officeAddin.word.chip.commentInstead",
            message: "A comment is sent instead of the document.",
          }),
        },
        ...lastingNotes(document),
      ],
    };
  if (document.reading)
    return {
      ...base,
      state: "loading",
      meta: t({
        id: "officeAddin.word.chip.reading",
        message: "Reading document…",
      }),
      coverage: null,
      notes: [],
    };
  if (preview.document === "not-sent" && document.status === "unreadable")
    return {
      ...base,
      state: "error",
      tone: "error",
      meta: t({
        id: "officeAddin.word.context.document.meta.unreadable",
        message: "Couldn't read the document",
      }),
      removeLabel: dismissErrorText(),
      actions: ["retry"],
      coverage: null,
      notes: [
        {
          tone: "error",
          text: t({
            id: "officeAddin.word.context.document.unreadableNote",
            message:
              "Word did not hand over this document, so it is not sent. Try again, or leave it out.",
          }),
        },
      ],
      ...(document.readReport ? { readReport: document.readReport } : {}),
    };
  if (preview.document === "not-sent" && document.status !== "unknown")
    return {
      ...base,
      state: "error",
      tone: "error",
      meta: t({
        id: "officeAddin.word.context.document.meta.notSentHere",
        message: "Can't be sent in this chat",
      }),
      removeLabel: dismissErrorText(),
      coverage: null,
      notes: [
        {
          tone: "error",
          text:
            document.status === "empty"
              ? t({
                  id: "officeAddin.word.context.document.notSentHereEmptyNote",
                  message:
                    "This chat can only work with documents that have text, so an empty document is not sent.",
                })
              : t({
                  id: "officeAddin.word.context.document.notSentHereNote",
                  message:
                    "This chat can only start new documents, so a document with text is not sent.",
                }),
        },
      ],
    };
  if (preview.document !== "sent")
    // Before the first read: Send reads the document first.
    return { ...base, state: "included", notes: [] };

  const lead = leadFact(document);
  const tail = document.changed
    ? t({
        id: "officeAddin.word.context.document.meta.changed",
        message: "Changed since last send",
      })
    : coverageMeta(document);
  const meta = [lead?.text, tail].filter(Boolean).join(" · ");
  return {
    ...base,
    state: "included",
    ...(lead?.warning ? { tone: "warning" as const } : {}),
    ...(meta ? { meta } : {}),
    comments: document.commentLines,
    notes: lastingNotes(document),
  };
}
