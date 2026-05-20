/**
 * In-memory representation of an Outlook conversation thread fetched via
 * Microsoft Graph. Drives the staged-input preview UI (per-message cards
 * with per-attachment checkboxes) and feeds `synthesizeThreadEml` at
 * send-time so a deselection in the UI is reflected in the upload.
 *
 * We keep the structure normalised (mirrors `ParsedEmail` shapes) rather
 * than holding Graph's raw JSON so the rest of the codebase doesn't have
 * to know about Graph attachment subtypes or the `@odata.type` discriminator.
 */

import {
  fetchConversationMessagesViaGraph,
  type AcquireGraphToken,
  type FetchConversationOptions,
  type GraphAttachment,
  type GraphConversationMessage,
  type GraphRecipient,
} from "./fetchOutlookMessageGraph";

import type { ParsedEmailAddress } from "./parsedEmail";

const FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";

export interface ThreadAttachment {
  /** Stable within the thread; concatenates messageId + Graph attachment id. */
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  contentBytes: ArrayBuffer | null;
  isInline: boolean;
  contentId: string | null;
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
  bodyText: string | null;
  bodyHtml: string | null;
  attachments: ThreadAttachment[];
}

export interface ParsedThread {
  conversationId: string;
  /** Outer-envelope subject; today the latest message's subject. */
  subject: string;
  messages: ThreadMessage[];
}

export async function fetchCurrentThread(
  conversationId: string,
  acquireToken: AcquireGraphToken,
  options: FetchConversationOptions = {},
): Promise<ParsedThread | null> {
  const raw = await fetchConversationMessagesViaGraph(
    conversationId,
    acquireToken,
    options,
  );
  if (raw.length === 0) return null;

  const messages = raw
    .filter((message) => message.isDraft !== true)
    .map((message) => transformMessage(message))
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
  };
}

function transformMessage(
  message: GraphConversationMessage,
): ThreadMessage | null {
  const id = message.internetMessageId ?? message.id ?? null;
  if (!id) return null;

  const attachments = (message.attachments ?? [])
    .map((attachment) => transformAttachment(attachment, id))
    .filter(
      (attachment): attachment is ThreadAttachment => attachment !== null,
    );

  const uniqueBodyContent = nullIfEmpty(message.uniqueBody?.content);
  const fullBodyContent = nullIfEmpty(message.body?.content);
  const preferredBody = uniqueBodyContent ?? fullBodyContent;
  const isHtml =
    (message.uniqueBody?.contentType ?? message.body?.contentType) === "html";

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
    bodyText: isHtml ? null : preferredBody,
    bodyHtml: isHtml ? preferredBody : null,
    attachments,
  };
}

function transformAttachment(
  attachment: GraphAttachment,
  messageId: string,
): ThreadAttachment | null {
  // Only fileAttachments carry contentBytes inline. itemAttachment and
  // referenceAttachment subtypes would need follow-up calls — out of scope
  // for the first iteration (the user's reported thread uses regular file
  // attachments).
  if (attachment["@odata.type"] !== FILE_ATTACHMENT_TYPE) return null;
  if (!attachment.id || !attachment.name) return null;
  const bytes = attachment.contentBytes
    ? decodeBase64(attachment.contentBytes)
    : null;
  return {
    id: `${messageId}:${attachment.id}`,
    filename: attachment.name,
    mimeType: attachment.contentType ?? "application/octet-stream",
    size: attachment.size ?? bytes?.byteLength ?? 0,
    contentBytes: bytes,
    isInline: attachment.isInline === true,
    contentId: attachment.contentId ?? null,
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
