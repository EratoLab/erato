/**
 * Turns the fetched, included thread messages into the `ThreadMessageInput[]`
 * that `synthesizeThreadEml` serializes — applying the one verified token
 * win (exact attachment-byte dedup) and surfacing every content-loss-relevant
 * fact as an LLM-visible marker.
 *
 * Governing asymmetry (see the design doc): never lose content; deduping is a
 * best-effort token layer that may only drop a unit it can PROVE is identical
 * to one already emitted. Concretely:
 *
 *   - Attachment bytes are deduped only on full byte-equality (length bucket
 *     then byte-for-byte). The earliest message holding a given byte stream is
 *     canonical and keeps the real copy; later identical copies become a
 *     provenance marker naming where the full copy lives. Three different
 *     versions of `Lastenheft.pdf` = three byte streams = all kept.
 *   - Attachments with no retrievable bytes (cloud references, un-fetchable
 *     items) are disclosed as markers, never silently dropped (INV-9).
 *   - An image-only message (no body text, only inline images) gets a marker
 *     so it isn't invisibly empty.
 *   - A partial thread appends a synthetic note disclosing incompleteness
 *     (INV-7).
 *
 * Bodies are never mutated for dedup — markers are appended, respecting the
 * message's html-vs-text body type.
 */

import type { ThreadMessage } from "./parsedThread";
import type {
  ThreadAttachmentInput,
  ThreadMessageInput,
} from "./synthesizeThreadEml";

/**
 * Below this size deduping doesn't pay: the base64 of the bytes is no larger
 * than the provenance marker that would replace it, so we just keep the copy.
 */
const MIN_DEDUP_BYTES = 512;

interface SeenAttachment {
  byteLength: number;
  bytes: Uint8Array;
  filename: string;
  label: string;
}

export function buildThreadSynthInputs(
  messages: ThreadMessage[],
  dismissedAttachmentIds: ReadonlySet<string>,
  incomplete = false,
): ThreadMessageInput[] {
  const seen: SeenAttachment[] = [];
  const inputs: ThreadMessageInput[] = [];

  for (const message of messages) {
    const markers: string[] = [];
    const attachments: ThreadAttachmentInput[] = [];
    const label = messageLabel(message);

    for (const attachment of message.attachments) {
      if (attachment.isInline) continue; // inline images handled below, not byte-deduped
      if (dismissedAttachmentIds.has(attachment.id)) continue;

      if (attachment.contentBytes === null) {
        markers.push(
          `[${attachment.unavailableReason ?? `attachment "${attachment.filename}" had no retrievable content`}]`,
        );
        continue;
      }

      const bytes = new Uint8Array(attachment.contentBytes);
      if (bytes.byteLength >= MIN_DEDUP_BYTES) {
        const duplicate = seen.find(
          (candidate) =>
            candidate.byteLength === bytes.byteLength &&
            bytesEqual(candidate.bytes, bytes),
        );
        if (duplicate) {
          markers.push(
            `[attachment "${attachment.filename}" — identical to "${duplicate.filename}" from ${duplicate.label}; full copy included there]`,
          );
          continue;
        }
        seen.push({
          byteLength: bytes.byteLength,
          bytes,
          filename: attachment.filename,
          label,
        });
      }

      attachments.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        contentBytes: attachment.contentBytes,
      });
    }

    const hasBody =
      (message.bodyHtml ?? message.bodyText ?? "").trim().length > 0;
    if (!hasBody) {
      const inlineImages = message.attachments.filter(
        (attachment) => attachment.isInline,
      );
      if (inlineImages.length > 0) {
        markers.push(
          `[image-only message: ${inlineImages
            .map((attachment) => attachment.filename)
            .join(", ")}; no extractable text]`,
        );
      }
    }

    const { bodyText, bodyHtml } = appendMarkers(
      message.bodyText,
      message.bodyHtml,
      markers,
    );

    inputs.push({
      internetMessageId: message.internetMessageId,
      subject: message.subject,
      from: message.from
        ? { name: message.from.name, address: message.from.address }
        : null,
      to: message.to.map((address) => ({
        name: address.name,
        address: address.address,
      })),
      cc: message.cc.map((address) => ({
        name: address.name,
        address: address.address,
      })),
      date: message.date,
      bodyText,
      bodyHtml,
      attachments,
    });
  }

  if (incomplete) {
    inputs.push(partialThreadNote());
  }

  return inputs;
}

/** A stable, human-readable handle for the message that holds a canonical
 * attachment copy — used inside provenance markers. */
function messageLabel(message: ThreadMessage): string {
  const who = message.from?.name?.trim() || message.from?.address?.trim();
  const when = message.date ? ` (${message.date})` : "";
  if (who) return `${who}${when}`;
  if (message.subject.trim()) return `"${message.subject.trim()}"${when}`;
  return `an earlier message${when}`;
}

function appendMarkers(
  bodyText: string | null,
  bodyHtml: string | null,
  markers: string[],
): { bodyText: string | null; bodyHtml: string | null } {
  if (markers.length === 0) return { bodyText, bodyHtml };

  if (bodyHtml !== null) {
    const appended = markers
      .map((marker) => `<p>${escapeHtml(marker)}</p>`)
      .join("");
    return { bodyText, bodyHtml: `${bodyHtml}${appended}` };
  }

  const block = markers.join("\n");
  const base = bodyText ?? "";
  const joined = base.length > 0 ? `${base}\n\n${block}` : block;
  return { bodyText: joined, bodyHtml: null };
}

function partialThreadNote(): ThreadMessageInput {
  return {
    internetMessageId: null,
    subject: "[Partial conversation]",
    from: null,
    to: [],
    cc: [],
    date: null,
    bodyText:
      "[Some messages in this conversation could not be retrieved — this thread is partial.]",
    bodyHtml: null,
    attachments: [],
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
