import { plural, t } from "@lingui/core/macro";

import { formatShortDate } from "./outlookContextFormat";
import { stripAngleBrackets } from "./parsedEmail";
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
  /**
   * The size of the file the send would upload, formatted, or "Updating…"
   * while the resolution catches up.
   */
  bodySizeLabel?: string;
  /** Verdicts by attachment id, at every level the card renders. */
  verdicts?: ReadonlyMap<string, StagedPartValidation>;
  /** Group label when the email has neither sender nor date nor subject. */
  fallbackSubject: string;
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

/** The Content-IDs an HTML body shows through `cid:` links, bare and lower-cased. */
export function bodyContentIds(html: string | null): Set<string> {
  const ids = new Set<string>();
  for (const match of html?.matchAll(/cid:([^"'\s<>)]+)/gi) ?? []) {
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      // A malformed escape stays as written.
    }
    ids.add(id.toLowerCase());
  }
  return ids;
}

/**
 * A picture the body shows through a `cid:` link. It travels in the email's
 * bytes with the body, can no more be left out than the body, and is no
 * attachment to the reader (Outlook does not list it either), so the detail
 * counts it on the body row instead of listing it.
 */
export function isBodyPicture(
  part: ParsedAttachment,
  bodyIds: ReadonlySet<string>,
): boolean {
  return (
    isEmailBodyPart(part) &&
    part.mimeType.trim().toLowerCase().startsWith("image/") &&
    part.contentId !== null &&
    bodyIds.has(stripAngleBrackets(part.contentId).toLowerCase())
  );
}

const FORMAT_NAMES: Record<string, string> = {
  jpeg: "JPEG",
  jpg: "JPEG",
  pjpeg: "JPEG",
  "svg+xml": "SVG",
  webp: "WebP",
  "x-icon": "ICO",
  "vnd.microsoft.icon": "ICO",
};

/** "PNG image" from `image/png`; null where the MIME type says nothing a reader could use. */
export function partTypeLabel(mimeType: string): string | null {
  const [type, rawSubtype = ""] = mimeType
    .split(";")[0]
    .trim()
    .toLowerCase()
    .split("/");
  const subtype = rawSubtype.trim();
  if (type === "application" && subtype === "pdf") {
    return t({
      id: "officeAddin.outlook.context.drop.partType.pdf",
      message: "PDF document",
    });
  }
  if (!subtype || !["image", "audio", "video"].includes(type)) return null;
  const format =
    FORMAT_NAMES[subtype] ??
    subtype
      .replace(/^(x-|vnd\.)/, "")
      .replace(/\+.*$/, "")
      .toUpperCase();
  if (type === "image") {
    return t({
      id: "officeAddin.outlook.context.drop.partType.image",
      message: `${format} image`,
    });
  }
  if (type === "audio") {
    return t({
      id: "officeAddin.outlook.context.drop.partType.audio",
      message: `${format} audio`,
    });
  }
  return t({
    id: "officeAddin.outlook.context.drop.partType.video",
    message: `${format} video`,
  });
}

function hasExtension(filename: string): boolean {
  return /\.[a-z0-9]{1,8}$/i.test(filename.trim());
}

/**
 * Names the rows of one message: a part without a name of its own is
 * numbered by kind ("Inline image 2"), and a row whose name carries no
 * extension takes its type from the MIME type, where the filename would give
 * none.
 */
function partRowNamer() {
  const counts = { inlineImage: 0, image: 0, attachment: 0 };
  return (
    part: ParsedAttachment,
  ): { displayName?: string; labelOverride?: string } => {
    const typeLabel = partTypeLabel(part.mimeType) ?? undefined;
    if (!part.unnamed) {
      return hasExtension(part.filename) || !typeLabel
        ? {}
        : { labelOverride: typeLabel };
    }
    const image = part.mimeType.trim().toLowerCase().startsWith("image/");
    let displayName: string;
    if (image && isEmailBodyPart(part)) {
      const n = ++counts.inlineImage;
      displayName = t({
        id: "officeAddin.outlook.context.drop.unnamedInlineImage",
        message: `Inline image ${n}`,
      });
    } else if (image) {
      const n = ++counts.image;
      displayName = t({
        id: "officeAddin.outlook.context.drop.unnamedImage",
        message: `Image ${n}`,
      });
    } else {
      const n = ++counts.attachment;
      displayName = t({
        id: "officeAddin.outlook.context.drop.unnamedAttachment",
        message: `Attachment ${n}`,
      });
    }
    return typeLabel
      ? { displayName, labelOverride: typeLabel }
      : { displayName };
  };
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
 * Of a dropped email's attachments (forwards count as one), how many go: the
 * drop chip's "2/3 attachments". A part policy leaves out does not.
 */
export function dropAttachmentCounts(
  staged: StagedDropEmail,
  verdicts: ReadonlyMap<string, StagedPartValidation> | undefined,
): { kept: number; total: number } {
  let kept = 0;
  let total = 0;
  for (const attachment of staged.parsed.attachments) {
    if (isEmailBodyPart(attachment)) continue;
    total += 1;
    const verdict = verdicts?.get(attachment.id);
    if (
      !staged.dismissedAttachmentIds.has(attachment.id) &&
      !(verdict && isPolicyExcluded(verdict))
    ) {
      kept += 1;
    }
  }
  return { kept, total };
}

/**
 * The checklist for one dropped email's detail: its body, which always goes
 * and so is read-only (the chip's (x) removes the email), then one row per
 * attachment. A forwarded email that was expanded renders as a nested card
 * whose header toggles the whole forward and whose rows toggle the parts
 * inside it — but only when those parts can be cut out of the bytes;
 * otherwise the rows are read-only and the forward goes whole or not at all.
 * Rows under an unchecked forward stay live; the forward's removal covers
 * them.
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

  const emailLabel = t({
    id: "officeAddin.chatInput.emailLabel",
    message: "Email",
  });
  const bodyIds = bodyContentIds(parsed.html);
  const bodyPictures = parsed.attachments.filter((attachment) =>
    isBodyPicture(attachment, bodyIds),
  ).length;
  items.push({
    kind: "selectableAttachment",
    id: `${key}:body`,
    file: {
      id: `${key}:body`,
      filename: parsed.rawEmlFile.name,
      // The count rides on the name: at pane width the meta line has no room
      // left for it in German or Spanish.
      displayName:
        bodyPictures > 0
          ? t({
              id: "officeAddin.outlook.context.drop.bodyWithPictures",
              message: plural(bodyPictures, {
                one: "Email body with # image",
                other: "Email body with # images",
              }),
            })
          : t({
              id: "officeAddin.chatInput.emailBody",
              message: "Email body",
            }),
      size: parsed.rawEmlFile.size,
    },
    metaLabel: [
      emailLabel,
      options.bodySizeLabel,
      t({
        id: "officeAddin.outlook.context.drop.bodyAlwaysSent",
        message: "Always sent",
      }),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · "),
    selected: true,
    labelOverride: emailLabel,
  });

  const nameRow = partRowNamer();
  for (const attachment of parsed.attachments) {
    if (isBodyPicture(attachment, bodyIds)) continue;
    const rowId = `${key}:${attachment.id}`;
    const { displayName, labelOverride } = nameRow(attachment);
    const file = {
      id: rowId,
      filename: attachment.filename,
      ...(displayName ? { displayName } : {}),
      size: attachment.size,
    };
    if (isEmailBodyPart(attachment)) {
      items.push({
        kind: "selectableAttachment",
        id: rowId,
        file,
        selected: true,
        labelOverride,
      });
      continue;
    }
    const validation = verdictOf(attachment);
    const isExcluded = excluded(validation);
    const { nested } = attachment;
    if (nested) {
      const partsToggle = attachment.nestedTrimmable === true && !isExcluded;
      const nestedBodyIds = bodyContentIds(nested.html);
      const nameNestedRow = partRowNamer();
      const rows: ThreadMessageAttachmentItem[] = nested.attachments.flatMap(
        (part): ThreadMessageAttachmentItem[] => {
          if (isBodyPicture(part, nestedBodyIds)) return [];
          const partRowId = `${key}:${part.id}`;
          const { displayName: partName, labelOverride: partLabel } =
            nameNestedRow(part);
          const partFile = {
            id: partRowId,
            filename: part.filename,
            ...(partName ? { displayName: partName } : {}),
            size: part.size,
          };
          if (isEmailBodyPart(part)) {
            return [
              {
                id: partRowId,
                file: partFile,
                selected: true,
                labelOverride: partLabel,
              },
            ];
          }
          const partValidation = verdictOf(part);
          return [
            {
              id: partRowId,
              file: partFile,
              labelOverride: partLabel,
              selected: !dismissed(part.id),
              onToggle:
                partsToggle && !excluded(partValidation)
                  ? toggle(part.id)
                  : undefined,
              validation: partValidation,
            },
          ];
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
      file,
      selected: !dismissed(attachment.id),
      onToggle: isExcluded ? undefined : toggle(attachment.id),
      labelOverride,
      validation,
    });
  }

  return {
    id: `staged-email:${key}`,
    label:
      senderAndDate(parsed) ||
      parsed.subject ||
      options.fallbackSubject ||
      t({
        id: "officeAddin.chatInput.emailFallback",
        message: "Email",
      }),
    metaLabel: "",
    items,
  };
}

/** "Lena Hoffmann • 10/7/2026", in the app's language. */
export function senderAndDate(email: ParsedEmail): string {
  const fromLabel = email.from ? email.from.name || email.from.address : "";
  const dateLabel = formatShortDate(email.date);
  return [fromLabel, dateLabel].filter((part) => part.length > 0).join(" • ");
}
