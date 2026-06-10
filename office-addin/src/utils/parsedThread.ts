/**
 * In-memory representation of an Outlook conversation thread fetched via the
 * environment's message backend (Graph on Exchange Online, Outlook REST v2.0
 * on-prem — see `fetchOutlookMessage.ts`; both produce the Graph-shaped
 * `GraphConversationMessage` rows consumed here). Drives the staged-input
 * preview UI (per-message cards with per-attachment checkboxes) and feeds
 * `synthesizeThreadEml` at send-time so a deselection in the UI is reflected
 * in the upload.
 *
 * We keep the structure normalised (mirrors `ParsedEmail` shapes) rather
 * than holding the raw JSON so the rest of the codebase doesn't have
 * to know about attachment subtypes or the `@odata.type` discriminator.
 */

import type { FetchConversationMessages } from "./fetchOutlookMessage";
import type {
  FetchConversationOptions,
  GraphAttachment,
  GraphConversationMessage,
  GraphRecipient,
} from "./fetchOutlookMessageGraph";
import type { ParsedEmailAddress } from "./parsedEmail";

const FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";
const ITEM_ATTACHMENT_TYPE = "#microsoft.graph.itemAttachment";
const REFERENCE_ATTACHMENT_TYPE = "#microsoft.graph.referenceAttachment";

export interface ThreadAttachment {
  /** Stable within the thread; concatenates messageId + Graph attachment id. */
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentBytes: ArrayBuffer | null;
  isInline: boolean;
  contentId: string | null;
  /**
   * When `contentBytes` is null, a human-readable reason the bytes are
   * unavailable (cloud reference, un-retrievable item, unsupported subtype).
   * Surfaced to the LLM as a disclosure marker so the attachment's existence
   * is never silently dropped (INV-9). Null when bytes are present.
   */
  unavailableReason: string | null;
}

export interface ThreadMessage {
  /** Stable within the thread; prefers internetMessageId, falls back to Graph id. */
  id: string;
  internetMessageId: string | null;
  subject: string;
  from: ParsedEmailAddress | null;
  to: ParsedEmailAddress[];
  cc: ParsedEmailAddress[];
  /** ISO 8601; prefers sentDateTime, falls back to receivedDateTime. */
  date: string | null;
  /** The chosen body (see `chooseBody`) — what synthesis emits. */
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: ThreadAttachment[];
}

export interface ParsedThread {
  conversationId: string;
  /** Outer-envelope subject; today the latest message's subject. */
  subject: string;
  messages: ThreadMessage[];
  /**
   * True when the conversation could not be fully fetched (a later page
   * failed or the page cap was hit). Consumers disclose this to the LLM
   * (INV-7), and `chooseBody` suppresses the plaintext-body collapse so
   * quoted history that may live only in an unfetched earlier message is
   * retained. (Attachment dedup stays safe even when incomplete: the
   * canonical copy a marker points to is always the first occurrence within
   * the fetched window, so the reference is never dangling.)
   */
  incomplete: boolean;
}

/**
 * Thrown when the conversation fetch fails on its very first page — i.e. we
 * have nothing, as opposed to a genuinely empty conversation. Callers must
 * surface this loudly rather than rendering "no thread" (INV-7).
 */
export class ThreadFetchError extends Error {
  constructor(conversationId: string) {
    super(`Failed to load Outlook conversation ${conversationId}`);
    this.name = "ThreadFetchError";
  }
}

export async function fetchCurrentThread(
  conversationId: string,
  fetchConversationMessages: FetchConversationMessages,
  options: FetchConversationOptions = {},
): Promise<ParsedThread | null> {
  const { messages: raw, state } = await fetchConversationMessages(
    conversationId,
    options,
  );
  // Total failure (first page errored → nothing fetched) must be loud, not a
  // silent null that looks identical to "this conversation has no messages".
  if (state === "error") {
    throw new ThreadFetchError(conversationId);
  }
  if (raw.length === 0) return null;

  const incomplete = state === "partial";
  const messages = raw
    .filter((message) => message.isDraft !== true)
    .map((message) => transformMessage(message, incomplete))
    .filter((message): message is ThreadMessage => message !== null);

  if (messages.length === 0) return null;

  messages.sort((a, b) => {
    const aTime = a.date ? Date.parse(a.date) : 0;
    const bTime = b.date ? Date.parse(b.date) : 0;
    return aTime - bTime;
  });

  const latestSubject = messages[messages.length - 1].subject;
  return {
    conversationId,
    subject: latestSubject,
    messages,
    incomplete,
  };
}

function transformMessage(
  message: GraphConversationMessage,
  incomplete: boolean,
): ThreadMessage | null {
  const id = message.internetMessageId ?? message.id ?? null;
  if (!id) return null;

  const attachments = (message.attachments ?? [])
    .map((attachment) => transformAttachment(attachment, id))
    .filter(
      (attachment): attachment is ThreadAttachment => attachment !== null,
    );

  const body = chooseBody(message, incomplete);

  return {
    id,
    internetMessageId: message.internetMessageId ?? null,
    subject: message.subject ?? "",
    from: normaliseAddress(message.from),
    to: (message.toRecipients ?? [])
      .map(normaliseAddress)
      .filter((address): address is ParsedEmailAddress => address !== null),
    cc: (message.ccRecipients ?? [])
      .map(normaliseAddress)
      .filter((address): address is ParsedEmailAddress => address !== null),
    date: message.sentDateTime ?? message.receivedDateTime ?? null,
    ...body,
    attachments,
  };
}

interface ChosenBody {
  bodyText: string | null;
  bodyHtml: string | null;
}

/**
 * Decide which body to emit for a message.
 *
 * Correctness first: default to the full Graph `body`, so forwarded content —
 * whose `uniqueBody` is frequently just the sender's signature — is never
 * lost (the original "forward shows only the signature" bug). The smaller
 * `uniqueBody` is chosen ONLY when it is a provable, loss-free subset of the
 * full body, which in practice holds only for plaintext (HTML `uniqueBody` is
 * an independently-generated fragment, not a substring of `body`, so it stays
 * full — accepted). `isHtml` is always read from the SAME source object that
 * supplied the chosen string, closing the decoupling bug where an empty-but-
 * typed `uniqueBody` mislabeled a plaintext `body` as HTML.
 *
 * When the thread is `incomplete`, the collapse is suppressed entirely: the
 * dropped quoted history might be the only surviving copy of an unfetched
 * earlier message, so we keep the full body and pay the tokens.
 */
function chooseBody(
  message: GraphConversationMessage,
  incomplete: boolean,
): ChosenBody {
  const uniqContent = nullIfEmpty(message.uniqueBody?.content);
  const fullContent = nullIfEmpty(message.body?.content);
  const uniqIsHtml = message.uniqueBody?.contentType === "html";
  const fullIsHtml = message.body?.contentType === "html";

  let chosenContent: string | null;
  let chosenIsHtml: boolean;
  if (fullContent === null) {
    // Full body empty → fall back to uniqueBody, reading its OWN type (INV-4).
    chosenContent = uniqContent;
    chosenIsHtml = uniqContent !== null ? uniqIsHtml : false;
  } else if (uniqContent === null) {
    chosenContent = fullContent;
    chosenIsHtml = fullIsHtml;
  } else if (uniqIsHtml !== fullIsHtml) {
    // Type disagreement → keep full (never risk the smaller one).
    chosenContent = fullContent;
    chosenIsHtml = fullIsHtml;
  } else if (
    !incomplete &&
    !uniqIsHtml &&
    normalize(fullContent).includes(normalize(uniqContent))
  ) {
    // Plaintext and uniqueBody is a provable loss-free substring of full →
    // collapse to the smaller copy (the only safe token win here). Skipped on
    // incomplete threads, where the dropped tail may be the sole copy.
    chosenContent = uniqContent;
    chosenIsHtml = false;
  } else {
    chosenContent = fullContent;
    chosenIsHtml = fullIsHtml;
  }

  // Defense-in-depth: a body declared html but containing no tag-like markup
  // is treated as text. Mislabeling text as HTML would let a downstream tag
  // stripper delete content between `<…>`; the reverse merely leaves a few
  // literal tags. Bias the tie to text/plain.
  if (
    chosenIsHtml &&
    chosenContent !== null &&
    !/<\w[\s\S]*>/.test(chosenContent)
  ) {
    chosenIsHtml = false;
  }

  return {
    bodyText: chosenContent !== null && !chosenIsHtml ? chosenContent : null,
    bodyHtml: chosenContent !== null && chosenIsHtml ? chosenContent : null,
  };
}

/** Collapse insignificant whitespace for a loss-free comparison key only
 * (never serialized): CRLF→LF, runs of whitespace → single space, trimmed. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function transformAttachment(
  attachment: GraphAttachment,
  messageId: string,
): ThreadAttachment | null {
  if (!attachment.id) return null;
  const id = `${messageId}:${attachment.id}`;
  const name = attachment.name ?? null;
  const isInline = attachment.isInline === true;
  const mimeType = attachment.contentType ?? "application/octet-stream";

  // fileAttachment, or an itemAttachment the fetch layer enriched with bytes.
  const bytes = attachment.contentBytes
    ? decodeBase64(attachment.contentBytes)
    : null;
  if (bytes) {
    return {
      id,
      filename: name ?? "attachment",
      mimeType,
      size: attachment.size ?? bytes.byteLength,
      contentBytes: bytes,
      isInline,
      contentId: attachment.contentId ?? null,
      unavailableReason: null,
    };
  }

  // No bytes available. Rather than the old silent `return null`, disclose the
  // attachment's existence so its content is never invisibly dropped (INV-9).
  const named = name ? `: ${name}` : "";
  let unavailableReason: string;
  switch (attachment["@odata.type"]) {
    case REFERENCE_ATTACHMENT_TYPE:
      unavailableReason = `cloud attachment (OneDrive/SharePoint)${named} — not inlined`;
      break;
    case ITEM_ATTACHMENT_TYPE:
      unavailableReason = `attached item could not be retrieved${named}`;
      break;
    case FILE_ATTACHMENT_TYPE:
      unavailableReason = `attachment had no retrievable content${named}`;
      break;
    default:
      unavailableReason = `attachment of unsupported type was present${named}`;
      break;
  }
  return {
    id,
    filename: name ?? "attachment",
    mimeType,
    size: attachment.size ?? 0,
    contentBytes: null,
    isInline,
    contentId: attachment.contentId ?? null,
    unavailableReason,
  };
}

function normaliseAddress(
  recipient: GraphRecipient | undefined,
): ParsedEmailAddress | null {
  const address = recipient?.emailAddress?.address?.trim();
  if (!address) return null;
  return {
    name: recipient?.emailAddress?.name?.trim() ?? "",
    address,
  };
}

function nullIfEmpty(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.trim().length === 0 ? null : value;
}

function decodeBase64(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out.buffer;
}
