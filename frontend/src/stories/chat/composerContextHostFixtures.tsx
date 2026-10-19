/**
 * Host context as data, one scenario per state of the target prototype
 * (P-ERMAIN-89), so every host's lane is reachable before the hosts feed it.
 * Labels, metas and control names follow the prototype's resolvers.
 */
import { noop, stagedFile } from "./composerContextStoryKit";

import type { StoryContextItem } from "./composerContextStoryKit";
import type { ComposerNotice } from "@/components/ui/Chat/ComposerContext/types";
import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export interface HostScenario {
  items: StoryContextItem[];
  files?: FileUploadItem[];
  notice?: ComposerNotice;
}

const text = (body: string) =>
  function DetailText() {
    return <p>{body}</p>;
  };

/* ---------- Word ---------- */

const wordDocument = (over: Partial<StoryContextItem> = {}): StoryContextItem =>
  ({
    id: "w-doc",
    kind: "word.document",
    origin: "ambient",
    dismissScope: "chat",
    state: "included",
    label: "Supply agreement.docx",
    meta: "86 ¶ · 12 comments",
    icon: "document",
    onRemove: noop,
    onRestore: noop,
    removeLabel: "Don't include this document",
    restoreLabel: "Include this document",
    detail: {
      title: "Supply agreement.docx",
      render: text(
        "The whole document is sent with your message: 86 paragraphs and a list of its 12 comments.",
      ),
    },
    ...over,
  }) as StoryContextItem;

const replacedBySelection = wordDocument({
  state: "superseded",
  meta: "Replaced by selection",
  detail: {
    title: "Supply agreement.docx",
    render: text("Your selection is sent instead of the document."),
    actions: [
      {
        id: "instead",
        label: "Send this instead",
        onSelect: noop,
        variant: "primary",
      },
    ],
  },
});

const selection = (over: Partial<StoryContextItem> = {}): StoryContextItem =>
  ({
    id: "w-sel",
    kind: "word.selection",
    origin: "ambient",
    dismissScope: "selection",
    state: "included",
    label: "“The Supplier shall deliver the Goods no later than the deliv…”",
    meta: "Selected passage · 2 ¶",
    icon: "selection",
    onRemove: noop,
    onRestore: noop,
    removeLabel: "Dismiss selection",
    restoreLabel: "Include selection",
    detail: {
      title: "Selected passage",
      render: text(
        "“The Supplier shall deliver the Goods no later than the delivery date set out in Schedule 2.”",
      ),
    },
    ...over,
  }) as StoryContextItem;

const cursorComment: StoryContextItem = {
  id: "w-cursor",
  kind: "word.comment",
  origin: "ambient",
  dismissScope: "message",
  state: "included",
  label: "Comment by Maya Krüger",
  meta: "At your cursor",
  icon: "comment",
  onRemove: noop,
  onRestore: noop,
  removeLabel: "Send without comments",
  restoreLabel: "Include comments",
  announcements: {
    removed: "Comments removed for this message. Include again with +",
  },
  detail: {
    title: "Comment by Maya Krüger",
    render: text("The comment at your cursor, with its 2 replies."),
  },
};

/* ---------- Outlook ---------- */

const thread = (over: Partial<StoryContextItem> = {}): StoryContextItem =>
  ({
    id: "o-thread",
    kind: "outlook.thread",
    origin: "ambient",
    dismissScope: "item",
    state: "included",
    label: "RE: Q4 vendor contract renewal",
    meta: "5 messages · 1.5 MB of 25 MB",
    icon: "mail",
    onRemove: noop,
    onRestore: noop,
    removeLabel: "Leave out the email",
    restoreLabel: "Include the email",
    whenRemoved: { meta: "Off until you switch mail items" },
    detail: {
      title: "RE: Q4 vendor contract renewal",
      render: text("Choose which messages and attachments are sent."),
    },
    ...over,
  }) as StoryContextItem;

const droppedEmail = (
  id: string,
  label: string,
  meta: string,
): StoryContextItem => ({
  id,
  kind: "outlook.droppedEmail",
  origin: "user",
  state: "included",
  label,
  meta,
  icon: "mail",
  onRemove: noop,
  detail: { title: label, render: text("The email and its attachments.") },
});

const draft = (over: Partial<StoryContextItem> = {}): StoryContextItem =>
  ({
    id: "o-draft",
    kind: "outlook.draft",
    origin: "ambient",
    dismissScope: "item",
    state: "included",
    label: "Your draft",
    meta: "Reply to Anna Weber",
    icon: "draft",
    onRemove: noop,
    onRestore: noop,
    removeLabel: "Don't include draft",
    restoreLabel: "Include draft",
    announcements: { removed: "Draft removed. Include again with +" },
    whenRemoved: { meta: "Off until you switch mail items" },
    detail: { title: "Your draft", render: text("Your reply draft is sent.") },
    ...over,
  }) as StoryContextItem;

const draftAttachment = (
  id: string,
  label: string,
  over: Partial<StoryContextItem> = {},
): StoryContextItem =>
  ({
    id,
    kind: "outlook.draftAttachment",
    origin: "ambient",
    dismissScope: "item",
    state: "included",
    label,
    meta:
      id === "o-att-1"
        ? "Draft attachment · 482 KB"
        : "Draft attachment · 36 KB",
    icon: "attachment",
    onRemove: noop,
    onRestore: noop,
    removeLabel: `Don't include ${label}`,
    restoreLabel: `Include ${label}`,
    whenRemoved: { meta: "Off until you switch mail items" },
    detail: { title: label, render: text("An attachment of your draft.") },
    ...over,
  }) as StoryContextItem;

const contract = (over: Partial<StoryContextItem> = {}) =>
  draftAttachment("o-att-1", "contract-v3.pdf", over);
const pricing = (over: Partial<StoryContextItem> = {}) =>
  draftAttachment("o-att-2", "pricing.xlsx", over);

/* ---------- Teams ---------- */

const transcript = (over: Partial<StoryContextItem> = {}): StoryContextItem =>
  ({
    id: "t-transcript",
    kind: "teams.transcript",
    origin: "user",
    state: "included",
    label: "Product sync +1",
    meta: "2 conversations · 124 messages",
    icon: "chats",
    onRemove: noop,
    removeLabel: "Remove Teams transcript",
    announcements: { removed: "Teams transcript removed." },
    detail: {
      title: "Teams transcript",
      render: text("Product sync and Design review, the last 7 days."),
    },
    ...over,
  }) as StoryContextItem;

export const hostScenarios = {
  wordDocument: { items: [wordDocument()] },
  wordSelection: { items: [selection(), replacedBySelection] },
  wordSuggestedSelection: {
    items: [
      selection({
        state: "suggested",
        label:
          "“The Buyer may audit the Supplier's records once per contract…”",
        meta: "Shown by Erato · 1 ¶",
        onRemove: undefined,
        restoreLabel: "Use this selection",
      }),
      wordDocument(),
    ],
  },
  wordDocumentOff: {
    items: [
      // No meta: the lane states the chat-long lifetime itself.
      wordDocument({
        state: "suggested",
        meta: undefined,
        onRemove: undefined,
      }),
      {
        id: "w-open-comments",
        kind: "word.openComments",
        origin: "ambient",
        dismissScope: "message",
        state: "suggested",
        label: "Open comments (9)",
        meta: "Not included",
        icon: "comments",
        onRestore: noop,
        restoreLabel: "Include open comments",
        detail: {
          title: "Open comments",
          render: text("9 open comments, with their replies."),
        },
      },
    ],
  },
  wordReading: {
    items: [wordDocument({ state: "loading", meta: "Reading document…" })],
    notice: {
      id: "waiting",
      tone: "info",
      busy: true,
      text: "Waiting for Supply agreement.docx.",
      actions: [{ id: "skip", label: "Send without it", onSelect: noop }],
    },
  },
  wordError: {
    items: [
      wordDocument({
        state: "error",
        meta: "Couldn't read the document",
        removeLabel: "Dismiss",
        detail: {
          title: "Supply agreement.docx",
          render: text(
            "Word did not hand over this document, so it is not sent. Try again, or leave it out.",
          ),
          actions: [
            {
              id: "retry",
              label: "Try again",
              onSelect: noop,
              variant: "primary",
            },
          ],
        },
        whenRestored: { state: "loading", meta: "Reading document…" },
        thenSettles: {
          state: "included",
          meta: "86 ¶ · 12 comments",
          removeLabel: "Don't include this document",
        },
      }),
    ],
  },
  wordCursorInComments: {
    items: [
      wordDocument({ meta: "86 ¶" }),
      {
        ...cursorComment,
        state: "attention",
        label: "Cursor is in 3 comments",
        meta: "Choose one",
        detail: {
          title: "Choose a comment",
          render: text("Three comments overlap the cursor."),
        },
      },
    ],
  },
  wordBusy: {
    items: [selection(), replacedBySelection, cursorComment],
    files: [
      stagedFile("f1", "schedule-2-delivery-plan.pdf"),
      stagedFile("f2", "supplier-pricing-2027.xlsx"),
      stagedFile("f3", "previous-agreement-2024.docx"),
      stagedFile("f4", "site-list.xlsx"),
      stagedFile("f5", "warehouse-photo.png"),
    ],
  },
  // After Send: Word did not hand the selection over, so nothing was sent
  // and the document is no longer replaced.
  wordSelectionFailed: {
    items: [
      selection({
        state: "error",
        meta: "Couldn't read · send again",
        announcements: { removed: "Selection removed. Include again with +" },
      }),
      wordDocument(),
    ],
    notice: {
      id: "selfail",
      tone: "error",
      text: "Erato could not read your selection in Word, so your message was not sent. Send it again, or dismiss the selection to send without it.",
      onDismiss: noop,
    },
  },
  wordChanged: { items: [wordDocument({ meta: "Changed since last send" })] },

  outlookReadThread: { items: [thread()] },
  outlookReadPartial: {
    items: [thread({ meta: "3 of 5 messages · 1.2 MB of 25 MB" })],
  },
  outlookReadLoading: {
    items: [thread({ state: "loading", meta: "Loading email thread…" })],
  },
  outlookReadError: {
    items: [
      thread({
        state: "error",
        meta: "Couldn't load the email thread",
        removeLabel: "Dismiss",
        whenRemoved: {
          meta: "Off until you switch mail items",
          restoreLabel: "Try loading the email again",
        },
        whenRestored: {
          state: "loading",
          meta: "Loading email thread…",
          removeLabel: "Leave out the email",
        },
        thenSettles: {
          state: "included",
          meta: "5 messages · 1.5 MB of 25 MB",
          restoreLabel: "Include the email",
        },
      }),
    ],
  },
  outlookReadSignIn: {
    items: [thread({ state: "attention", meta: "Sign in to load email" })],
  },
  outlookReadFollowUp: {
    items: [
      thread({
        state: "suggested",
        meta: "Not included on follow-up messages",
        onRemove: undefined,
      }),
    ],
  },
  outlookReadDrops: {
    items: [
      thread(),
      droppedEmail(
        "o-drop-1",
        "Re: Offsite agenda",
        "Lena Hoffmann • 10/7/2026 · 2/2 attachments",
      ),
      droppedEmail(
        "o-drop-2",
        "Budget 2027 draft",
        "Jonas Weber • 10/12/2026 · 3/3 attachments",
      ),
    ],
  },
  outlookReadDropping: {
    items: [
      thread(),
      {
        id: "o-dropping",
        kind: "outlook.dropProgress",
        origin: "user",
        state: "loading",
        label: "Reading email 1 of 2…",
        icon: "mail",
        locked: true,
        lockReason: "Wait until the emails are added",
      },
    ],
  },
  outlookComposeDraft: { items: [draft(), contract(), pricing()] },
  outlookComposeUnchanged: {
    items: [
      draft({ state: "superseded", meta: "Unchanged, not re-sent" }),
      contract({ state: "superseded", meta: "Sent earlier, not re-sent" }),
      pricing({ state: "superseded", meta: "Sent earlier, not re-sent" }),
    ],
  },
  outlookComposeDismissed: {
    items: [
      draft({
        state: "suggested",
        meta: "Off until you switch mail items",
        onRemove: undefined,
      }),
      contract(),
      pricing(),
    ],
  },
  outlookComposeScheduling: {
    items: [
      draft({ state: "superseded", meta: "Not sent while scheduling" }),
      contract(),
      pricing(),
    ],
  },
  outlookComposeAttachments: {
    items: [
      draft(),
      {
        id: "o-atts",
        kind: "outlook.draftAttachments",
        origin: "ambient",
        dismissScope: "item",
        state: "included",
        label: "Draft attachments (3)",
        meta: "3 of 3 · 738 KB",
        icon: "attachment",
        onRemove: noop,
        onRestore: noop,
        removeLabel: "Don't include draft attachments",
        restoreLabel: "Include draft attachments",
        whenRemoved: { meta: "Off until you switch mail items" },
        detail: {
          title: "Draft attachments (3)",
          render: text("Choose which attachments of your draft are sent."),
        },
      },
    ],
  },
  outlookComposeSelection: {
    items: [
      {
        id: "o-sel",
        kind: "outlook.selection",
        origin: "ambient",
        dismissScope: "selection",
        state: "included",
        label: "“Could you confirm the delivery date by Friday?”",
        meta: "Replaces draft",
        icon: "selection",
        onRemove: noop,
        onRestore: noop,
        removeLabel: "Dismiss selection",
        restoreLabel: "Include selection",
        detail: {
          title: "Selected text",
          render: text("Erato rewrites the text you selected in your draft."),
        },
      },
      draft({ state: "superseded", meta: "Replaced by selection" }),
      contract(),
      pricing(),
    ],
  },

  teamsTranscript: {
    items: [
      transcript({
        label: "Product sync +2",
        meta: "3 conversations · 240 messages",
      }),
    ],
  },
  teamsWithFiles: {
    items: [transcript()],
    files: [
      stagedFile("t1", "holiday.pdf"),
      stagedFile("t2", "budget-notes.docx"),
      stagedFile("t3", "team-photo.png"),
    ],
  },
  teamsPreparing: {
    items: [
      transcript({
        state: "loading",
        meta: "Preparing transcript…",
        locked: true,
        lockReason: "Wait until the transcript is ready",
      }),
    ],
  },
} satisfies Record<string, HostScenario>;

export type HostScenarioName = keyof typeof hostScenarios;
