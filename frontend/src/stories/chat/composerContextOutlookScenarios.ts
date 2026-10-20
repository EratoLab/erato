/*
 * The Outlook stories' data and seeds. No imports: the add-in's parity test
 * (office-addin/src/outlook/utils/__tests__/outlookStoryParity.test.ts) runs
 * the add-in's own resolvers on these same scenarios and writes the chips
 * each story has to draw, which the Storybook spec then holds the stories to.
 */

export const KB = 1024;
export const OUTLOOK_LIMIT = "25 MB";
export const OUTLOOK_THREAD_SUBJECT = "RE: Q4 vendor contract renewal";
export const OUTLOOK_REPLY_SENDER = "Anna Weber";
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

export interface OutlookStoryThreadAttachment {
  id: string;
  name: string;
  size: number;
}

export interface OutlookStoryThreadMessage {
  id: string;
  from: string;
  date: string;
  subject: string;
  size: number;
  attachments: OutlookStoryThreadAttachment[];
}

export const THREAD_MESSAGES: OutlookStoryThreadMessage[] = [
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
const cloudFile = (id: string, name: string): OutlookStoryAttachment => ({
  id,
  name,
  size: 0,
  type: "DOCX",
  cloud: true,
});

export interface OutlookStoryDrop {
  key: string;
  subject: string;
  sender: string;
  date: string;
  fileName: string;
  bodySize: number;
  attachments: OutlookStoryThreadAttachment[];
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

export type OutlookStoryThreadStatus = "none" | "loading" | "ready" | "error";

export interface OutlookStoryState {
  host: "read" | "compose";
  /** No message has been sent in this chat yet. */
  freshChat: boolean;
  /** A send is uploading: every chip and the mode keep still. */
  sending: boolean;
  /** Sticky scheduling: Erato read the calendar within the hour. */
  scheduling: boolean;

  /** "none": no mail backend, so no thread; the email's attachments go instead. */
  threadStatus: OutlookStoryThreadStatus;
  /** With "error": reading the mailbox needs an interactive step. */
  signIn: "sign-in" | "consent" | null;
  signingIn: boolean;
  threadChoice: "included" | "excluded" | null;
  /** The thread went with a message of this chat while this item was open. */
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

export const OUTLOOK_STORY_DEFAULTS: OutlookStoryState = {
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

/**
 * The thread file a story's ticks build, as the add-in's provider would: how
 * many messages go, its size, and whether an untick needs a trim the bytes
 * refuse.
 */
export const storyThreadStats = (state: OutlookStoryState) => {
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
  return {
    included: kept.length,
    total: THREAD_MESSAGES.length,
    size,
    trimFailed,
  };
};

/** A dropped email's resolution: what is kept of it and whether its trim failed. */
export const storyDropStats = (
  state: OutlookStoryState,
  drop: OutlookStoryDrop,
) => {
  const dismissed = state.dismissedDropAttachments[drop.key] ?? [];
  const kept = drop.attachments.filter(
    (attachment) => !dismissed.includes(attachment.id),
  );
  return {
    dismissed,
    kept: kept.length,
    total: drop.attachments.length,
    size: drop.bodySize + kept.reduce((sum, entry) => sum + entry.size, 0),
    trimFailed:
      drop.trimBlocked !== undefined && dismissed.includes(drop.trimBlocked),
  };
};

const PARTIAL: OutlookStorySeed = {
  untickedMessages: ["m2", "m5"],
  untickedAttachments: ["m3:a1"],
};
const EVERY_MESSAGE_OFF: OutlookStorySeed = {
  untickedMessages: ["m1", "m2", "m3", "m4", "m5"],
};
const COMPOSE: OutlookStorySeed = {
  host: "compose",
  threadStatus: "none",
  attachments: [CONTRACT, PRICING],
};

/** Every story's seed, by its export name. */
export const OUTLOOK_STORIES = {
  // Read: the open email.
  ThreadIncluded: {},
  ThreadPartial: PARTIAL,
  ThreadLoading: { threadStatus: "loading" },
  ThreadError: { threadStatus: "error" },
  ThreadErrorAgain: { threadStatus: "error", retryLandsOn: "error" },
  ThreadSignIn: { threadStatus: "error", signIn: "sign-in" },
  ThreadConsent: { threadStatus: "error", signIn: "consent" },
  ThreadSigningIn: { threadStatus: "loading", signingIn: true },
  ThreadOff: { ...PARTIAL, threadChoice: "excluded" },
  ThreadFollowUp: { freshChat: false },
  ThreadFollowUpLoading: { freshChat: false, threadStatus: "loading" },
  ThreadFollowUpError: {
    freshChat: false,
    threadStatus: "error",
    signIn: "sign-in",
  },
  ThreadNothingChosen: EVERY_MESSAGE_OFF,
  ThreadTrimFailed: { untickedAttachments: ["m4:a1"], trimBlocked: "m4:a1" },
  ThreadSentInChat: { freshChat: false, threadSentInChat: true },
  ThreadDroppedAsEmail: { openEmailDropped: true, drops: [OFFSITE_DROP] },
  Drops: { drops: [OFFSITE_DROP, BUDGET_DROP] },
  DropTrimFailed: {
    drops: [{ ...OFFSITE_DROP, trimBlocked: "att-1" }],
    dismissedDropAttachments: { [OFFSITE_DROP.key]: ["att-1"] },
  },
  Dropping: { dropProgress: "Reading email 1 of 2…" },
  MailAttachmentsNoGraph: {
    threadStatus: "none",
    attachments: [CONTRACT, PRICING],
  },
  MailAttachmentsWithDrop: {
    threadStatus: "none",
    attachments: [CONTRACT],
    drops: [OFFSITE_DROP],
  },
  ReadScheduling: { scheduling: true },

  // Compose: the draft or appointment and what rides with it.
  Draft: COMPOSE,
  DraftNewMessage: { ...COMPOSE, reply: false, attachments: [] },
  DraftUnchanged: {
    ...COMPOSE,
    freshChat: false,
    draft: "unchanged",
    sentAttachmentIds: [CONTRACT.id, PRICING.id],
  },
  DraftOff: { ...COMPOSE, draftOff: true },
  Selection: { ...COMPOSE, selection: "active" },
  SelectionDismissed: { ...COMPOSE, selection: "dismissed" },
  SelectionNoDraft: {
    ...COMPOSE,
    draft: "none",
    attachments: [],
    selection: "active",
  },
  SelectionDraftUnchanged: {
    ...COMPOSE,
    freshChat: false,
    draft: "unchanged",
    attachments: [],
    selection: "active",
  },
  Appointment: { ...COMPOSE, itemKind: "appointment", attachments: [] },
  AppointmentSelection: {
    ...COMPOSE,
    itemKind: "appointment",
    attachments: [],
    selection: "active",
  },
  AttachmentsGroup: { ...COMPOSE, attachments: [CONTRACT, PRICING, SCHEDULE] },
  AttachmentsGroupPartial: {
    ...COMPOSE,
    attachments: [CONTRACT, PRICING, SCHEDULE],
    dismissedAttachments: [PRICING.id],
  },
  AttachmentsGroupOff: {
    ...COMPOSE,
    attachments: [CONTRACT, PRICING, SCHEDULE],
    attachmentsGroupOff: true,
  },
  AttachmentsGroupCloud: {
    ...COMPOSE,
    attachments: [
      CLOUD_FILE,
      cloudFile("a5", "Price list.xlsx"),
      cloudFile("a6", "Board deck.pptx"),
    ],
  },
  AttachmentsFollowUp: {
    ...COMPOSE,
    freshChat: false,
    draft: "unchanged",
    sentAttachmentIds: [CONTRACT.id],
  },
  AttachmentsSentEarlier: {
    ...COMPOSE,
    freshChat: false,
    draft: "unchanged",
    attachments: [CONTRACT, PRICING, SCHEDULE],
    sentAttachmentIds: [CONTRACT.id, PRICING.id, SCHEDULE.id],
  },
  CloudAttachment: { ...COMPOSE, attachments: [CONTRACT, CLOUD_FILE] },
  AttachmentsWithDrop: { ...COMPOSE, drops: [OFFSITE_DROP] },
  Scheduling: { ...COMPOSE, scheduling: true },
  SchedulingUnchanged: {
    ...COMPOSE,
    freshChat: false,
    draft: "unchanged",
    attachments: [],
    scheduling: true,
  },
  Sending: {
    ...COMPOSE,
    scheduling: true,
    drops: [OFFSITE_DROP],
    sending: true,
  },
  Busy: {
    ...COMPOSE,
    selection: "active",
    attachments: [CONTRACT, PRICING, SCHEDULE],
    drops: [OFFSITE_DROP, BUDGET_DROP],
  },
  InteractiveRead: {},
  InteractiveCompose: COMPOSE,
} satisfies Record<string, OutlookStorySeed>;

export type OutlookStoryName = keyof typeof OUTLOOK_STORIES;

/**
 * Where the spec's flows land: the story they start from and the state the
 * add-in's handlers leave behind, e.g. (x) on the thread leaves it excluded.
 */
export const OUTLOOK_STORY_FLOWS = {
  "ThreadPartial: Delete": {
    story: "ThreadPartial",
    then: { threadChoice: "excluded" },
  },
  "ThreadError: Delete": {
    story: "ThreadError",
    then: { threadChoice: "excluded" },
  },
  "ThreadError: Delete, + loads": {
    story: "ThreadError",
    then: { threadChoice: "included", threadStatus: "ready" },
  },
  "ThreadErrorAgain: + fails again": {
    story: "ThreadErrorAgain",
    then: { threadChoice: "included" },
  },
  "ThreadSignIn: Sign in loads": {
    story: "ThreadSignIn",
    then: { threadChoice: "included", threadStatus: "ready", signIn: null },
  },
  "ThreadFollowUp: +": {
    story: "ThreadFollowUp",
    then: { threadChoice: "included" },
  },
  "ThreadFollowUpError: + loads": {
    story: "ThreadFollowUpError",
    then: { threadChoice: "included", threadStatus: "ready", signIn: null },
  },
  "InteractiveRead: send": {
    story: "InteractiveRead",
    then: { freshChat: false, threadSentInChat: true },
  },
  "Drops: Delete the first": {
    story: "Drops",
    then: { drops: [BUDGET_DROP] },
  },
  "Selection: Delete": {
    story: "Selection",
    then: { selection: "dismissed" },
  },
  "Draft: Delete": { story: "Draft", then: { draftOff: true } },
  "AttachmentsGroup: untick pricing, Delete": {
    story: "AttachmentsGroup",
    then: { dismissedAttachments: [PRICING.id], attachmentsGroupOff: true },
  },
  "Scheduling: End": { story: "Scheduling", then: { scheduling: false } },
} satisfies Record<string, { story: OutlookStoryName; then: OutlookStorySeed }>;

export type OutlookStoryFlowName = keyof typeof OUTLOOK_STORY_FLOWS;

/** The Storybook id of a story export: `ThreadIncluded` is `thread-included`. */
export const outlookStoryId = (name: string) =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** A story's state, or a flow's state after its steps. */
export const outlookStoryState = (
  seed: OutlookStorySeed,
  then: OutlookStorySeed = {},
): OutlookStoryState => ({ ...OUTLOOK_STORY_DEFAULTS, ...seed, ...then });
