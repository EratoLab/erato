import { plural, t } from "@lingui/core/macro";

import { formatDateTime } from "./outlookContextFormat";
import { isPolicyExcluded } from "./validateStagedPart";

import type { StagedPartValidation } from "./validateStagedPart";
import type { StagedEmail } from "../providers/OutlookEmailSourceProvider";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
} from "@erato/frontend/library";

export type StagedThread = Extract<StagedEmail, { source: "current-thread" }>;

/** Verdicts keyed like the dismissals: thread message id, then attachment id. */
export type ThreadPartVerdicts = ReadonlyMap<
  string,
  ReadonlyMap<string, StagedPartValidation>
>;

export interface ThreadGroupHandlers {
  dismissMessage: (messageId: string) => void;
  restoreMessage: (messageId: string) => void;
  dismissAttachment: (messageId: string, attachmentId: string) => void;
  restoreAttachment: (messageId: string, attachmentId: string) => void;
}

// The placeholder stays `count` so the catalog entry reads {count, plural, …}.
export function threadMessageCountLabel(count: number): string {
  return t({
    id: "officeAddin.chatInput.threadMessageCount",
    message: plural(count, { one: "# message", other: "# messages" }),
  });
}

/**
 * The open thread's checklist for its chip's detail: one card per message,
 * with the message's attachments under it. Nothing of an unticked message is
 * sent, so its attachments read unticked; ticking one brings the message back
 * with only that attachment. Policy-excluded parts stay read-only.
 */
export function buildThreadGroup({
  staged,
  verdicts,
  metaLabel,
  handlers,
}: {
  staged: StagedThread;
  verdicts: ThreadPartVerdicts;
  /** "{size} of {limit}", or "Updating…" while the file rebuilds. */
  metaLabel: string;
  handlers: ThreadGroupHandlers;
}): FileAttachmentGroup {
  const items: FileAttachmentGroupItem[] = staged.thread.messages.map(
    (message) => {
      const senderLabel =
        message.from?.name?.trim() ||
        message.from?.address?.trim() ||
        t({
          id: "officeAddin.chatInput.unknownSender",
          message: "Unknown sender",
        });
      const sublabel = [formatDateTime(message.date), message.subject]
        .filter((part) => part.trim().length > 0)
        .join(" · ");
      const messageDismissed = staged.dismissedMessageIds.has(message.id);
      const messageVerdicts = verdicts.get(message.id);
      const sendable = message.attachments.filter((attachment) => {
        if (attachment.isInline) return false;
        const verdict = messageVerdicts?.get(attachment.id);
        return !verdict || !isPolicyExcluded(verdict);
      });
      const attachments = message.attachments
        .filter((attachment) => !attachment.isInline)
        .map((attachment) => {
          const dismissed = staged.dismissedAttachmentIds.has(attachment.id);
          const validation = messageVerdicts?.get(attachment.id);
          const excluded = !!validation && isPolicyExcluded(validation);
          return {
            id: attachment.id,
            file: {
              id: attachment.id,
              filename: attachment.filename,
              size: attachment.size,
            },
            selected: !messageDismissed && !dismissed,
            onToggle: excluded
              ? undefined
              : () => {
                  if (messageDismissed) {
                    // Bringing the message back would bring every sibling
                    // with it; only the ticked one should come.
                    for (const sibling of sendable) {
                      if (
                        sibling.id !== attachment.id &&
                        !staged.dismissedAttachmentIds.has(sibling.id)
                      ) {
                        handlers.dismissAttachment(message.id, sibling.id);
                      }
                    }
                    handlers.restoreMessage(message.id);
                    if (dismissed) {
                      handlers.restoreAttachment(message.id, attachment.id);
                    }
                  } else if (dismissed) {
                    handlers.restoreAttachment(message.id, attachment.id);
                  } else {
                    handlers.dismissAttachment(message.id, attachment.id);
                  }
                },
            validation,
          };
        });
      return {
        kind: "threadMessageGroup" as const,
        id: message.id,
        label: senderLabel,
        sublabel,
        selected: !messageDismissed,
        onToggle: () => {
          if (messageDismissed) {
            handlers.restoreMessage(message.id);
          } else {
            handlers.dismissMessage(message.id);
          }
        },
        defaultCollapsed: false,
        attachments,
      };
    },
  );
  return {
    id: `staged-email:${staged.key}`,
    label: threadMessageCountLabel(staged.thread.messages.length),
    metaLabel,
    items,
  };
}
