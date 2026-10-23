import { plural, t } from "@lingui/core/macro";

import { threadMessageCountLabel } from "./buildThreadGroup";
import {
  quotedSelection,
  selectionExcerpt,
} from "../../core/selection/selectionExcerpt";

import type { OutlookSendPreview } from "./outlookActionFacet";
import type {
  OutlookAttachmentDisposition,
  OutlookFilePlan,
} from "./outlookSendFiles";
import type {
  ComposerContextState,
  ComposerContextTone,
} from "@erato/frontend/library";

export interface OutlookContextNote {
  tone: "info" | "warning" | "error";
  /** Leads the note, e.g. the failure the text explains. */
  title?: string;
  text: string;
}

export interface OutlookDetailField {
  label: string;
  value: string;
}

export interface OutlookSelectionChipModel {
  state: ComposerContextState;
  label: string;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  title: string;
  text: string;
  notes: OutlookContextNote[];
  lifetime: string;
}

export type OutlookDraftChipAction = "send-instead" | "end-scheduling";

export interface OutlookDraftChipModel {
  kind: "outlook.draft" | "outlook.appointment";
  state: ComposerContextState;
  label: string;
  spokenLabel: string;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  actions: OutlookDraftChipAction[];
  notes: OutlookContextNote[];
  fields: OutlookDetailField[];
  /** The draft text the send carries, for a message draft. */
  body?: string;
  /** The reply context is shown, never sent on its own. */
  replyNote?: string;
  lifetime: string;
}

export type OutlookThreadChipAction = "retry" | "sign-in";

export interface OutlookThreadChipModel {
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  /** What (+) does: include, load again first, or tick every message back. */
  restore: "include" | "include-and-retry" | "include-every";
  restoredAnnouncement?: string;
  actions: OutlookThreadChipAction[];
  signInLabel?: string;
  intro?: string;
  notes: OutlookContextNote[];
  /** The per-message checklist is drawn: the thread has loaded. */
  checklist: boolean;
  lifetime?: string;
  /** The checklist's group meta: "1.5 MB of 25 MB" or "Updating…". */
  checklistMeta: string;
  /** The checklist's group label, the same count the chip's meta gives. */
  checklistLabel: string;
}

export interface OutlookAttachmentRow {
  id: string;
  name: string;
  size: number;
  sizeLabel: string;
  type: string;
  ticked: boolean;
  cloud: boolean;
}

export interface OutlookAttachmentChipModel {
  id: string;
  kind: "outlook.draftAttachment" | "outlook.mailAttachment";
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  /** (+) on a follow-up also sends it with the next message. */
  restore: "restore" | "follow-up" | "restore-and-follow-up";
  fields: OutlookDetailField[];
  notes: OutlookContextNote[];
  lifetime: string;
}

export interface OutlookAttachmentsGroupModel {
  kind: "outlook.draftAttachments" | "outlook.mailAttachments";
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  spokenLabel: string;
  meta?: string;
  removeLabel: string;
  restoreLabel?: string;
  /** (+): the group back on; every tick back when none is left; follow-up ids. */
  restore: { tickAll: boolean; followUpIds: string[] };
  rows: OutlookAttachmentRow[];
  notes: OutlookContextNote[];
  lifetime: string;
}

export interface OutlookDropChipModel {
  key: string;
  state: ComposerContextState;
  tone?: ComposerContextTone;
  label: string;
  meta: string;
  removeLabel: string;
  notes: OutlookContextNote[];
}

export interface OutlookSchedulingModeModel {
  label: string;
  description: string;
  endLabel: string;
  endedAnnouncement: string;
}

export interface OutlookContextModels {
  selection: OutlookSelectionChipModel | null;
  draft: OutlookDraftChipModel | null;
  thread: OutlookThreadChipModel | null;
  attachments: OutlookAttachmentChipModel[];
  attachmentsGroup: OutlookAttachmentsGroupModel | null;
  drops: OutlookDropChipModel[];
  dropProgress: { label: string } | null;
  scheduling: OutlookSchedulingModeModel | null;
}

export interface OutlookContextDisplay {
  freshChat: boolean;
  itemKind: "message" | "appointment" | null;
  /** A selection the facet can carry; null without one. */
  selection: { text: string; dismissed: boolean } | null;
  /** Compose with a draft or appointment that can ride as context; null otherwise. */
  draft: {
    kind: "message" | "appointment";
    off: boolean;
    body: string;
    parent: { subject: string; sender: string } | null;
    /** Only when the review facet carries recipients, because only then are they sent. */
    recipients: { to: string[]; cc: string[] } | null;
    appointment: OutlookAppointmentDisplay | null;
  } | null;
  thread: {
    subject: string;
    /** The thread `.eml`'s own size, formatted; null before it is built. */
    sizeLabel: string | null;
    stale: boolean;
    signingIn: boolean;
    /** Ticked messages of the loaded thread, and all of them. */
    includedMessages: number;
    totalMessages: number;
  };
  maxSizeFormatted: string;
  attachments: {
    mode: "compose" | "read";
    rows: OutlookAttachmentRow[];
    /** The group chip's (x). */
    groupOff: boolean;
  };
  drops: {
    key: string;
    subject: string;
    senderAndDate: string;
    kept: number;
    total: number;
  }[];
  /** The drop pipeline's step while dropped emails are read. */
  dropProgress: string | null;
  /** When sticky scheduling ends, formatted; null when it is not on. */
  schedulingUntil: string | null;
  formatSize: (bytes: number) => string;
}

const REWRITE_FACETS = new Set([
  "outlook_rewrite_selection",
  "outlook_rewrite_appointment_selection",
]);

const lifetimeItem = () =>
  t({
    id: "officeAddin.outlook.context.detail.lifetimeItem",
    message: "Leaving it out lasts until you switch mail items.",
  });

// Each subject has its own ids, so a language can agree them in gender and number.
const threadFollowUpMeta = () =>
  t({
    id: "officeAddin.outlook.context.thread.meta.followUp",
    message: "Not included on follow-up messages",
  });

const attachmentFollowUpMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachment.meta.followUp",
    message: "Not included on follow-up messages",
  });

const attachmentsFollowUpMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachments.meta.followUp",
    message: "Not included on follow-up messages",
  });

const threadNothingChosenMeta = () =>
  t({
    id: "officeAddin.outlook.context.thread.meta.nothingChosen",
    message: "Nothing chosen",
  });

const attachmentsNothingChosenMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachments.meta.nothingChosen",
    message: "Nothing chosen",
  });

const trimFailedMeta = () =>
  t({
    id: "officeAddin.outlook.context.thread.meta.trimFailed",
    message: "Couldn't leave out unticked parts",
  });

const attachmentSentEarlierMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachment.meta.sentEarlier",
    message: "Sent earlier, not re-sent",
  });

const attachmentsSentEarlierMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachments.meta.sentEarlier",
    message: "Sent earlier, not re-sent",
  });

const attachmentNotWithDropsMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachment.meta.notWithDrops",
    message: "Not sent with dropped emails",
  });

const attachmentsNotWithDropsMeta = () =>
  t({
    id: "officeAddin.outlook.context.attachments.meta.notWithDrops",
    message: "Not sent with dropped emails",
  });

function selectionModel(
  preview: OutlookSendPreview,
  display: OutlookContextDisplay,
): OutlookSelectionChipModel | null {
  const selection = display.selection;
  if (!selection || selection.text.length === 0) return null;
  const appointment = display.itemKind === "appointment";
  const base = {
    label: quotedSelection(selectionExcerpt(selection.text)),
    removeLabel: t({
      id: "officeAddin.chatInput.dismissSelection",
      message: "Dismiss selection",
    }),
    title: t({
      id: "officeAddin.outlook.context.selection.title",
      message: "Selected text",
    }),
    text: selection.text,
    lifetime: t({
      id: "officeAddin.outlook.context.selection.detail.lifetime",
      message:
        "Leaving it out lasts until the selection changes or you switch mail items.",
    }),
  };
  if (selection.dismissed) {
    return {
      ...base,
      state: "suggested",
      restoreLabel: t({
        id: "officeAddin.outlook.context.selection.include",
        message: "Include selection",
      }),
      notes: [],
    };
  }
  // Only a rewrite facet carries the selection; a chip that says otherwise
  // would claim text the send leaves out.
  if (!preview.facetId || !REWRITE_FACETS.has(preview.facetId)) return null;
  if (preview.draft === "selection") {
    return {
      ...base,
      state: "included",
      meta: appointment
        ? t({
            id: "officeAddin.outlook.context.selection.meta.replacesAppointment",
            message: "Replaces appointment details",
          })
        : t({
            id: "officeAddin.outlook.context.selection.meta.replacesDraft",
            message: "Replaces draft",
          }),
      notes: [
        {
          tone: "info",
          text: appointment
            ? t({
                id: "officeAddin.outlook.context.selection.detail.insteadOfAppointment",
                message:
                  "Sent instead of your appointment details, so Erato rewrites only this text.",
              })
            : t({
                id: "officeAddin.outlook.context.selection.detail.insteadOfDraft",
                message:
                  "Sent instead of your draft, so Erato rewrites only this text.",
              }),
        },
      ],
    };
  }
  return { ...base, state: "included", meta: base.title, notes: [] };
}

export interface OutlookAppointmentDisplay {
  subject: string;
  /** Short, for the chip's meta. */
  when: string;
  /** With the year, for the detail. */
  whenLong: string;
  location: string;
  attendees: string[];
}

/** The appointment detail's fields, as the next send reads them. */
export function appointmentFields(
  appointment: OutlookAppointmentDisplay,
): OutlookDetailField[] {
  const { subject, whenLong, location, attendees } = appointment;
  return [
    {
      label: t({
        id: "officeAddin.outlook.context.detail.field.subject",
        message: "Subject",
      }),
      value: subject,
    },
    {
      label: t({
        id: "officeAddin.outlook.context.detail.field.when",
        message: "When",
      }),
      value: whenLong,
    },
    {
      label: t({
        id: "officeAddin.outlook.context.detail.field.where",
        message: "Where",
      }),
      value: location,
    },
    {
      label: t({
        id: "officeAddin.outlook.context.detail.field.attendees",
        message: "Attendees",
      }),
      value: attendees.join(", "),
    },
  ].filter((field) => field.value.length > 0);
}

function draftModel(
  preview: OutlookSendPreview,
  display: OutlookContextDisplay,
): OutlookDraftChipModel | null {
  const draft = display.draft;
  if (!draft) return null;
  const appointment = draft.kind === "appointment";
  const label = appointment
    ? t({
        id: "officeAddin.outlook.context.appointment.label",
        message: "Appointment details",
      })
    : t({
        id: "officeAddin.outlook.context.draft.label",
        message: "Your draft",
      });
  const fields: OutlookDetailField[] =
    appointment && draft.appointment
      ? appointmentFields(draft.appointment)
      : [];
  if (!appointment) {
    if (draft.recipients?.to.length) {
      fields.push({
        label: t({
          id: "officeAddin.outlook.context.detail.field.to",
          message: "To",
        }),
        value: draft.recipients.to.join(", "),
      });
    }
    if (draft.recipients?.cc.length) {
      fields.push({
        label: t({
          id: "officeAddin.outlook.context.detail.field.cc",
          message: "Cc",
        }),
        value: draft.recipients.cc.join(", "),
      });
    }
    if (draft.parent) {
      const subject =
        draft.parent.subject.trim() ||
        t({
          id: "officeAddin.chatInput.replyContext.untitled",
          message: "(no subject)",
        });
      const sender = draft.parent.sender;
      fields.push({
        label: t({
          id: "officeAddin.outlook.context.detail.field.replyTo",
          message: "Reply to",
        }),
        value: sender
          ? t({
              id: "officeAddin.outlook.context.draft.detail.replyToValue",
              message: `${subject} — ${sender}`,
            })
          : subject,
      });
    }
  }
  const base = {
    kind: appointment
      ? ("outlook.appointment" as const)
      : ("outlook.draft" as const),
    label,
    spokenLabel: appointment
      ? label
      : t({ id: "officeAddin.outlook.context.draft.spoken", message: "Draft" }),
    removeLabel: appointment
      ? t({
          id: "officeAddin.chatInput.dismissAppointmentContext",
          message: "Don't include appointment details",
        })
      : t({
          id: "officeAddin.chatInput.dismissDraftContext",
          message: "Don't include draft",
        }),
    fields,
    ...(!appointment && draft.body ? { body: draft.body } : {}),
    ...(!appointment && draft.parent
      ? {
          replyNote: t({
            id: "officeAddin.outlook.context.draft.detail.replyContext",
            message:
              "The reply context is shown here only. It reaches Erato through your draft and is never sent on its own.",
          }),
        }
      : {}),
    lifetime: lifetimeItem(),
  };
  if (draft.off) {
    return {
      ...base,
      state: "suggested",
      restoreLabel: appointment
        ? t({
            id: "officeAddin.outlook.context.appointment.include",
            message: "Include appointment details",
          })
        : t({
            id: "officeAddin.outlook.context.draft.include",
            message: "Include draft",
          }),
      actions: [],
      notes: [],
    };
  }
  switch (preview.draft) {
    case "selection":
      return {
        ...base,
        state: "superseded",
        meta: appointment
          ? t({
              id: "officeAddin.outlook.context.appointment.meta.replacedBySelection",
              message: "Replaced by selection",
            })
          : t({
              id: "officeAddin.outlook.context.draft.meta.replacedBySelection",
              message: "Replaced by selection",
            }),
        // Only where dismissing the selection gives the draft back; under
        // sticky scheduling it would stay out.
        actions:
          preview.draftWithoutSelection === "sent" ? ["send-instead"] : [],
        notes: [
          {
            tone: "info",
            text: appointment
              ? t({
                  id: "officeAddin.outlook.context.appointment.detail.replacedBySelection",
                  message:
                    "Your selection is sent instead of your appointment details.",
                })
              : t({
                  id: "officeAddin.outlook.context.draft.detail.replacedBySelection",
                  message: "Your selection is sent instead of your draft.",
                }),
          },
        ],
      };
    case "scheduling":
      return {
        ...base,
        state: "superseded",
        meta: t({
          id: "officeAddin.outlook.context.draft.meta.scheduling",
          message: "Not sent while scheduling",
        }),
        actions:
          preview.draftWithoutScheduling === "sent" ? ["end-scheduling"] : [],
        notes: [
          {
            tone: "info",
            text: t({
              id: "officeAddin.outlook.context.draft.detail.scheduling",
              message:
                "Scheduling takes priority, so this message does not carry your draft. End scheduling to send it again.",
            }),
          },
        ],
      };
    case "unchanged":
      return {
        ...base,
        state: "superseded",
        meta: appointment
          ? t({
              id: "officeAddin.outlook.context.appointment.meta.unchanged",
              message: "Unchanged, not re-sent",
            })
          : t({
              id: "officeAddin.outlook.context.draft.meta.unchanged",
              message: "Unchanged, not re-sent",
            }),
        actions: [],
        notes: [
          {
            tone: "info",
            text: t({
              id: "officeAddin.outlook.context.draft.detail.unchanged",
              message:
                "Erato already has this version from an earlier message, so it is not sent again. It is sent again when you change it.",
            }),
          },
        ],
      };
    case "sent": {
      const sender = draft.parent?.sender;
      const meta = appointment
        ? draft.appointment?.when || undefined
        : sender
          ? t({
              id: "officeAddin.outlook.context.draft.meta.replyTo",
              message: `Reply to ${sender}`,
            })
          : undefined;
      return {
        ...base,
        state: "included",
        ...(meta ? { meta } : {}),
        actions: [],
        notes: [],
      };
    }
    default:
      // The send carries nothing of it, so no chip claims it does.
      return null;
  }
}

function someMessagesLabel(included: number, total: number): string {
  return t({
    id: "officeAddin.outlook.context.thread.meta.someMessages",
    message: plural(total, {
      one: `${included} of # message`,
      other: `${included} of # messages`,
    }),
  });
}

function threadModel(
  plan: OutlookFilePlan,
  display: OutlookContextDisplay,
): OutlookThreadChipModel | null {
  const disposition = plan.thread;
  if (disposition.kind === "none" || disposition.kind === "hidden") {
    return null;
  }
  const { thread } = display;
  const limit = display.maxSizeFormatted;
  const label =
    thread.subject ||
    t({ id: "officeAddin.chatInput.emailFallback", message: "Email" });
  const leaveOut = t({
    id: "officeAddin.outlook.context.thread.remove",
    message: "Leave out the email",
  });
  const dismiss = t({
    id: "officeAddin.outlook.context.thread.dismiss",
    message: "Dismiss email thread",
  });
  const include = t({
    id: "officeAddin.outlook.context.thread.include",
    message: "Include the email",
  });
  const updating = t({
    id: "officeAddin.fileSource.updatingThread",
    message: "Updating…",
  });
  const used = thread.sizeLabel;
  const sizeLabel =
    thread.stale || used === null
      ? updating
      : t({
          id: "officeAddin.chatInput.stagedSize",
          message: `${used} of ${limit}`,
        });
  const notIncluded: OutlookContextNote = {
    tone: "info",
    text: t({
      id: "officeAddin.outlook.context.thread.detail.notIncluded",
      message:
        "The email is not included right now. Your choices below are kept and come back when you include it.",
    }),
  };
  const intro = t({
    id: "officeAddin.outlook.context.thread.detail.intro",
    message: `Untick what Erato should not read. Attachments count toward the ${limit} limit.`,
  });
  const lifetime = t({
    id: "officeAddin.outlook.context.thread.detail.lifetime",
    message:
      "Leaving the email out lasts until you switch mail items. Including it again restores these ticks.",
  });
  const { includedMessages, totalMessages } = thread;
  const base = {
    label,
    removeLabel: leaveOut,
    restore: "include" as const,
    actions: [] as OutlookThreadChipAction[],
    notes: [] as OutlookContextNote[],
    checklist: false,
    checklistMeta: sizeLabel,
    checklistLabel:
      includedMessages < totalMessages
        ? someMessagesLabel(includedMessages, totalMessages)
        : threadMessageCountLabel(totalMessages),
  };
  // Nothing ticked, or a trim the bytes refuse: no file is coming, so the
  // checklist states no size rather than "Updating…".
  const noFileMeta = thread.stale ? updating : "";
  switch (disposition.kind) {
    case "loading": {
      const meta = thread.signingIn
        ? t({
            id: "officeAddin.outlook.context.thread.meta.signingIn",
            message: "Signing in…",
          })
        : t({
            id: "officeAddin.outlook.context.thread.meta.loading",
            message: "Loading email thread…",
          });
      return {
        ...base,
        state: "loading",
        meta,
        notes: [
          {
            tone: "info",
            title: meta,
            text: t({
              id: "officeAddin.chatInput.loadingEmailThreadDescription",
              message: "Preparing the email context",
            }),
          },
        ],
      };
    }
    case "error":
      if (disposition.why === "load") {
        return {
          ...base,
          state: "error",
          tone: "error",
          meta: t({
            id: "officeAddin.chatInput.emailThreadLoadError",
            message: "Couldn't load the email thread",
          }),
          removeLabel: dismiss,
          actions: ["retry"],
          notes: [
            {
              tone: "error",
              title: t({
                id: "officeAddin.chatInput.emailThreadLoadError",
                message: "Couldn't load the email thread",
              }),
              text: t({
                id: "officeAddin.chatInput.emailThreadLoadErrorDescription",
                message: "You can still send without this email context.",
              }),
            },
          ],
        };
      }
      return {
        ...base,
        state: "error",
        tone: "error",
        meta: trimFailedMeta(),
        removeLabel: dismiss,
        checklistMeta: noFileMeta,
        notes: [
          {
            tone: "error",
            text: t({
              id: "officeAddin.outlook.context.thread.detail.trimFailedNote",
              message:
                "Some unticked attachments sit inside a forwarded email and can't be cut out, so a message with this email is not sent. Tick them again, or leave the email out.",
            }),
          },
        ],
        checklist: true,
        lifetime,
      };
    case "sign-in": {
      const consent = disposition.consent;
      return {
        ...base,
        state: "attention",
        tone: "warning",
        meta: consent
          ? t({
              id: "officeAddin.email.allowAccessToLoad.title",
              message: "Allow access to load email",
            })
          : t({
              id: "officeAddin.email.signInToLoad.title",
              message: "Sign in to load email",
            }),
        actions: ["sign-in"],
        signInLabel: consent
          ? t({
              id: "officeAddin.email.allowAccessToLoad.action",
              message: "Allow access",
            })
          : t({
              id: "officeAddin.email.signInToLoad.action",
              message: "Sign in",
            }),
        notes: [
          {
            tone: "warning",
            text: consent
              ? t({
                  id: "officeAddin.email.allowAccessToLoad.description",
                  message:
                    "This email wasn't attached because reading its mailbox needs a permission you haven't granted yet.",
                })
              : t({
                  id: "officeAddin.email.signInToLoad.description",
                  message:
                    "This email wasn't attached because reading it needs a quick sign-in.",
                }),
          },
        ],
      };
    }
    case "off":
      return {
        ...base,
        state: "suggested",
        restoreLabel: disposition.retry
          ? t({
              id: "officeAddin.outlook.context.thread.retryInclude",
              message: "Try loading the email again",
            })
          : include,
        restore: disposition.retry ? "include-and-retry" : "include",
        ...(disposition.retry ? {} : { intro }),
        notes: [notIncluded],
        checklist: !disposition.retry,
        lifetime,
      };
    case "follow-up":
      // A failure on a follow-up is loaded again when the user includes it.
      return {
        ...base,
        state: "suggested",
        meta: threadFollowUpMeta(),
        restoreLabel: include,
        restore: disposition.retry ? "include-and-retry" : "include",
        ...(disposition.retry ? {} : { intro }),
        notes: [notIncluded],
        checklist: !disposition.retry,
        lifetime,
      };
    case "nothing":
      return {
        ...base,
        state: "suggested",
        meta: threadNothingChosenMeta(),
        checklistMeta: noFileMeta,
        restoreLabel: t({
          id: "officeAddin.outlook.context.thread.includeEvery",
          message: "Include every message",
        }),
        restore: "include-every",
        restoredAnnouncement: t({
          id: "officeAddin.outlook.context.thread.announce.included",
          message: "Email thread included.",
        }),
        intro,
        checklist: true,
        lifetime,
      };
    case "sent": {
      const { included, total } = disposition;
      const partial = included < total;
      const count = partial
        ? someMessagesLabel(included, total)
        : threadMessageCountLabel(total);
      return {
        ...base,
        state: "included",
        meta: `${count} · ${sizeLabel}`,
        ...(partial
          ? {
              restoredAnnouncement: t({
                id: "officeAddin.outlook.context.thread.announce.restoredPartial",
                message: "Email thread included. Your earlier choice is back.",
              }),
            }
          : {}),
        intro,
        checklist: true,
        lifetime,
      };
    }
  }
}

function attachmentNote(
  disposition: OutlookAttachmentDisposition,
  mode: "compose" | "read",
): OutlookContextNote | null {
  switch (disposition) {
    case "cloud":
      return {
        tone: "error",
        text: t({
          id: "officeAddin.outlook.context.attachment.detail.cloud",
          message:
            "This is a link to a cloud file, which Outlook can't hand over, so it is not sent.",
        }),
      };
    case "sent-earlier":
      return {
        tone: "info",
        text: t({
          id: "officeAddin.outlook.context.attachment.detail.sentEarlier",
          message:
            "Erato already has this file from an earlier message, so it is not sent again.",
        }),
      };
    case "not-with-drops":
      return {
        tone: "info",
        text:
          mode === "compose"
            ? t({
                id: "officeAddin.outlook.context.attachment.detail.notWithDrops",
                message:
                  "Your draft's attachments are not sent while dropped emails are attached.",
              })
            : t({
                id: "officeAddin.outlook.context.attachment.detail.notWithDropsEmail",
                message:
                  "This email's attachments are not sent while dropped emails are attached.",
              }),
      };
    case "follow-up":
      return {
        tone: "info",
        text: t({
          id: "officeAddin.outlook.context.attachment.detail.followUp",
          message:
            "Attachments go with the first message only. Include it to send it with this one.",
        }),
      };
    default:
      return null;
  }
}

function attachmentsNote(
  disposition: "cloud" | "sent-earlier" | "not-with-drops" | "follow-up",
  mode: "compose" | "read",
): OutlookContextNote {
  switch (disposition) {
    case "cloud":
      return {
        tone: "error",
        text: t({
          id: "officeAddin.outlook.context.attachments.detail.cloud",
          message:
            "These are links to cloud files, which Outlook can't hand over, so they are not sent.",
        }),
      };
    case "sent-earlier":
      return {
        tone: "info",
        text: t({
          id: "officeAddin.outlook.context.attachments.detail.sentEarlier",
          message:
            "Erato already has these files from an earlier message, so they are not sent again.",
        }),
      };
    case "not-with-drops":
      return attachmentNote("not-with-drops", mode) as OutlookContextNote;
    case "follow-up":
      return {
        tone: "info",
        text: t({
          id: "officeAddin.outlook.context.attachments.detail.followUp",
          message:
            "Attachments go with the first message only. Include them to send them with this one.",
        }),
      };
  }
}

function attachmentModels(
  plan: OutlookFilePlan,
  display: OutlookContextDisplay,
): Pick<OutlookContextModels, "attachments" | "attachmentsGroup"> {
  const { mode, rows } = display.attachments;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const shown = plan.attachments.flatMap((entry) => {
    const row = byId.get(entry.id);
    return row ? [{ row, disposition: entry.disposition }] : [];
  });
  if (shown.length === 0) return { attachments: [], attachmentsGroup: null };
  const compose = mode === "compose";

  if (shown.length <= 2) {
    return {
      attachmentsGroup: null,
      attachments: shown.map(({ row, disposition }) => {
        const name = row.name;
        const note = attachmentNote(disposition, mode);
        const fields: OutlookDetailField[] = [];
        if (row.type) {
          fields.push({
            label: t({
              id: "officeAddin.outlook.context.detail.field.type",
              message: "Type",
            }),
            value: row.type,
          });
        }
        // Office.js reports no size for a link to a cloud file.
        if (!row.cloud && row.size > 0) {
          fields.push({
            label: t({
              id: "officeAddin.outlook.context.detail.field.size",
              message: "Size",
            }),
            value: row.sizeLabel,
          });
        }
        const base = {
          id: row.id,
          kind: compose
            ? ("outlook.draftAttachment" as const)
            : ("outlook.mailAttachment" as const),
          label: name,
          removeLabel: t({
            id: "officeAddin.outlook.context.attachment.remove",
            message: `Don't include ${name}`,
          }),
          restore: "restore" as const,
          fields,
          notes: note ? [note] : [],
          lifetime: lifetimeItem(),
        };
        const includeLabel = t({
          id: "officeAddin.outlook.context.attachment.include",
          message: `Include ${name}`,
        });
        switch (disposition) {
          case "cloud":
            return {
              ...base,
              state: "error" as const,
              tone: "error" as const,
              meta: t({
                id: "officeAddin.outlook.context.attachment.meta.cloud",
                message: "Cloud file · can't be sent",
              }),
              removeLabel: t({
                id: "officeAddin.outlook.context.attachment.dismiss",
                message: `Dismiss ${name}`,
              }),
            };
          case "off":
            return {
              ...base,
              state: "suggested" as const,
              restoreLabel: includeLabel,
              restore: display.freshChat
                ? ("restore" as const)
                : ("restore-and-follow-up" as const),
            };
          case "sent-earlier":
            return {
              ...base,
              state: "superseded" as const,
              meta: attachmentSentEarlierMeta(),
            };
          case "not-with-drops":
            return {
              ...base,
              state: "superseded" as const,
              meta: attachmentNotWithDropsMeta(),
            };
          case "follow-up":
            return {
              ...base,
              state: "suggested" as const,
              meta: attachmentFollowUpMeta(),
              restoreLabel: includeLabel,
              restore: "follow-up" as const,
            };
          case "sent": {
            const size = row.sizeLabel;
            return {
              ...base,
              state: "included" as const,
              meta: compose
                ? t({
                    id: "officeAddin.outlook.context.attachment.meta.draft",
                    message: `Draft attachment · ${size}`,
                  })
                : t({
                    id: "officeAddin.outlook.context.attachment.meta.email",
                    message: `Email attachment · ${size}`,
                  }),
            };
          }
        }
      }),
    };
  }

  const count = shown.length;
  const going = shown.filter(({ disposition }) => disposition === "sent");
  const tickedSendable = shown.filter(({ row }) => row.ticked && !row.cloud);
  const unsentTicked = tickedSendable.filter(
    ({ disposition }) => disposition !== "sent-earlier",
  );
  const { groupOff } = display.attachments;
  const base = {
    kind: compose
      ? ("outlook.draftAttachments" as const)
      : ("outlook.mailAttachments" as const),
    label: compose
      ? t({
          id: "officeAddin.outlook.context.attachments.label.draft",
          message: `Draft attachments (${count})`,
        })
      : t({
          id: "officeAddin.outlook.context.attachments.label.email",
          message: `Email attachments (${count})`,
        }),
    spokenLabel: compose
      ? t({
          id: "officeAddin.outlook.context.attachments.spoken.draft",
          message: "Draft attachments",
        })
      : t({
          id: "officeAddin.outlook.context.attachments.spoken.email",
          message: "Email attachments",
        }),
    removeLabel: compose
      ? t({
          id: "officeAddin.outlook.context.attachments.remove.draft",
          message: "Don't include draft attachments",
        })
      : t({
          id: "officeAddin.outlook.context.attachments.remove.email",
          message: "Don't include email attachments",
        }),
    rows: shown.map(({ row }) => row),
    lifetime: lifetimeItem(),
  };
  const restoreLabel = compose
    ? t({
        id: "officeAddin.outlook.context.attachments.include.draft",
        message: "Include draft attachments",
      })
    : t({
        id: "officeAddin.outlook.context.attachments.include.email",
        message: "Include email attachments",
      });
  const restore = {
    tickAll: tickedSendable.length === 0,
    followUpIds: display.freshChat
      ? []
      : (tickedSendable.length === 0
          ? shown.filter(({ row }) => !row.cloud)
          : unsentTicked
        ).map(({ row }) => row.id),
  };
  const group = (
    model: Pick<
      OutlookAttachmentsGroupModel,
      "state" | "tone" | "meta" | "restoreLabel" | "notes"
    > & { removeLabel?: string },
  ): Pick<OutlookContextModels, "attachments" | "attachmentsGroup"> => ({
    attachments: [],
    attachmentsGroup: { ...base, restore, ...model },
  });
  if (groupOff) {
    return group({
      state: "suggested",
      restoreLabel,
      notes: [
        {
          tone: "info",
          text: t({
            id: "officeAddin.outlook.context.attachments.detail.notIncluded",
            message:
              "The attachments are not included right now. Your ticks below are kept and come back when you include them.",
          }),
        },
      ],
    });
  }
  // Nothing here can go, whatever is ticked, so (+) would change nothing.
  if (shown.every(({ row }) => row.cloud)) {
    return group({
      state: "error",
      tone: "error",
      meta: t({
        id: "officeAddin.outlook.context.attachments.meta.cloud",
        message: "Cloud files · can't be sent",
      }),
      removeLabel: compose
        ? t({
            id: "officeAddin.outlook.context.attachments.dismiss.draft",
            message: "Dismiss draft attachments",
          })
        : t({
            id: "officeAddin.outlook.context.attachments.dismiss.email",
            message: "Dismiss email attachments",
          }),
      notes: [attachmentsNote("cloud", mode)],
    });
  }
  if (going.length === 0) {
    if (tickedSendable.length > 0 && unsentTicked.length === 0) {
      return group({
        state: "superseded",
        meta: attachmentsSentEarlierMeta(),
        notes: [attachmentsNote("sent-earlier", mode)],
      });
    }
    if (
      tickedSendable.some(({ disposition }) => disposition === "not-with-drops")
    ) {
      return group({
        state: "superseded",
        meta: attachmentsNotWithDropsMeta(),
        notes: [attachmentsNote("not-with-drops", mode)],
      });
    }
    if (unsentTicked.length > 0) {
      return group({
        state: "suggested",
        meta: attachmentsFollowUpMeta(),
        restoreLabel,
        notes: [attachmentsNote("follow-up", mode)],
      });
    }
    return group({
      state: "suggested",
      meta: attachmentsNothingChosenMeta(),
      restoreLabel,
      notes: [],
    });
  }
  const sent = going.length;
  const total = count;
  const size = display.formatSize(
    going.reduce((total, { row }) => total + row.size, 0),
  );
  return group({
    state: "included",
    meta: t({
      id: "officeAddin.outlook.context.attachments.meta.some",
      message: `${sent} of ${total} · ${size}`,
    }),
    notes: [],
  });
}

function dropModels(
  plan: OutlookFilePlan,
  display: OutlookContextDisplay,
): OutlookDropChipModel[] {
  const states = new Map(plan.drops.map((drop) => [drop.key, drop.state]));
  return display.drops.map((drop) => {
    const subject =
      drop.subject ||
      t({ id: "officeAddin.chatInput.emailFallback", message: "Email" });
    const label = subject;
    const removeLabel = t({
      id: "officeAddin.chatInput.removeDroppedEmailNamed",
      message: `Remove ${subject}`,
    });
    if (states.get(drop.key) === "error") {
      return {
        key: drop.key,
        state: "error",
        tone: "error",
        label,
        meta: trimFailedMeta(),
        removeLabel,
        notes: [
          {
            tone: "error",
            text: t({
              id: "officeAddin.outlook.context.thread.detail.trimFailedNote",
              message:
                "Some unticked attachments sit inside a forwarded email and can't be cut out, so a message with this email is not sent. Tick them again, or leave the email out.",
            }),
          },
        ],
      };
    }
    const { kept, total } = drop;
    const attachments =
      total > 0
        ? t({
            id: "officeAddin.outlook.context.drop.meta.attachments",
            message: plural(total, {
              one: `${kept}/# attachment`,
              other: `${kept}/# attachments`,
            }),
          })
        : "";
    return {
      key: drop.key,
      state: "included",
      label,
      meta: [drop.senderAndDate, attachments]
        .filter((part) => part.length > 0)
        .join(" · "),
      removeLabel,
      notes: [],
    };
  });
}

function schedulingModel(
  preview: OutlookSendPreview,
  display: OutlookContextDisplay,
): OutlookSchedulingModeModel | null {
  if (preview.mode !== "scheduling") return null;
  const time = display.schedulingUntil ?? "";
  return {
    label: t({
      id: "officeAddin.outlook.context.scheduling.label",
      message: "Scheduling",
    }),
    description: t({
      id: "officeAddin.outlook.context.scheduling.description",
      message: `Scheduling stays on for an hour after Erato last read your calendar (until ${time}).`,
    }),
    endLabel: t({
      id: "officeAddin.outlook.context.scheduling.end",
      message: "End scheduling",
    }),
    endedAnnouncement:
      preview.draftWithoutScheduling === "sent"
        ? t({
            id: "officeAddin.outlook.context.scheduling.announce.endedDraft",
            message: "Scheduling ended. Your draft is sent again.",
          })
        : t({
            id: "officeAddin.outlook.context.scheduling.announce.ended",
            message: "Scheduling ended.",
          }),
  };
}

/**
 * The Outlook chips as plain data, from the send preview (what facet the
 * send attaches) and the file plan (which files it uploads), so every state a
 * chip claims is what the send does.
 */
export function outlookContextChips(
  preview: OutlookSendPreview,
  plan: OutlookFilePlan,
  display: OutlookContextDisplay,
): OutlookContextModels {
  return {
    selection: selectionModel(preview, display),
    draft: draftModel(preview, display),
    thread: threadModel(plan, display),
    ...attachmentModels(plan, display),
    drops: dropModels(plan, display),
    dropProgress:
      display.dropProgress !== null ? { label: display.dropProgress } : null,
    scheduling: schedulingModel(preview, display),
  };
}
