import { t } from "@lingui/core/macro";

import { isPolicyExcluded } from "./validateStagedPart";

import type { ParsedAttachment, ParsedEmail } from "./parsedEmail";
import type {
  StagedPartMetadata,
  StagedPartValidation,
} from "./validateStagedPart";
import type {
  FileAttachmentGroup,
  FileAttachmentGroupItem,
  ThreadMessageAttachmentItem,
} from "@erato/frontend/library";

/** One `.eml` dragged onto the chat, with the user's dismissals so far. */
export interface StagedDropEmail {
  key: string;
  parsed: ParsedEmail;
  bodyDismissed: boolean;
  dismissedAttachmentIds: ReadonlySet<string>;
}

export interface DropEmailGroupOptions {
  /** Size of the file the send would upload; the original's when unresolved. */
  resolvedSize?: number;
  /** Replaces the body row's size line while the resolution catches up. */
  bodyMetaLabel?: string;
  /** Verdicts by attachment id, at every level the card renders. */
  verdicts?: ReadonlyMap<string, StagedPartValidation>;
  /** Group label when the email has no subject. */
  fallbackSubject: string;
  dismissBody: () => void;
  restoreBody: () => void;
  dismissAttachment: (attachmentId: string) => void;
  restoreAttachment: (attachmentId: string) => void;
}

/**
 * Part of the body rather than attached to it: always sent, so its row is
 * read-only. A forwarded email is an attachment whatever its disposition.
 */
export function isEmailBodyPart(attachment: ParsedAttachment): boolean {
  if (attachment.mimeType.trim().toLowerCase() === "message/rfc822") {
    return false;
  }
  return attachment.disposition === "inline" || attachment.related;
}

/**
 * Judges every part the card renders: the attachments and, one level down,
 * the parts of each expanded forward. `excluded` lists the ids policy leaves
 * out for the user; a part inside a forward that cannot be cut out keeps its
 * verdict for the badge but is never excluded, as that would demand a trim
 * the bytes cannot honour.
 */
export function judgeDropEmailParts(
  parsed: ParsedEmail,
  validate: (part: StagedPartMetadata) => StagedPartValidation,
): { verdicts: Map<string, StagedPartValidation>; excluded: string[] } {
  const verdicts = new Map<string, StagedPartValidation>();
  const excluded: string[] = [];
  const judge = (part: ParsedAttachment, enforce: boolean) => {
    const verdict = validate(part);
    verdicts.set(part.id, verdict);
    if (enforce && isPolicyExcluded(verdict)) excluded.push(part.id);
  };
  for (const attachment of parsed.attachments) {
    if (isEmailBodyPart(attachment)) continue;
    judge(attachment, true);
    for (const part of attachment.nested?.attachments ?? []) {
      if (isEmailBodyPart(part)) continue;
      judge(part, attachment.nestedTrimmable === true);
    }
  }
  return { verdicts, excluded };
}

/**
 * The card for one dropped email: its body, then one row per attachment. A
 * forwarded email that was expanded renders as a nested card whose header
 * toggles the whole forward and whose rows toggle the parts inside it — but
 * only when those parts can be cut out of the bytes; otherwise the rows are
 * read-only and the forward goes whole or not at all. Rows under an
 * unchecked forward stay live; the forward's removal covers them.
 */
export function buildDropEmailGroup(
  staged: StagedDropEmail,
  options: DropEmailGroupOptions,
): FileAttachmentGroup {
  const { key, parsed } = staged;
  const items: FileAttachmentGroupItem[] = [];
  const dismissed = (attachmentId: string) =>
    staged.dismissedAttachmentIds.has(attachmentId);
  const toggle = (attachmentId: string) => () => {
    if (dismissed(attachmentId)) {
      options.restoreAttachment(attachmentId);
    } else {
      options.dismissAttachment(attachmentId);
    }
  };
  const verdictOf = (attachment: ParsedAttachment) =>
    options.verdicts?.get(attachment.id);
  const excluded = (validation: StagedPartValidation | undefined) =>
    !!validation && isPolicyExcluded(validation);

  items.push({
    kind: "selectableAttachment",
    id: `${key}:body`,
    file: {
      id: `${key}:body`,
      filename: parsed.rawEmlFile.name,
      displayName: t({
        id: "officeAddin.chatInput.emailBody",
        message: "Email body",
      }),
      size: options.resolvedSize ?? parsed.rawEmlFile.size,
    },
    metaLabel: options.bodyMetaLabel,
    selected: !staged.bodyDismissed,
    onToggle: () => {
      if (staged.bodyDismissed) {
        options.restoreBody();
      } else {
        options.dismissBody();
      }
    },
    labelOverride: t({
      id: "officeAddin.chatInput.emailLabel",
      message: "Email",
    }),
  });

  for (const attachment of parsed.attachments) {
    const rowId = `${key}:${attachment.id}`;
    if (isEmailBodyPart(attachment)) {
      items.push({
        kind: "selectableAttachment",
        id: rowId,
        file: {
          id: rowId,
          filename: attachment.filename,
          size: attachment.size,
        },
        selected: true,
      });
      continue;
    }
    const validation = verdictOf(attachment);
    const isExcluded = excluded(validation);
    const { nested } = attachment;
    if (nested) {
      const partsToggle = attachment.nestedTrimmable === true && !isExcluded;
      const rows: ThreadMessageAttachmentItem[] = nested.attachments.map(
        (part) => {
          const partRowId = `${key}:${part.id}`;
          const file = {
            id: partRowId,
            filename: part.filename,
            size: part.size,
          };
          if (isEmailBodyPart(part)) {
            return { id: partRowId, file, selected: true };
          }
          const partValidation = verdictOf(part);
          return {
            id: partRowId,
            file,
            selected: !dismissed(part.id),
            onToggle:
              partsToggle && !excluded(partValidation)
                ? toggle(part.id)
                : undefined,
            validation: partValidation,
          };
        },
      );
      items.push({
        kind: "threadMessageGroup",
        id: rowId,
        label: nested.subject ?? attachment.filename,
        sublabel: senderAndDate(nested),
        selected: !dismissed(attachment.id),
        onToggle: isExcluded ? undefined : toggle(attachment.id),
        validation,
        defaultCollapsed: true,
        attachments: rows,
      });
      continue;
    }
    items.push({
      kind: "selectableAttachment",
      id: rowId,
      file: { id: rowId, filename: attachment.filename, size: attachment.size },
      selected: !dismissed(attachment.id),
      onToggle: isExcluded ? undefined : toggle(attachment.id),
      validation,
    });
  }

  return {
    id: `staged-email:${key}`,
    label:
      parsed.subject ||
      options.fallbackSubject ||
      t({
        id: "officeAddin.chatInput.emailFallback",
        message: "Email",
      }),
    metaLabel: senderAndDate(parsed),
    items,
    collapsible: true,
    defaultCollapsed: true,
  };
}

function senderAndDate(email: ParsedEmail): string {
  const fromLabel = email.from ? email.from.name || email.from.address : "";
  const dateLabel = email.date ? new Date(email.date).toLocaleDateString() : "";
  return [fromLabel, dateLabel].filter((part) => part.length > 0).join(" • ");
}
