export interface DismissableAttachment {
  id: string;
  nested?: { attachments: DismissableAttachment[] };
}

/**
 * Attachment paths for the eml trimmer, descending into forwarded emails.
 * A dismissed forward is one path; its own attachments are covered by it.
 */
export function collectDismissedPaths(
  attachments: DismissableAttachment[],
  dismissedIds: ReadonlySet<string>,
  prefix = "",
): string[] {
  const paths: string[] = [];
  attachments.forEach((attachment, index) => {
    const path = `${prefix}${index}`;
    if (dismissedIds.has(attachment.id)) {
      paths.push(path);
      return;
    }
    if (attachment.nested) {
      paths.push(
        ...collectDismissedPaths(
          attachment.nested.attachments,
          dismissedIds,
          `${path}/`,
        ),
      );
    }
  });
  return paths;
}
