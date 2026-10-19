import type { ParsedThread } from "./parsedThread";

export interface ThreadAttachmentMatch {
  /** The thread message's dismissal key. */
  messageId: string;
  attachmentId: string;
}

interface OfficeAttachment {
  id: string;
  name: string;
  size: number;
  isInline: boolean;
}

/**
 * Pairs the open message's Office.js attachments with the same files in the
 * staged thread, so the "+" menu can read and restore the thread's own ticks.
 * Graph and Office.js share no attachment id, so this matches on name and
 * size, then on name alone in order; whatever stays unmatched keeps the
 * menu's Office.js path.
 */
export function matchThreadAttachments(
  thread: ParsedThread | null,
  openInternetMessageId: string | null | undefined,
  officeAttachments: readonly OfficeAttachment[],
): Map<string, ThreadAttachmentMatch> {
  const matches = new Map<string, ThreadAttachmentMatch>();
  if (!thread || !openInternetMessageId) return matches;
  const message = thread.messages.find(
    (candidate) =>
      candidate.internetMessageId === openInternetMessageId ||
      candidate.id === openInternetMessageId,
  );
  if (!message) return matches;

  const candidates = message.attachments.filter(
    (attachment) => !attachment.isInline,
  );
  const claimed = new Set<string>();
  const pending = officeAttachments.filter(
    (attachment) => !attachment.isInline,
  );
  const claim = (
    isMatch: (
      office: OfficeAttachment,
      candidate: (typeof candidates)[number],
    ) => boolean,
  ) => {
    for (const office of pending) {
      if (matches.has(office.id)) continue;
      const candidate = candidates.find(
        (entry) => !claimed.has(entry.id) && isMatch(office, entry),
      );
      if (!candidate) continue;
      claimed.add(candidate.id);
      matches.set(office.id, {
        messageId: message.id,
        attachmentId: candidate.id,
      });
    }
  };
  claim(
    (office, candidate) =>
      candidate.filename === office.name && candidate.size === office.size,
  );
  claim((office, candidate) => candidate.filename === office.name);
  return matches;
}
