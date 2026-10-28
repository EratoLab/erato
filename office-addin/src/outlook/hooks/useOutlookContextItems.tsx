import { t } from "@lingui/core/macro";
import { useMemo } from "react";

import {
  OutlookAttachmentDetail,
  OutlookAttachmentsDetail,
  OutlookDraftDetail,
  OutlookDropDetail,
  OutlookSelectionDetail,
  OutlookThreadDetail,
} from "../components/OutlookContextDetails";
import { buildDropEmailGroup } from "../utils/buildDropEmailGroup";
import { buildThreadGroup } from "../utils/buildThreadGroup";

import type { StagedDropEmail } from "../utils/buildDropEmailGroup";
import type {
  StagedThread,
  ThreadGroupHandlers,
  ThreadPartVerdicts,
} from "../utils/buildThreadGroup";
import type { OutlookContextModels } from "../utils/outlookContextChips";
import type { StagedPartValidation } from "../utils/validateStagedPart";
import type {
  ComposerContextDetailAction,
  ComposerContextItem,
  ComposerMode,
  FileAttachmentGroup,
} from "@erato/frontend/library";

export const OUTLOOK_SELECTION_CHIP_ID = "outlook-selection";
export const OUTLOOK_DRAFT_CHIP_ID = "outlook-draft";
export const OUTLOOK_THREAD_CHIP_ID = "outlook-thread";
export const OUTLOOK_ATTACHMENTS_CHIP_ID = "outlook-attachments";
export const OUTLOOK_DROP_PROGRESS_CHIP_ID = "outlook-drop-progress";
export const outlookAttachmentChipId = (id: string) =>
  `outlook-attachment:${id}`;
export const outlookDropChipId = (key: string) => `outlook-drop:${key}`;

/** Store and provider writes only: the chips change when the resolvers hand back new state. */
export interface OutlookContextHandlers {
  dismissSelection: () => void;
  rearmSelection: () => void;
  /** "Send this instead": the selection off until it changes. */
  sendDraftInstead: () => void;
  setDraftOff: (off: boolean) => void;
  excludeThread: () => void;
  includeThread: () => void;
  retryThread: () => void;
  signInForEmail: () => void;
  restoreEveryMessage: () => void;
  /** A single attachment chip's (x) and (+): off for this conversation and item. */
  dismissAttachment: (id: string) => void;
  restoreAttachment: (id: string) => void;
  /** A tick in the attachments group's checklist. */
  untickAttachment: (id: string) => void;
  tickAttachment: (id: string) => void;
  includeAttachmentsOnFollowUp: (ids: string[]) => void;
  setAttachmentsGroupOff: (off: boolean) => void;
  removeDrop: (key: string) => void;
  endScheduling: () => void;
  thread: ThreadGroupHandlers;
  dismissDropAttachment: (key: string, attachmentId: string) => void;
  restoreDropAttachment: (key: string, attachmentId: string) => void;
}

/** What the details draw beyond the models: the staged emails behind the checklists. */
export interface OutlookContextDetailData {
  threadStaged: StagedThread | null;
  threadVerdicts: ThreadPartVerdicts;
  /** The thread is left out: ticking in its checklist brings it back. */
  threadExcluded: boolean;
  threadFile: File | null;
  drops: readonly StagedDropEmail[];
  dropVerdicts: ReadonlyMap<string, ReadonlyMap<string, StagedPartValidation>>;
  dropFiles: ReadonlyMap<string, File | null>;
  /** Per drop, the size the send uploads, formatted, or "Updating…". */
  dropSizeLabels: ReadonlyMap<string, string>;
  fallbackSubject: string;
  /** Re-reads the live draft or appointment, as the send does, while its detail is open. */
  refreshDraft?: () => unknown;
}

export interface OutlookContextItemsInput {
  models: OutlookContextModels;
  handlers: OutlookContextHandlers;
  detail: OutlookContextDetailData;
  /** A send is uploading: every chip and the mode keep still. */
  sending: boolean;
  /**
   * What the send's facet adds to the token estimate, carried by the
   * included chip it comes from: the draft, the appointment or the selection.
   */
  facetEstimate?: File;
}

/**
 * The Outlook chips for the composer's lane, ambient first in a fixed order
 * (selection, draft or appointment, thread, attachments), then the dropped
 * emails in drop order, and the scheduling mode for the controls row.
 */
export function useOutlookContextItems({
  models,
  handlers,
  detail,
  sending,
  facetEstimate,
}: OutlookContextItemsInput): {
  items: ComposerContextItem[];
  modes: ComposerMode[];
} {
  // The models are plain data and hold every string and state a chip draws;
  // the details read the staged emails, which change identity on every tick.
  const modelKey = JSON.stringify([models, sending]);
  return useMemo(() => {
    const lock = sending
      ? {
          locked: true,
          lockReason: t({
            id: "officeAddin.outlook.context.lock.sending",
            message: "Can't change this while the message is being sent",
          }),
        }
      : {};
    const items: ComposerContextItem[] = [];
    const {
      selection,
      draft,
      thread,
      attachments,
      attachmentsGroup,
      drops,
      dropProgress,
      scheduling,
    } = models;

    if (selection) {
      items.push({
        id: OUTLOOK_SELECTION_CHIP_ID,
        kind: "outlook.selection",
        origin: "ambient",
        dismissScope: "selection",
        icon: "selection",
        state: selection.state,
        ...(selection.state === "included" && facetEstimate
          ? { estimate: facetEstimate }
          : {}),
        ...(selection.meta ? { meta: selection.meta } : {}),
        label: selection.label,
        spokenLabel: t({
          id: "officeAddin.outlook.context.selection.spoken",
          message: "Selection",
        }),
        ...lock,
        ...(selection.state === "suggested"
          ? {
              onRestore: handlers.rearmSelection,
              restoreLabel: selection.restoreLabel,
            }
          : {
              onRemove: handlers.dismissSelection,
              removeLabel: selection.removeLabel,
            }),
        detail: {
          title: selection.title,
          render: () => <OutlookSelectionDetail model={selection} />,
        },
      });
    }

    if (draft) {
      const appointment = draft.kind === "outlook.appointment";
      const actions: ComposerContextDetailAction[] = draft.actions.map(
        (action) =>
          action === "send-instead"
            ? {
                id: "send-instead",
                label: t({
                  id: "officeAddin.outlook.context.sendInstead",
                  message: "Send this instead",
                }),
                variant: "primary",
                announcement: appointment
                  ? t({
                      id: "officeAddin.outlook.context.appointment.announce.sentInstead",
                      message:
                        "Appointment details included. Your selection is off until it changes.",
                    })
                  : t({
                      id: "officeAddin.outlook.context.draft.announce.sentInstead",
                      message:
                        "Draft included. Your selection is off until it changes.",
                    }),
                onSelect: handlers.sendDraftInstead,
              }
            : {
                id: "end-scheduling",
                label: t({
                  id: "officeAddin.outlook.context.scheduling.end",
                  message: "End scheduling",
                }),
                variant: "primary",
                announcement: t({
                  id: "officeAddin.outlook.context.scheduling.announce.endedDraft",
                  message: "Scheduling ended. Your draft is sent again.",
                }),
                onSelect: handlers.endScheduling,
              },
      );
      items.push({
        id: OUTLOOK_DRAFT_CHIP_ID,
        kind: draft.kind,
        origin: "ambient",
        dismissScope: "item",
        icon: appointment ? "calendar" : "draft",
        state: draft.state,
        ...(draft.state === "included" && facetEstimate
          ? { estimate: facetEstimate }
          : {}),
        ...(draft.meta ? { meta: draft.meta } : {}),
        label: draft.label,
        spokenLabel: draft.spokenLabel,
        ...lock,
        ...(draft.state === "suggested"
          ? {
              onRestore: () => handlers.setDraftOff(false),
              restoreLabel: draft.restoreLabel,
            }
          : {
              onRemove: () => handlers.setDraftOff(true),
              removeLabel: draft.removeLabel,
            }),
        detail: {
          title: draft.label,
          render: () => (
            <OutlookDraftDetail model={draft} refresh={detail.refreshDraft} />
          ),
          ...(actions.length > 0 && !sending ? { actions } : {}),
        },
      });
    }

    if (thread) {
      const { threadStaged } = detail;
      // Ticking while the email is left out brings it back, as (+) would.
      const tick = <A extends unknown[]>(write: (...args: A) => void) =>
        detail.threadExcluded
          ? (...args: A) => {
              write(...args);
              handlers.includeThread();
            }
          : write;
      const group: FileAttachmentGroup | null = threadStaged
        ? buildThreadGroup({
            staged: threadStaged,
            verdicts: detail.threadVerdicts,
            label: thread.checklistLabel,
            metaLabel: thread.checklistMeta,
            handlers: {
              dismissMessage: tick(handlers.thread.dismissMessage),
              restoreMessage: tick(handlers.thread.restoreMessage),
              dismissAttachment: tick(handlers.thread.dismissAttachment),
              restoreAttachment: tick(handlers.thread.restoreAttachment),
            },
          })
        : null;
      const actions: ComposerContextDetailAction[] = thread.actions.map(
        (action) =>
          action === "retry"
            ? {
                id: "retry",
                label: t({
                  id: "officeAddin.outlook.context.retry",
                  message: "Try again",
                }),
                variant: "primary",
                announcement: t({
                  id: "officeAddin.outlook.context.thread.announce.loaded",
                  message: "Email thread loaded.",
                }),
                // Asking for the email again means it goes once it loads.
                onSelect: () => {
                  handlers.retryThread();
                  handlers.includeThread();
                },
              }
            : {
                id: "sign-in",
                label: thread.signInLabel ?? "",
                variant: "primary",
                announcement: t({
                  id: "officeAddin.outlook.context.thread.announce.loaded",
                  message: "Email thread loaded.",
                }),
                onSelect: () => {
                  handlers.signInForEmail();
                  handlers.includeThread();
                },
              },
      );
      const restore =
        thread.restore === "include-and-retry"
          ? () => {
              // Loading first, so the chip goes to loading, never to its old error.
              handlers.retryThread();
              handlers.includeThread();
            }
          : thread.restore === "include-every"
            ? () => {
                handlers.restoreEveryMessage();
                handlers.includeThread();
              }
            : handlers.includeThread;
      items.push({
        id: OUTLOOK_THREAD_CHIP_ID,
        kind: "outlook.thread",
        origin: "ambient",
        dismissScope: "item",
        icon: "mail",
        state: thread.state,
        ...(thread.tone ? { tone: thread.tone } : {}),
        ...(thread.meta ? { meta: thread.meta } : {}),
        label: thread.label,
        spokenLabel: t({
          id: "officeAddin.outlook.context.thread.spoken",
          message: "Email thread",
        }),
        ...(thread.state === "included" && detail.threadFile
          ? { estimate: detail.threadFile, estimateUpload: true }
          : {}),
        ...lock,
        ...(thread.state === "suggested"
          ? { onRestore: restore, restoreLabel: thread.restoreLabel }
          : {
              onRemove: handlers.excludeThread,
              removeLabel: thread.removeLabel,
            }),
        ...(thread.restoredAnnouncement
          ? { announcements: { restored: thread.restoredAnnouncement } }
          : {}),
        detail: {
          title: thread.label,
          render: () => (
            <OutlookThreadDetail
              model={thread}
              group={group}
              disabled={sending}
            />
          ),
          ...(actions.length > 0 && !sending ? { actions } : {}),
        },
      });
    }

    for (const attachment of attachments) {
      const restore =
        attachment.restore === "follow-up"
          ? () => handlers.includeAttachmentsOnFollowUp([attachment.id])
          : attachment.restore === "restore-and-follow-up"
            ? () => {
                handlers.restoreAttachment(attachment.id);
                handlers.includeAttachmentsOnFollowUp([attachment.id]);
              }
            : () => handlers.restoreAttachment(attachment.id);
      items.push({
        id: outlookAttachmentChipId(attachment.id),
        kind: attachment.kind,
        origin: "ambient",
        dismissScope: "item",
        icon: "attachment",
        state: attachment.state,
        ...(attachment.tone ? { tone: attachment.tone } : {}),
        ...(attachment.meta ? { meta: attachment.meta } : {}),
        label: attachment.label,
        ...lock,
        ...(attachment.state === "suggested"
          ? { onRestore: restore, restoreLabel: attachment.restoreLabel }
          : {
              onRemove: () => handlers.dismissAttachment(attachment.id),
              removeLabel: attachment.removeLabel,
            }),
        detail: {
          title: attachment.label,
          render: () => <OutlookAttachmentDetail model={attachment} />,
        },
      });
    }

    if (attachmentsGroup) {
      const group: FileAttachmentGroup = {
        id: OUTLOOK_ATTACHMENTS_CHIP_ID,
        label: attachmentsGroup.spokenLabel,
        metaLabel: "",
        items: attachmentsGroup.rows.map((row) => ({
          kind: "selectableAttachment" as const,
          id: row.id,
          file: { id: row.id, filename: row.name, size: row.size },
          selected: row.ticked && !row.cloud,
          ...(row.cloud
            ? {
                metaLabel: t({
                  id: "officeAddin.outlook.context.attachment.meta.cloud",
                  message: "Cloud file · can't be sent",
                }),
              }
            : {
                onToggle: () =>
                  row.ticked
                    ? handlers.untickAttachment(row.id)
                    : handlers.tickAttachment(row.id),
              }),
        })),
      };
      const { tickAll, followUpIds } = attachmentsGroup.restore;
      items.push({
        id: OUTLOOK_ATTACHMENTS_CHIP_ID,
        kind: attachmentsGroup.kind,
        origin: "ambient",
        dismissScope: "item",
        icon: "attachment",
        state: attachmentsGroup.state,
        ...(attachmentsGroup.tone ? { tone: attachmentsGroup.tone } : {}),
        ...(attachmentsGroup.meta ? { meta: attachmentsGroup.meta } : {}),
        label: attachmentsGroup.label,
        spokenLabel: attachmentsGroup.spokenLabel,
        ...lock,
        ...(attachmentsGroup.state === "suggested"
          ? {
              onRestore: () => {
                handlers.setAttachmentsGroupOff(false);
                if (tickAll) {
                  for (const row of attachmentsGroup.rows) {
                    if (!row.ticked && !row.cloud) {
                      handlers.tickAttachment(row.id);
                    }
                  }
                }
                if (followUpIds.length > 0) {
                  handlers.includeAttachmentsOnFollowUp(followUpIds);
                }
              },
              restoreLabel: attachmentsGroup.restoreLabel,
            }
          : {
              onRemove: () => handlers.setAttachmentsGroupOff(true),
              removeLabel: attachmentsGroup.removeLabel,
            }),
        detail: {
          title: attachmentsGroup.label,
          render: () => (
            <OutlookAttachmentsDetail
              model={attachmentsGroup}
              group={group}
              disabled={sending}
            />
          ),
        },
      });
    }

    const stagedDrops = new Map(detail.drops.map((drop) => [drop.key, drop]));
    for (const drop of drops) {
      const staged = stagedDrops.get(drop.key);
      if (!staged) continue;
      const group = buildDropEmailGroup(staged, {
        bodySizeLabel: detail.dropSizeLabels.get(drop.key),
        verdicts: detail.dropVerdicts.get(drop.key),
        fallbackSubject: detail.fallbackSubject,
        dismissAttachment: (attachmentId) =>
          handlers.dismissDropAttachment(drop.key, attachmentId),
        restoreAttachment: (attachmentId) =>
          handlers.restoreDropAttachment(drop.key, attachmentId),
      });
      const file = detail.dropFiles.get(drop.key);
      items.push({
        id: outlookDropChipId(drop.key),
        kind: "outlook.droppedEmail",
        origin: "user",
        icon: "mail",
        state: drop.state,
        ...(drop.tone ? { tone: drop.tone } : {}),
        meta: drop.meta,
        label: drop.label,
        ...(drop.state === "included" && file
          ? { estimate: file, estimateUpload: true }
          : {}),
        ...lock,
        onRemove: () => handlers.removeDrop(drop.key),
        removeLabel: drop.removeLabel,
        detail: {
          title: drop.label,
          render: () => (
            <OutlookDropDetail model={drop} group={group} disabled={sending} />
          ),
        },
      });
    }

    if (dropProgress) {
      items.push({
        id: OUTLOOK_DROP_PROGRESS_CHIP_ID,
        kind: "outlook.dropProgress",
        origin: "user",
        icon: "mail",
        state: "loading",
        label: dropProgress.label,
        spokenLabel: t({
          id: "officeAddin.outlook.context.dropProgress.spoken",
          message: "Dropped emails",
        }),
        locked: true,
        lockReason: t({
          id: "officeAddin.outlook.context.dropProgress.lockReason",
          message: "Dropped emails can't be cancelled while Erato reads them",
        }),
      });
    }

    const modes: ComposerMode[] = scheduling
      ? [
          {
            id: "outlook.scheduling",
            label: scheduling.label,
            icon: "clock",
            description: scheduling.description,
            endLabel: scheduling.endLabel,
            onEnd: handlers.endScheduling,
            endedAnnouncement: scheduling.endedAnnouncement,
            ...lock,
          },
        ]
      : [];
    return { items, modes };
    // The models are compared by content; modelKey stands for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, handlers, detail, facetEstimate]);
}
