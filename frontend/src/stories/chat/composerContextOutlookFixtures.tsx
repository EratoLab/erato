import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert } from "@/components/ui/Feedback/Alert";
import { formatFileSize } from "@/components/ui/FileUpload/FilePreviewBase";
import { GroupedFileAttachmentsPreview } from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";

import type {
  ComposerContextDetailAction,
  ComposerContextItem,
  ComposerContextState,
  ComposerContextTone,
  ComposerMode,
} from "@/components/ui/Chat/ComposerContext/types";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
} from "@/components/ui/FileUpload/GroupedFileAttachmentsPreview";

/*
 * Outlook's chips as the Office add-in builds them, played from data. The
 * rules are those of office-addin/src/outlook/utils/outlookSendFiles.ts (which
 * files the send uploads), outlookActionFacet.ts (what the facet carries) and
 * outlookContextChips.ts (the chips), and the copy is the add-in's English
 * catalog; the add-in's tests pin the real output, so these stories show the
 * lane, not the add-in's strings.
 */

const KB = 1024;
export const OUTLOOK_LIMIT = "25 MB";
export const OUTLOOK_THREAD_SUBJECT = "RE: Q4 vendor contract renewal";
export const OUTLOOK_SELECTION_TEXT =
  "Could you confirm the delivery date by Friday?";
export const OUTLOOK_DRAFT_BODY =
  "Hi Anna,\n\nthanks for the updated contract. Could you confirm the delivery date by Friday? We also need the revised pricing sheet before the steering meeting.\n\nBest regards,\nDaniel";
export const OUTLOOK_APPOINTMENT = {
  subject: "Steering committee: vendor renewal",
  when: "Fri, Oct 23, 10:00 – 11:00 AM",
  whenLong: "Fri, Oct 23, 2026, 10:00 – 11:00 AM",
  location: "Room 4.12 and Teams",
  attendees: ["Anna Weber", "Tom Fischer", "Priya Raman"],
};
export const OUTLOOK_SCHEDULING_UNTIL = "3:40 PM";
const LOCK_REASON = "Can't change this while the message is being sent";

interface ThreadAttachment {
  id: string;
  name: string;
  size: number;
}

interface ThreadMessage {
  id: string;
  from: string;
  date: string;
  subject: string;
  size: number;
  attachments: ThreadAttachment[];
}

const THREAD_MESSAGES: ThreadMessage[] = [
  {
    id: "m1",
    from: "Anna Weber",
    date: "Oct 6, 2026, 9:14 AM",
    subject: "Q4 vendor contract renewal",
    size: 38 * KB,
    attachments: [
      { id: "m1:a1", name: "contract-v3.pdf", size: 482 * KB },
      { id: "m1:a2", name: "pricing.xlsx", size: 36 * KB },
    ],
  },
  {
    id: "m2",
    from: "Tom Fischer",
    date: "Oct 7, 2026, 2:02 PM",
    subject: OUTLOOK_THREAD_SUBJECT,
    size: 22 * KB,
    attachments: [],
  },
  {
    id: "m3",
    from: "Anna Weber",
    date: "Oct 8, 2026, 8:47 AM",
    subject: OUTLOOK_THREAD_SUBJECT,
    size: 19 * KB,
    attachments: [{ id: "m3:a1", name: "redline-v4.docx", size: 214 * KB }],
  },
  {
    id: "m4",
    from: "Priya Raman",
    date: "Oct 9, 2026, 11:20 AM",
    subject: OUTLOOK_THREAD_SUBJECT,
    size: 24 * KB,
    attachments: [
      { id: "m4:a1", name: "legal-review-notes.pdf", size: 640 * KB },
    ],
  },
  {
    id: "m5",
    from: "Tom Fischer",
    date: "Oct 10, 2026, 4:05 PM",
    subject: OUTLOOK_THREAD_SUBJECT,
    size: 18 * KB,
    attachments: [],
  },
];

/** An Office.js attachment: the draft's own, or the open email's without a thread. */
export interface OutlookStoryAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  cloud?: boolean;
}

export const CONTRACT: OutlookStoryAttachment = {
  id: "a1",
  name: "contract-v3.pdf",
  size: 482 * KB,
  type: "PDF",
};
export const PRICING: OutlookStoryAttachment = {
  id: "a2",
  name: "pricing.xlsx",
  size: 36 * KB,
  type: "XLSX",
};
export const SCHEDULE: OutlookStoryAttachment = {
  id: "a3",
  name: "delivery-schedule.pdf",
  size: 220 * KB,
  type: "PDF",
};
export const CLOUD_FILE: OutlookStoryAttachment = {
  id: "a4",
  name: "Renewal terms.docx",
  // Office.js reports no size for a link to a cloud file.
  size: 0,
  type: "DOCX",
  cloud: true,
};

export interface OutlookStoryDrop {
  key: string;
  subject: string;
  sender: string;
  date: string;
  fileName: string;
  bodySize: number;
  attachments: ThreadAttachment[];
  /** Unticking this attachment needs a trim the bytes refuse. */
  trimBlocked?: string;
}

export const OFFSITE_DROP: OutlookStoryDrop = {
  key: "drop-offsite",
  subject: "Re: Offsite agenda",
  sender: "Lena Hoffmann",
  date: "10/7/2026",
  fileName: "Re Offsite agenda.eml",
  bodySize: 41 * KB,
  attachments: [
    { id: "att-0", name: "agenda.docx", size: 28 * KB },
    { id: "att-1", name: "venue-map.png", size: 310 * KB },
  ],
};
export const BUDGET_DROP: OutlookStoryDrop = {
  key: "drop-budget",
  subject: "Budget 2027 draft",
  sender: "Jonas Weber",
  date: "10/12/2026",
  fileName: "Budget 2027 draft.eml",
  bodySize: 96 * KB,
  attachments: [
    { id: "att-0", name: "budget-2027.xlsx", size: 120 * KB },
    { id: "att-1", name: "headcount.xlsx", size: 44 * KB },
    { id: "att-2", name: "assumptions.pdf", size: 210 * KB },
  ],
};

type ThreadStatus = "none" | "loading" | "ready" | "error";

export interface OutlookStoryState {
  host: "read" | "compose";
  /** No message has been sent in this chat yet. */
  freshChat: boolean;
  /** A send is uploading: every chip and the mode keep still. */
  sending: boolean;
  /** Sticky scheduling: Erato read the calendar within the hour. */
  scheduling: boolean;

  /** "none": no mail backend, so no thread; the email's attachments go instead. */
  threadStatus: ThreadStatus;
  /** With "error": reading the mailbox needs an interactive step. */
  signIn: "sign-in" | "consent" | null;
  signingIn: boolean;
  threadChoice: "included" | "excluded" | null;
  threadSentInChat: boolean;
  untickedMessages: string[];
  untickedAttachments: string[];
  /** Unticking this thread attachment needs a trim the bytes refuse. */
  trimBlocked: string | null;
  /** Where a load started by +, "Try again" or a switch lands. */
  retryLandsOn: "ready" | "error";
  openEmailDropped: boolean;

  itemKind: "message" | "appointment";
  /** The draft replies to the open thread. */
  reply: boolean;
  /** "none": an empty draft, which rides with nothing. */
  draft: "changed" | "unchanged" | "none";
  draftOff: boolean;
  selection: "active" | "dismissed" | null;

  attachments: OutlookStoryAttachment[];
  dismissedAttachments: string[];
  attachmentsGroupOff: boolean;
  sentAttachmentIds: string[];
  followUpIds: string[];

  drops: OutlookStoryDrop[];
  dismissedDropAttachments: Record<string, string[]>;
  dropProgress: string | null;
}

export type OutlookStorySeed = Partial<OutlookStoryState>;

const DEFAULTS: OutlookStoryState = {
  host: "read",
  freshChat: true,
  sending: false,
  scheduling: false,
  threadStatus: "ready",
  signIn: null,
  signingIn: false,
  threadChoice: null,
  threadSentInChat: false,
  untickedMessages: [],
  untickedAttachments: [],
  trimBlocked: null,
  retryLandsOn: "ready",
  openEmailDropped: false,
  itemKind: "message",
  reply: true,
  draft: "changed",
  draftOff: false,
  selection: null,
  attachments: [],
  dismissedAttachments: [],
  attachmentsGroupOff: false,
  sentAttachmentIds: [],
  followUpIds: [],
  drops: [],
  dismissedDropAttachments: {},
  dropProgress: null,
};

const READ_MS = 600;
const SIGN_IN_MS = 4000;
const DROP_STEP_MS = 700;

type ThreadDisposition =
  | { kind: "none" }
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "error"; why: "load" | "trim" }
  | { kind: "sign-in"; consent: boolean }
  | { kind: "off"; retry: boolean }
  | { kind: "follow-up" }
  | { kind: "nothing" }
  | { kind: "sent"; included: number; total: number };

type AttachmentDisposition =
  | "sent"
  | "off"
  | "sent-earlier"
  | "follow-up"
  | "cloud"
  | "not-with-drops";

type DraftDisposition = "sent" | "selection" | "scheduling" | "unchanged";

const threadStats = (state: OutlookStoryState) => {
  const kept = THREAD_MESSAGES.filter(
    (message) => !state.untickedMessages.includes(message.id),
  );
  const size = kept.reduce(
    (total, message) =>
      total +
      message.size +
      message.attachments
        .filter(
          (attachment) => !state.untickedAttachments.includes(attachment.id),
        )
        .reduce((sum, attachment) => sum + attachment.size, 0),
    0,
  );
  const trimFailed =
    state.trimBlocked !== null &&
    state.untickedAttachments.includes(state.trimBlocked) &&
    kept.some((message) =>
      message.attachments.some(
        (attachment) => attachment.id === state.trimBlocked,
      ),
    );
  return { included: kept.length, size, trimFailed };
};

function threadDisposition(state: OutlookStoryState): ThreadDisposition {
  const { threadStatus: status, threadChoice: choice } = state;
  if (state.host !== "read" || status === "none") return { kind: "none" };
  if (state.openEmailDropped) return { kind: "hidden" };
  if (state.threadSentInChat && choice !== "included")
    return { kind: "hidden" };
  if (status === "loading") {
    if ((state.freshChat && choice !== "excluded") || choice === "included") {
      return { kind: "loading" };
    }
    if (choice === null) return { kind: "follow-up" };
  }
  if (status === "error" && choice !== "excluded") {
    return state.signIn
      ? { kind: "sign-in", consent: state.signIn === "consent" }
      : { kind: "error", why: "load" };
  }
  if (choice === "excluded") return { kind: "off", retry: status === "error" };
  if (!state.freshChat && choice !== "included") return { kind: "follow-up" };
  const stats = threadStats(state);
  if (stats.included === 0) return { kind: "nothing" };
  if (stats.trimFailed) return { kind: "error", why: "trim" };
  return {
    kind: "sent",
    included: stats.included,
    total: THREAD_MESSAGES.length,
  };
}

const showsAttachments = (state: OutlookStoryState) =>
  state.attachments.length > 0 &&
  (state.host === "compose" ||
    state.threadStatus === "none" ||
    state.threadStatus === "error");

function attachmentDisposition(
  state: OutlookStoryState,
  attachment: OutlookStoryAttachment,
): AttachmentDisposition {
  if (state.dismissedAttachments.includes(attachment.id)) return "off";
  if (attachment.cloud) return "cloud";
  if (state.attachmentsGroupOff) return "off";
  if (state.sentAttachmentIds.includes(attachment.id)) return "sent-earlier";
  if (state.drops.length > 0) return "not-with-drops";
  if (!state.freshChat && !state.followUpIds.includes(attachment.id)) {
    return "follow-up";
  }
  return "sent";
}

const hasDraft = (state: OutlookStoryState) =>
  state.host === "compose" &&
  (state.itemKind === "appointment" || state.draft !== "none");

/** What the facet does with the draft, and whether sticky scheduling holds its slot. */
function sendPreview(state: OutlookStoryState): {
  draft: DraftDisposition | "none";
  scheduling: boolean;
} {
  const eligible = hasDraft(state) && !state.draftOff;
  if (state.host === "compose" && state.selection === "active") {
    return { draft: eligible ? "selection" : "none", scheduling: false };
  }
  if (state.scheduling && state.itemKind !== "appointment") {
    return { draft: eligible ? "scheduling" : "none", scheduling: true };
  }
  if (!eligible) return { draft: "none", scheduling: false };
  return {
    draft: state.draft === "unchanged" ? "unchanged" : "sent",
    scheduling: false,
  };
}

interface Note {
  tone: "info" | "warning" | "error";
  title?: string;
  text: string;
}

const DetailNote = ({ note }: { note: Note }) => (
  <div data-ui="outlook-context-detail-note" data-tone={note.tone}>
    <Alert role="none" type={note.tone}>
      {note.title ? (
        <>
          <strong className="block font-semibold">{note.title}</strong>{" "}
          {note.text}
        </>
      ) : (
        note.text
      )}
    </Alert>
  </div>
);

const Notes = ({ notes }: { notes: Note[] }) => (
  <>
    {notes.map((note) => (
      <DetailNote key={note.text} note={note} />
    ))}
  </>
);

const Lifetime = ({ text }: { text?: string }) =>
  text ? (
    <p
      className="text-xs text-theme-fg-secondary"
      data-ui="outlook-context-detail-lifetime"
    >
      {text}
    </p>
  ) : null;

interface Field {
  label: string;
  value: string;
}

const Fields = ({ fields }: { fields: Field[] }) =>
  fields.length > 0 ? (
    <dl
      data-ui="outlook-context-detail-fields"
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm"
    >
      {fields.map((field) => (
        <div key={field.label} className="contents">
          <dt className="text-theme-fg-secondary">{field.label}</dt>
          <dd className="min-w-0 break-words text-theme-fg-primary">
            {field.value}
          </dd>
        </div>
      ))}
    </dl>
  ) : null;

const Quote = ({ label, text }: { label: string; text: string }) => (
  <blockquote
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroll region must take focus to scroll by keyboard
    tabIndex={0}
    aria-label={label}
    data-ui="outlook-context-detail-quote"
    className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-r-[var(--theme-radius-control)] border-l-2 border-theme-border bg-theme-bg-secondary py-2 pl-3 pr-2 text-sm text-theme-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus"
  >
    {text}
  </blockquote>
);

const Checklist = ({
  group,
  disabled,
}: {
  group: FileAttachmentGroup;
  disabled: boolean;
}) => (
  <div data-ui="outlook-context-detail-checklist">
    <GroupedFileAttachmentsPreview
      groups={[group]}
      disabled={disabled}
      showFileTypes={true}
      showFileSizes={true}
      defaultVisibleItems={Number.POSITIVE_INFINITY}
    />
  </div>
);

const Detail = ({
  intro,
  notes = [],
  fields = [],
  quote,
  replyNote,
  checklist,
  lifetime,
}: {
  intro?: string;
  notes?: Note[];
  fields?: Field[];
  quote?: { label: string; text: string };
  replyNote?: string;
  checklist?: { group: FileAttachmentGroup; disabled: boolean } | null;
  lifetime?: string;
}) => (
  <div className="flex flex-col gap-3">
    {intro ? <p className="text-sm text-theme-fg-secondary">{intro}</p> : null}
    <Notes notes={notes} />
    <Fields fields={fields} />
    {quote ? <Quote {...quote} /> : null}
    {replyNote ? (
      <p className="text-xs text-theme-fg-secondary">{replyNote}</p>
    ) : null}
    {checklist ? <Checklist {...checklist} /> : null}
    <Lifetime text={lifetime} />
  </div>
);

const LIFETIME_ITEM = "Leaving it out lasts until you switch mail items.";
const FOLLOW_UP_META = "Not included on follow-up messages";
const NOTHING_CHOSEN_META = "Nothing chosen";
const TRIM_FAILED_META = "Couldn't leave out unticked parts";
const SENT_EARLIER_META = "Sent earlier, not re-sent";
const NOT_WITH_DROPS_META = "Not sent with dropped emails";
const TRIM_FAILED_NOTE =
  "Some unticked attachments sit inside a forwarded email and can't be cut out, so a message with this email is not sent. Tick them again, or leave the email out.";
const THREAD_LIFETIME =
  "Leaving the email out lasts until you switch mail items. Including it again restores these ticks.";
const THREAD_NOT_INCLUDED: Note = {
  tone: "info",
  text: "The email is not included right now. Your choices below are kept and come back when you include it.",
};
const EMAIL_THREAD_LOADED = "Email thread loaded.";

const messageCount = (count: number) =>
  `${count} ${count === 1 ? "message" : "messages"}`;

function attachmentNote(
  disposition: AttachmentDisposition,
  compose: boolean,
): Note | null {
  switch (disposition) {
    case "cloud":
      return {
        tone: "error",
        text: "This is a link to a cloud file, which Outlook can't hand over, so it is not sent.",
      };
    case "sent-earlier":
      return {
        tone: "info",
        text: "Erato already has this file from an earlier message, so it is not sent again.",
      };
    case "not-with-drops":
      return {
        tone: "info",
        text: compose
          ? "Your draft's attachments are not sent while dropped emails are attached."
          : "This email's attachments are not sent while dropped emails are attached.",
      };
    case "follow-up":
      return {
        tone: "info",
        text: "Attachments go with the first message only. Include it to send it with this one.",
      };
    default:
      return null;
  }
}

export interface OutlookStorySimulations {
  selectText: () => void;
  clearSelection: () => void;
  editDraft: () => void;
  send: () => void;
  switchMailItem: () => void;
  readCalendar: () => void;
  threadLoads: () => void;
  threadFails: () => void;
  dropTwoEmails: () => void;
}

const without = (list: string[], id: string) =>
  list.filter((entry) => entry !== id);
const withId = (list: string[], id: string) =>
  list.includes(id) ? list : [...list, id];

/**
 * Plays the add-in's resolvers: (x), (+), detail actions and checklist ticks
 * change the story's state, and every chip and the mode are derived from it
 * again, as `previewOutlookSend()` and `planOutlookFiles()` do in the add-in.
 */
export const useOutlookStoryResolver = (
  seed: OutlookStorySeed,
): {
  items: ComposerContextItem[];
  modes: ComposerMode[];
  /** The composer waits: the thread is loading, emails are being read, or a send is uploading. */
  composerDisabled: boolean;
  simulate: OutlookStorySimulations;
} => {
  const [state, setState] = useState<OutlookStoryState>(() => ({
    ...DEFAULTS,
    ...seed,
  }));
  const timers = useRef<number[]>([]);
  const later = useCallback((ms: number, run: () => void) => {
    timers.current.push(window.setTimeout(run, ms));
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((id) => window.clearTimeout(id));
  }, []);
  const patch = useCallback(
    (next: (current: OutlookStoryState) => Partial<OutlookStoryState>) =>
      setState((current) => ({ ...current, ...next(current) })),
    [],
  );

  const load = useCallback(() => {
    patch(() => ({ threadStatus: "loading", signIn: null }));
    later(READ_MS, () =>
      patch((current) => ({
        threadStatus: current.retryLandsOn,
      })),
    );
  }, [later, patch]);

  const signIn = useCallback(() => {
    patch(() => ({ threadStatus: "loading", signIn: null, signingIn: true }));
    later(SIGN_IN_MS, () =>
      patch(() => ({ threadStatus: "ready", signingIn: false })),
    );
  }, [later, patch]);

  const simulate = useMemo<OutlookStorySimulations>(
    () => ({
      selectText: () => patch(() => ({ selection: "active" })),
      clearSelection: () => patch(() => ({ selection: null })),
      editDraft: () =>
        patch((current) => ({
          draft: current.draft === "none" ? "none" : "changed",
        })),
      send: () =>
        patch((current) => {
          const preview = sendPreview(current);
          const disposition = threadDisposition(current);
          const sent = showsAttachments(current)
            ? current.attachments
                .filter(
                  (attachment) =>
                    attachmentDisposition(current, attachment) === "sent",
                )
                .map((attachment) => attachment.id)
            : [];
          return {
            freshChat: false,
            draft:
              preview.draft === "sent" && current.draft === "changed"
                ? "unchanged"
                : current.draft,
            threadSentInChat:
              current.threadSentInChat || disposition.kind === "sent",
            threadChoice:
              current.threadChoice === "included" ? null : current.threadChoice,
            sentAttachmentIds: [...current.sentAttachmentIds, ...sent],
            followUpIds: [],
            drops: [],
            dismissedDropAttachments: {},
          };
        }),
      switchMailItem: () => {
        patch((current) => ({
          threadStatus: current.host === "read" ? "loading" : "none",
          signIn: null,
          threadChoice: null,
          threadSentInChat: false,
          untickedMessages: [],
          untickedAttachments: [],
          openEmailDropped: false,
          draftOff: false,
          selection: null,
          dismissedAttachments: [],
          attachmentsGroupOff: false,
          sentAttachmentIds: [],
          followUpIds: [],
        }));
        later(READ_MS, () =>
          patch((current) => ({
            threadStatus:
              current.host === "read" ? current.retryLandsOn : "none",
          })),
        );
      },
      readCalendar: () => patch(() => ({ scheduling: true })),
      threadLoads: () => patch(() => ({ threadStatus: "ready", signIn: null })),
      threadFails: () => patch(() => ({ threadStatus: "error", signIn: null })),
      dropTwoEmails: () => {
        const steps = [
          "Receiving 2 emails…",
          "Reading email 1 of 2…",
          "Reading email 2 of 2…",
          "Adding to the chat…",
        ];
        steps.forEach((step, index) =>
          later(index * DROP_STEP_MS, () =>
            patch(() => ({ dropProgress: step })),
          ),
        );
        later(steps.length * DROP_STEP_MS, () =>
          patch((current) => ({
            dropProgress: null,
            drops: [
              ...current.drops,
              ...[OFFSITE_DROP, BUDGET_DROP].filter(
                (drop) =>
                  !current.drops.some((staged) => staged.key === drop.key),
              ),
            ],
          })),
        );
      },
    }),
    [later, patch],
  );

  const items = useMemo(() => {
    const result: ComposerContextItem[] = [];
    const lock = state.sending ? { locked: true, lockReason: LOCK_REASON } : {};
    const preview = sendPreview(state);
    const appointment = state.itemKind === "appointment";
    const compose = state.host === "compose";

    // Selection: compose only, and only a rewrite facet carries it.
    if (compose && state.selection) {
      const dismissed = state.selection === "dismissed";
      let model: {
        state: ComposerContextState;
        meta?: string;
        notes: Note[];
      };
      if (dismissed) {
        model = { state: "suggested", notes: [] };
      } else if (preview.draft === "selection") {
        model = {
          state: "included",
          meta: appointment ? "Replaces appointment details" : "Replaces draft",
          notes: [
            {
              tone: "info",
              text: appointment
                ? "Sent instead of your appointment details, so Erato rewrites only this text."
                : "Sent instead of your draft, so Erato rewrites only this text.",
            },
          ],
        };
      } else {
        model = { state: "included", meta: "Selected text", notes: [] };
      }
      result.push({
        id: "outlook-selection",
        kind: "outlook.selection",
        origin: "ambient",
        dismissScope: "selection",
        icon: "selection",
        state: model.state,
        ...(model.meta ? { meta: model.meta } : {}),
        label: `“${OUTLOOK_SELECTION_TEXT}”`,
        spokenLabel: "Selection",
        ...lock,
        ...(dismissed
          ? {
              restoreLabel: "Include selection",
              onRestore: () => patch(() => ({ selection: "active" })),
            }
          : {
              removeLabel: "Dismiss selection",
              onRemove: () => patch(() => ({ selection: "dismissed" })),
            }),
        detail: {
          title: "Selected text",
          render: () => (
            <Detail
              quote={{ label: "Selected text", text: OUTLOOK_SELECTION_TEXT }}
              notes={model.notes}
              lifetime="Leaving it out lasts until the selection changes or you switch mail items."
            />
          ),
        },
      });
    }

    // Draft or appointment: compose only.
    if (hasDraft(state)) {
      const label = appointment ? "Appointment details" : "Your draft";
      const fields: Field[] = appointment
        ? [
            { label: "Subject", value: OUTLOOK_APPOINTMENT.subject },
            { label: "When", value: OUTLOOK_APPOINTMENT.whenLong },
            { label: "Where", value: OUTLOOK_APPOINTMENT.location },
            {
              label: "Attendees",
              value: OUTLOOK_APPOINTMENT.attendees.join(", "),
            },
          ]
        : [
            { label: "To", value: "Anna Weber" },
            { label: "Cc", value: "Tom Fischer" },
            ...(state.reply
              ? [
                  {
                    label: "Reply to",
                    value: `${OUTLOOK_THREAD_SUBJECT} — Anna Weber`,
                  },
                ]
              : []),
          ];
      let model: {
        state: ComposerContextState;
        meta?: string;
        notes: Note[];
        actions: ComposerContextDetailAction[];
      } | null;
      if (state.draftOff) {
        model = { state: "suggested", notes: [], actions: [] };
      } else if (preview.draft === "selection") {
        model = {
          state: "superseded",
          meta: "Replaced by selection",
          notes: [
            {
              tone: "info",
              text: appointment
                ? "Your selection is sent instead of your appointment details."
                : "Your selection is sent instead of your draft.",
            },
          ],
          actions: [
            {
              id: "send-instead",
              label: "Send this instead",
              variant: "primary",
              announcement: appointment
                ? "Appointment details included. Your selection is off until it changes."
                : "Draft included. Your selection is off until it changes.",
              onSelect: () => patch(() => ({ selection: "dismissed" })),
            },
          ],
        };
      } else if (preview.draft === "scheduling") {
        model = {
          state: "superseded",
          meta: "Not sent while scheduling",
          notes: [
            {
              tone: "info",
              text: "Scheduling takes priority, so this message does not carry your draft. End scheduling to send it again.",
            },
          ],
          actions: [
            {
              id: "end-scheduling",
              label: "End scheduling",
              variant: "primary",
              announcement: "Scheduling ended. Your draft is sent again.",
              onSelect: () => patch(() => ({ scheduling: false })),
            },
          ],
        };
      } else if (preview.draft === "unchanged") {
        model = {
          state: "superseded",
          meta: "Unchanged, not re-sent",
          notes: [
            {
              tone: "info",
              text: "Erato already has this version from an earlier message, so it is not sent again. It is sent again when you change it.",
            },
          ],
          actions: [],
        };
      } else if (preview.draft === "sent") {
        const meta = appointment
          ? OUTLOOK_APPOINTMENT.when
          : state.reply
            ? "Reply to Anna Weber"
            : undefined;
        model = {
          state: "included",
          ...(meta ? { meta } : {}),
          notes: [],
          actions: [],
        };
      } else {
        model = null;
      }
      if (model) {
        const { actions } = model;
        const notes = model.notes;
        result.push({
          id: "outlook-draft",
          kind: appointment ? "outlook.appointment" : "outlook.draft",
          origin: "ambient",
          dismissScope: "item",
          icon: appointment ? "calendar" : "draft",
          state: model.state,
          ...(model.meta ? { meta: model.meta } : {}),
          label,
          spokenLabel: appointment ? label : "Draft",
          ...lock,
          ...(model.state === "suggested"
            ? {
                restoreLabel: appointment
                  ? "Include appointment details"
                  : "Include draft",
                onRestore: () => patch(() => ({ draftOff: false })),
              }
            : {
                removeLabel: appointment
                  ? "Don't include appointment details"
                  : "Don't include draft",
                onRemove: () => patch(() => ({ draftOff: true })),
              }),
          detail: {
            title: label,
            render: () => (
              <Detail
                notes={notes}
                fields={fields}
                {...(!appointment
                  ? {
                      quote: { label: "Draft text", text: OUTLOOK_DRAFT_BODY },
                    }
                  : {})}
                {...(!appointment && state.reply
                  ? {
                      replyNote:
                        "The reply context is shown here only. It reaches Erato through your draft and is never sent on its own.",
                    }
                  : {})}
                lifetime={LIFETIME_ITEM}
              />
            ),
            ...(actions.length > 0 && !state.sending ? { actions } : {}),
          },
        });
      }
    }

    // The open thread: read mode with a conversation.
    const thread = threadDisposition(state);
    if (thread.kind !== "none" && thread.kind !== "hidden") {
      const stats = threadStats(state);
      const used = stats.included > 0 ? formatFileSize(stats.size) : null;
      const sizeLabel =
        used === null ? "Updating…" : `${used} of ${OUTLOOK_LIMIT}`;
      const intro = `Untick what Erato should not read. Attachments count toward the ${OUTLOOK_LIMIT} limit.`;
      const excluded = state.threadChoice === "excluded";
      let model: {
        state: ComposerContextState;
        tone?: ComposerContextTone;
        meta?: string;
        removeLabel: string;
        restoreLabel?: string;
        restore: () => void;
        restored?: string;
        actions: ComposerContextDetailAction[];
        intro?: string;
        notes: Note[];
        checklist: boolean;
        checklistMeta: string;
        lifetime?: string;
      };
      const include = () => patch(() => ({ threadChoice: "included" }));
      const base = {
        removeLabel: "Leave out the email",
        restore: include,
        actions: [],
        notes: [],
        checklist: false,
        checklistMeta: sizeLabel,
      };
      switch (thread.kind) {
        case "loading":
          model = {
            ...base,
            state: "loading",
            meta: state.signingIn ? "Signing in…" : "Loading email thread…",
          };
          break;
        case "error":
          model =
            thread.why === "load"
              ? {
                  ...base,
                  state: "error",
                  tone: "error",
                  meta: "Couldn't load the email thread",
                  removeLabel: "Dismiss email thread",
                  actions: [
                    {
                      id: "retry",
                      label: "Try again",
                      variant: "primary",
                      announcement: EMAIL_THREAD_LOADED,
                      onSelect: load,
                    },
                  ],
                  notes: [
                    {
                      tone: "error",
                      title: "Couldn't load the email thread",
                      text: "You can still send without this email context.",
                    },
                  ],
                }
              : {
                  ...base,
                  state: "error",
                  tone: "error",
                  meta: TRIM_FAILED_META,
                  removeLabel: "Dismiss email thread",
                  checklistMeta: "",
                  notes: [{ tone: "error", text: TRIM_FAILED_NOTE }],
                  checklist: true,
                  lifetime: THREAD_LIFETIME,
                };
          break;
        case "sign-in":
          model = {
            ...base,
            state: "attention",
            tone: "warning",
            meta: thread.consent
              ? "Allow access to load email"
              : "Sign in to load email",
            actions: [
              {
                id: "sign-in",
                label: thread.consent ? "Allow access" : "Sign in",
                variant: "primary",
                announcement: EMAIL_THREAD_LOADED,
                onSelect: signIn,
              },
            ],
            notes: [
              {
                tone: "warning",
                text: thread.consent
                  ? "This email wasn't attached because reading its mailbox needs a permission you haven't granted yet."
                  : "This email wasn't attached because reading it needs a quick sign-in.",
              },
            ],
          };
          break;
        case "off":
          model = {
            ...base,
            state: "suggested",
            restoreLabel: thread.retry
              ? "Try loading the email again"
              : "Include the email",
            restore: thread.retry
              ? () => {
                  load();
                  include();
                }
              : include,
            notes: [THREAD_NOT_INCLUDED],
            checklist: !thread.retry,
            lifetime: THREAD_LIFETIME,
          };
          break;
        case "follow-up":
          model = {
            ...base,
            state: "suggested",
            meta: FOLLOW_UP_META,
            restoreLabel: "Include the email",
            notes: [THREAD_NOT_INCLUDED],
            checklist: true,
            lifetime: THREAD_LIFETIME,
          };
          break;
        case "nothing":
          model = {
            ...base,
            state: "suggested",
            meta: NOTHING_CHOSEN_META,
            checklistMeta: "",
            restoreLabel: "Include every message",
            restore: () => {
              patch(() => ({ untickedMessages: [], untickedAttachments: [] }));
              include();
            },
            restored: "Email thread included.",
            intro,
            checklist: true,
            lifetime: THREAD_LIFETIME,
          };
          break;
        case "sent": {
          const partial = thread.included < thread.total;
          const count = partial
            ? `${thread.included} of ${thread.total} messages`
            : messageCount(thread.total);
          model = {
            ...base,
            state: "included",
            meta: `${count} · ${sizeLabel}`,
            ...(partial
              ? {
                  restored:
                    "Email thread included. Your earlier choice is back.",
                }
              : {}),
            intro,
            checklist: true,
            lifetime: THREAD_LIFETIME,
          };
          break;
        }
      }
      // Ticking while the email is left out brings it back, as (+) would.
      const tick = (
        next: (current: OutlookStoryState) => Partial<OutlookStoryState>,
      ) =>
        patch((current) => ({
          ...next(current),
          ...(excluded ? { threadChoice: "included" as const } : {}),
        }));
      const group: FileAttachmentGroup = {
        id: "staged-email:current-thread",
        label: messageCount(THREAD_MESSAGES.length),
        metaLabel: model.checklistMeta,
        items: THREAD_MESSAGES.map((message) => {
          const messageOff = state.untickedMessages.includes(message.id);
          return {
            kind: "threadMessageGroup" as const,
            id: message.id,
            label: message.from,
            sublabel: `${message.date} · ${message.subject}`,
            selected: !messageOff,
            onToggle: () =>
              tick((current) => ({
                untickedMessages: messageOff
                  ? without(current.untickedMessages, message.id)
                  : withId(current.untickedMessages, message.id),
              })),
            defaultCollapsed: false,
            attachments: message.attachments.map((attachment) => {
              const off = state.untickedAttachments.includes(attachment.id);
              return {
                id: attachment.id,
                file: {
                  id: attachment.id,
                  filename: attachment.name,
                  size: attachment.size,
                },
                selected: !messageOff && !off,
                onToggle: () =>
                  tick((current) => {
                    if (messageOff) {
                      // Bringing the message back brings only the ticked attachment.
                      const siblings = message.attachments
                        .map((entry) => entry.id)
                        .filter((id) => id !== attachment.id);
                      return {
                        untickedMessages: without(
                          current.untickedMessages,
                          message.id,
                        ),
                        untickedAttachments: [
                          ...without(
                            current.untickedAttachments,
                            attachment.id,
                          ),
                          ...siblings.filter(
                            (id) => !current.untickedAttachments.includes(id),
                          ),
                        ],
                      };
                    }
                    return {
                      untickedAttachments: off
                        ? without(current.untickedAttachments, attachment.id)
                        : withId(current.untickedAttachments, attachment.id),
                    };
                  }),
              };
            }),
          };
        }),
      };
      const shown = model;
      result.push({
        id: "outlook-thread",
        kind: "outlook.thread",
        origin: "ambient",
        dismissScope: "item",
        icon: "mail",
        state: shown.state,
        ...(shown.tone ? { tone: shown.tone } : {}),
        ...(shown.meta ? { meta: shown.meta } : {}),
        label: OUTLOOK_THREAD_SUBJECT,
        spokenLabel: "Email thread",
        ...lock,
        ...(shown.state === "suggested"
          ? { restoreLabel: shown.restoreLabel, onRestore: shown.restore }
          : {
              removeLabel: shown.removeLabel,
              onRemove: () => patch(() => ({ threadChoice: "excluded" })),
            }),
        ...(shown.restored
          ? { announcements: { restored: shown.restored } }
          : {}),
        detail: {
          title: OUTLOOK_THREAD_SUBJECT,
          render: () => (
            <Detail
              intro={shown.intro}
              notes={shown.notes}
              checklist={
                shown.checklist ? { group, disabled: state.sending } : null
              }
              lifetime={shown.lifetime}
            />
          ),
          ...(shown.actions.length > 0 && !state.sending
            ? { actions: shown.actions }
            : {}),
        },
      });
    }

    // Office.js attachments: the draft's, or the open email's without a thread.
    if (showsAttachments(state)) {
      const shown = state.attachments.map((attachment) => ({
        attachment,
        disposition: attachmentDisposition(state, attachment),
        ticked: !state.dismissedAttachments.includes(attachment.id),
      }));
      const dismiss = (id: string) =>
        patch((current) => ({
          dismissedAttachments: withId(current.dismissedAttachments, id),
        }));
      const restore = (id: string) =>
        patch((current) => ({
          dismissedAttachments: without(current.dismissedAttachments, id),
        }));
      const followUp = (ids: string[]) =>
        patch((current) => ({
          followUpIds: [...new Set([...current.followUpIds, ...ids])],
        }));
      if (shown.length <= 2) {
        for (const { attachment, disposition } of shown) {
          const name = attachment.name;
          const note = attachmentNote(disposition, compose);
          let model: {
            state: ComposerContextState;
            tone?: ComposerContextTone;
            meta?: string;
            removeLabel?: string;
            onRestore?: () => void;
          };
          switch (disposition) {
            case "cloud":
              model = {
                state: "error",
                tone: "error",
                meta: "Cloud file · can't be sent",
                removeLabel: `Dismiss ${name}`,
              };
              break;
            case "off":
              model = {
                state: "suggested",
                onRestore: state.freshChat
                  ? () => restore(attachment.id)
                  : () => {
                      restore(attachment.id);
                      followUp([attachment.id]);
                    },
              };
              break;
            case "sent-earlier":
              model = { state: "superseded", meta: SENT_EARLIER_META };
              break;
            case "not-with-drops":
              model = { state: "superseded", meta: NOT_WITH_DROPS_META };
              break;
            case "follow-up":
              model = {
                state: "suggested",
                meta: FOLLOW_UP_META,
                onRestore: () => followUp([attachment.id]),
              };
              break;
            default:
              model = {
                state: "included",
                meta: `${compose ? "Draft attachment" : "Email attachment"} · ${formatFileSize(attachment.size)}`,
              };
          }
          const fields: Field[] = [
            { label: "Type", value: attachment.type },
            { label: "Size", value: formatFileSize(attachment.size) },
          ];
          result.push({
            id: `outlook-attachment:${attachment.id}`,
            kind: compose
              ? "outlook.draftAttachment"
              : "outlook.mailAttachment",
            origin: "ambient",
            dismissScope: "item",
            icon: "attachment",
            state: model.state,
            ...(model.tone ? { tone: model.tone } : {}),
            ...(model.meta ? { meta: model.meta } : {}),
            label: name,
            ...lock,
            ...(model.state === "suggested"
              ? { restoreLabel: `Include ${name}`, onRestore: model.onRestore }
              : {
                  removeLabel: model.removeLabel ?? `Don't include ${name}`,
                  onRemove: () => dismiss(attachment.id),
                }),
            detail: {
              title: name,
              render: () => (
                <Detail
                  fields={fields}
                  notes={note ? [note] : []}
                  lifetime={LIFETIME_ITEM}
                />
              ),
            },
          });
        }
      } else {
        const count = shown.length;
        const going = shown.filter(({ disposition }) => disposition === "sent");
        const tickedSendable = shown.filter(
          ({ ticked, attachment }) => ticked && !attachment.cloud,
        );
        const unsentTicked = tickedSendable.filter(
          ({ disposition }) => disposition !== "sent-earlier",
        );
        const followUpIds = state.freshChat
          ? []
          : (tickedSendable.length === 0
              ? shown.filter(({ attachment }) => !attachment.cloud)
              : unsentTicked
            ).map(({ attachment }) => attachment.id);
        const tickAll = tickedSendable.length === 0;
        let model: {
          state: ComposerContextState;
          meta?: string;
          notes: Note[];
        };
        const note = (disposition: AttachmentDisposition) => {
          const found = attachmentNote(disposition, compose);
          return found ? [found] : [];
        };
        if (state.attachmentsGroupOff) {
          model = { state: "suggested", notes: [] };
        } else if (going.length === 0) {
          if (tickedSendable.length > 0 && unsentTicked.length === 0) {
            model = {
              state: "superseded",
              meta: SENT_EARLIER_META,
              notes: note("sent-earlier"),
            };
          } else if (
            tickedSendable.some(
              ({ disposition }) => disposition === "not-with-drops",
            )
          ) {
            model = {
              state: "superseded",
              meta: NOT_WITH_DROPS_META,
              notes: note("not-with-drops"),
            };
          } else if (unsentTicked.length > 0) {
            model = {
              state: "suggested",
              meta: FOLLOW_UP_META,
              notes: note("follow-up"),
            };
          } else {
            model = {
              state: "suggested",
              meta: NOTHING_CHOSEN_META,
              notes: [],
            };
          }
        } else {
          const size = formatFileSize(
            going.reduce((total, { attachment }) => total + attachment.size, 0),
          );
          model = {
            state: "included",
            meta: `${going.length} of ${count} · ${size}`,
            notes: [],
          };
        }
        const label = compose
          ? `Draft attachments (${count})`
          : `Email attachments (${count})`;
        const spokenLabel = compose ? "Draft attachments" : "Email attachments";
        const group: FileAttachmentGroup = {
          id: "outlook-attachments",
          label: spokenLabel,
          metaLabel: "",
          items: shown.map(
            ({ attachment, ticked }): FileAttachmentGroupItem => ({
              kind: "selectableAttachment",
              id: attachment.id,
              file: {
                id: attachment.id,
                filename: attachment.name,
                size: attachment.size,
              },
              selected: ticked && !attachment.cloud,
              ...(attachment.cloud
                ? { metaLabel: "Cloud file · can't be sent" }
                : {
                    onToggle: () =>
                      ticked ? dismiss(attachment.id) : restore(attachment.id),
                  }),
            }),
          ),
        };
        const notes = model.notes;
        result.push({
          id: "outlook-attachments",
          kind: compose
            ? "outlook.draftAttachments"
            : "outlook.mailAttachments",
          origin: "ambient",
          dismissScope: "item",
          icon: "attachment",
          state: model.state,
          ...(model.meta ? { meta: model.meta } : {}),
          label,
          spokenLabel,
          ...lock,
          ...(model.state === "suggested"
            ? {
                restoreLabel: compose
                  ? "Include draft attachments"
                  : "Include email attachments",
                onRestore: () =>
                  patch((current) => ({
                    attachmentsGroupOff: false,
                    ...(tickAll
                      ? {
                          dismissedAttachments:
                            current.dismissedAttachments.filter((id) =>
                              current.attachments.some(
                                (entry) => entry.id === id && entry.cloud,
                              ),
                            ),
                        }
                      : {}),
                    followUpIds: [
                      ...new Set([...current.followUpIds, ...followUpIds]),
                    ],
                  })),
              }
            : {
                removeLabel: compose
                  ? "Don't include draft attachments"
                  : "Don't include email attachments",
                onRemove: () => patch(() => ({ attachmentsGroupOff: true })),
              }),
          detail: {
            title: label,
            render: () => (
              <Detail
                notes={notes}
                checklist={{ group, disabled: state.sending }}
                lifetime={LIFETIME_ITEM}
              />
            ),
          },
        });
      }
    }

    // Dropped emails, in drop order.
    for (const drop of state.drops) {
      const dismissed = state.dismissedDropAttachments[drop.key] ?? [];
      const kept = drop.attachments.filter(
        (attachment) => !dismissed.includes(attachment.id),
      );
      const trimFailed =
        drop.trimBlocked !== undefined && dismissed.includes(drop.trimBlocked);
      const senderAndDate = `${drop.sender} • ${drop.date}`;
      const total = drop.attachments.length;
      const meta = trimFailed
        ? TRIM_FAILED_META
        : [
            senderAndDate,
            total > 0
              ? `${kept.length}/${total} ${total === 1 ? "attachment" : "attachments"}`
              : "",
          ]
            .filter((part) => part.length > 0)
            .join(" · ");
      const toggle = (attachmentId: string) =>
        patch((current) => {
          const list = current.dismissedDropAttachments[drop.key] ?? [];
          return {
            dismissedDropAttachments: {
              ...current.dismissedDropAttachments,
              [drop.key]: list.includes(attachmentId)
                ? without(list, attachmentId)
                : [...list, attachmentId],
            },
          };
        });
      const group: FileAttachmentGroup = {
        id: `staged-email:${drop.key}`,
        label: senderAndDate,
        metaLabel: "",
        items: [
          {
            kind: "selectableAttachment",
            id: `${drop.key}:body`,
            file: {
              id: `${drop.key}:body`,
              filename: drop.fileName,
              displayName: "Email body",
              size: drop.bodySize,
            },
            metaLabel: `Email · ${formatFileSize(drop.bodySize)} · Always sent`,
            selected: true,
            labelOverride: "Email",
          },
          ...drop.attachments.map(
            (attachment): FileAttachmentGroupItem => ({
              kind: "selectableAttachment",
              id: `${drop.key}:${attachment.id}`,
              file: {
                id: `${drop.key}:${attachment.id}`,
                filename: attachment.name,
                size: attachment.size,
              },
              selected: !dismissed.includes(attachment.id),
              onToggle: () => toggle(attachment.id),
            }),
          ),
        ],
      };
      result.push({
        id: `outlook-drop:${drop.key}`,
        kind: "outlook.droppedEmail",
        origin: "user",
        icon: "mail",
        state: trimFailed ? "error" : "included",
        ...(trimFailed ? { tone: "error" as const } : {}),
        meta,
        label: drop.subject,
        ...lock,
        removeLabel: `Remove ${drop.subject}`,
        onRemove: () =>
          patch((current) => ({
            drops: current.drops.filter((entry) => entry.key !== drop.key),
          })),
        detail: {
          title: drop.subject,
          render: () => (
            <Detail
              notes={
                trimFailed ? [{ tone: "error", text: TRIM_FAILED_NOTE }] : []
              }
              checklist={{ group, disabled: state.sending }}
            />
          ),
        },
      });
    }

    if (state.dropProgress) {
      result.push({
        id: "outlook-drop-progress",
        kind: "outlook.dropProgress",
        origin: "user",
        icon: "mail",
        state: "loading",
        label: state.dropProgress,
        spokenLabel: "Dropped emails",
        locked: true,
        lockReason: "Dropped emails can't be cancelled while Erato reads them",
      });
    }
    return result;
  }, [state, patch, load, signIn]);

  const modes = useMemo<ComposerMode[]>(() => {
    if (!sendPreview(state).scheduling) return [];
    return [
      {
        id: "outlook.scheduling",
        label: "Scheduling",
        icon: "clock",
        description: `Scheduling stays on for an hour after Erato last read your calendar (until ${OUTLOOK_SCHEDULING_UNTIL}).`,
        endLabel: "End scheduling",
        onEnd: () => patch(() => ({ scheduling: false })),
        endedAnnouncement:
          sendPreview(state).draft === "scheduling"
            ? "Scheduling ended. Your draft is sent again."
            : "Scheduling ended.",
        ...(state.sending ? { locked: true, lockReason: LOCK_REASON } : {}),
      },
    ];
  }, [state, patch]);

  const composerDisabled =
    state.sending ||
    state.dropProgress !== null ||
    threadDisposition(state).kind === "loading";

  return { items, modes, composerDisabled, simulate };
};
