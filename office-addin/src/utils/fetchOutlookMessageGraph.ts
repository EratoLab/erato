import { buildEmailBodyFile } from "./buildEmailBodyHtml";

/**
 * Fetches a single Outlook message via Microsoft Graph and returns its body
 * and attachments as an array of File objects suitable for the existing
 * upload pipeline.
 *
 * This is the Microsoft-365 / Exchange-Online path. It is the blessed
 * replacement for the legacy callback-token + Outlook REST v2.0 route
 * (preserved for on-prem in `./fetchOutlookMessageRestV2.ts`). Callers
 * provide an `acquireGraphToken` function bound to the `Mail.Read` scope via
 * MSAL NAA; see `AddinChat.tsx` for the wiring.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const FILE_ATTACHMENT_ODATA_TYPE = "#microsoft.graph.fileAttachment";

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphRecipient {
  emailAddress?: GraphEmailAddress;
}

interface GraphBody {
  contentType?: "html" | "text";
  content?: string;
}

interface GraphAttachment {
  "@odata.type"?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
}

interface GraphMessage {
  id?: string;
  subject?: string;
  body?: GraphBody;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  attachments?: GraphAttachment[];
  internetMessageId?: string;
}

export interface FetchOutlookMessageResult {
  subject: string;
  files: File[];
}

export type AcquireGraphToken = () => Promise<string>;

/**
 * Fetches a message by its EWS item id. The id is converted to the Graph-
 * compatible REST id via `Office.context.mailbox.convertToRestId` before the
 * HTTP call.
 */
export async function fetchOutlookMessageFilesViaGraph(
  ewsItemId: string,
  acquireToken: AcquireGraphToken,
): Promise<FetchOutlookMessageResult> {
  const restId = convertEwsIdToGraphId(ewsItemId);
  const token = await acquireToken();
  const message = await fetchMessageById(restId, token);
  return { subject: message.subject ?? "", files: toFiles(message) };
}

/**
 * Looks up a message by its RFC 5322 `Message-ID` header, returning the body
 * and attachments if exactly one match is found. Returns `null` when Graph's
 * filter returns an empty result (e.g. for drafts that don't yet have an
 * indexed internet message id).
 */
export async function fetchOutlookMessageFilesByInternetMessageIdViaGraph(
  internetMessageId: string,
  acquireToken: AcquireGraphToken,
): Promise<FetchOutlookMessageResult | null> {
  const token = await acquireToken();
  const match = await findMessageByInternetMessageId(internetMessageId, token);
  if (!match) {
    return null;
  }
  if (!match.id) {
    return null;
  }
  const message = await fetchMessageById(match.id, token);
  return { subject: message.subject ?? "", files: toFiles(message) };
}

function convertEwsIdToGraphId(ewsItemId: string): string {
  const mailbox = Office.context.mailbox;
  return mailbox.convertToRestId(
    ewsItemId,
    Office.MailboxEnums.RestVersion.v2_0,
  );
}

async function fetchMessageById(
  messageId: string,
  token: string,
): Promise<GraphMessage> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$expand=attachments`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Graph fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as GraphMessage;
}

async function findMessageByInternetMessageId(
  internetMessageId: string,
  token: string,
): Promise<GraphMessage | null> {
  const filter = `internetMessageId eq '${escapeODataString(internetMessageId)}'`;
  const url = `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$top=1&$select=id,subject,internetMessageId`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Graph lookup failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as { value?: GraphMessage[] };
  const first = payload.value?.[0];
  return first ?? null;
}

function toFiles(message: GraphMessage): File[] {
  const files: File[] = [];
  const body = buildBodyFile(message);
  if (body) {
    files.push(body);
  }
  for (const attachment of message.attachments ?? []) {
    const file = buildAttachmentFile(attachment);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function buildBodyFile(message: GraphMessage): File | null {
  const body = message.body;
  if (!body?.content) {
    return null;
  }
  const contentIsHtml = body.contentType === "html";
  const date = message.receivedDateTime
    ? new Date(message.receivedDateTime)
    : null;
  return buildEmailBodyFile({
    subject: message.subject ?? "(no subject)",
    from: toAddress(message.from),
    to: (message.toRecipients ?? []).map(toAddress),
    cc: (message.ccRecipients ?? []).map(toAddress),
    date,
    bodyHtml: contentIsHtml ? body.content : null,
    bodyText: contentIsHtml ? null : body.content,
  });
}

function toAddress(recipient: GraphRecipient | undefined): {
  name?: string;
  address?: string;
} {
  const emailAddress = recipient?.emailAddress;
  return {
    name: emailAddress?.name,
    address: emailAddress?.address,
  };
}

function buildAttachmentFile(attachment: GraphAttachment): File | null {
  if (attachment["@odata.type"] !== FILE_ATTACHMENT_ODATA_TYPE) {
    // itemAttachment (nested messages) and referenceAttachment (cloud links)
    // have no contentBytes payload — skip them.
    return null;
  }
  if (!attachment.contentBytes || !attachment.name) {
    return null;
  }
  if (attachment.isInline) {
    return null;
  }
  const buffer = decodeBase64ToBuffer(attachment.contentBytes);
  if (!buffer) {
    return null;
  }
  return new File([buffer], attachment.name, {
    type: attachment.contentType ?? "application/octet-stream",
  });
}

function decodeBase64ToBuffer(base64: string): ArrayBuffer | null {
  try {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      view[index] = binary.charCodeAt(index);
    }
    return buffer;
  } catch {
    return null;
  }
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
