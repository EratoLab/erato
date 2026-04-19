import { buildEmailBodyFile } from "./buildEmailBodyHtml";
import { callOfficeAsync } from "./officeAsync";

/**
 * Fetches a single Outlook message by its EWS item id and returns its body
 * and attachments as an array of File objects suitable for the existing
 * upload pipeline.
 *
 * Uses the Outlook REST API v2.0 via the token returned by
 * `Office.context.mailbox.getCallbackTokenAsync({ isRest: true })`. No extra
 * MSAL / Graph scopes are required. The REST v2.0 surface has been flagged
 * for eventual retirement by Microsoft; if that happens we can swap to
 * Microsoft Graph without changing callers of this module.
 */

interface OutlookRestEmailAddress {
  Name?: string;
  Address?: string;
}

interface OutlookRestRecipient {
  EmailAddress?: OutlookRestEmailAddress;
}

interface OutlookRestBody {
  ContentType?: "HTML" | "Text";
  Content?: string;
}

interface OutlookRestAttachment {
  "@odata.type"?: string;
  Id?: string;
  Name?: string;
  ContentType?: string;
  Size?: number;
  IsInline?: boolean;
  ContentBytes?: string;
}

interface OutlookRestMessage {
  Id?: string;
  Subject?: string;
  Body?: OutlookRestBody;
  From?: OutlookRestRecipient;
  ToRecipients?: OutlookRestRecipient[];
  CcRecipients?: OutlookRestRecipient[];
  ReceivedDateTime?: string;
  Attachments?: OutlookRestAttachment[];
}

export interface FetchOutlookMessageResult {
  subject: string;
  files: File[];
}

const FILE_ATTACHMENT_ODATA_TYPE = "#Microsoft.OutlookServices.FileAttachment";

export async function fetchOutlookMessageFiles(
  ewsItemId: string,
): Promise<FetchOutlookMessageResult> {
  const restId = convertToRestId(ewsItemId);
  const token = await getRestCallbackToken();
  const restUrl = getRestUrl();
  const message = await fetchMessage(restUrl, restId, token);

  const files: File[] = [];
  const bodyFile = buildBodyFile(message);
  if (bodyFile) {
    files.push(bodyFile);
  }

  for (const attachment of message.Attachments ?? []) {
    const file = buildAttachmentFile(attachment);
    if (file) {
      files.push(file);
    }
  }

  return { subject: message.Subject ?? "", files };
}

function convertToRestId(ewsItemId: string): string {
  const mailbox = Office.context.mailbox;
  return mailbox.convertToRestId(
    ewsItemId,
    Office.MailboxEnums.RestVersion.v2_0,
  );
}

async function getRestCallbackToken(): Promise<string> {
  return callOfficeAsync<string>((callback) =>
    Office.context.mailbox.getCallbackTokenAsync({ isRest: true }, callback),
  );
}

function getRestUrl(): string {
  const mailbox = Office.context.mailbox as Office.Mailbox & {
    restUrl?: string;
  };
  const restUrl = mailbox.restUrl;
  if (!restUrl) {
    throw new Error(
      "Office.context.mailbox.restUrl is not available — REST API not accessible",
    );
  }
  return restUrl.replace(/\/$/, "");
}

async function fetchMessage(
  restUrl: string,
  restId: string,
  token: string,
): Promise<OutlookRestMessage> {
  const url = `${restUrl}/api/v2.0/me/messages/${encodeURIComponent(restId)}?$expand=Attachments`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Outlook REST fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as OutlookRestMessage;
}

function buildBodyFile(message: OutlookRestMessage): File | null {
  const body = message.Body;
  if (!body || !body.Content) {
    return null;
  }

  const contentIsHtml = body.ContentType === "HTML";
  const date = message.ReceivedDateTime
    ? new Date(message.ReceivedDateTime)
    : null;

  return buildEmailBodyFile({
    subject: message.Subject ?? "(no subject)",
    from: toAddress(message.From),
    to: (message.ToRecipients ?? []).map(toAddress),
    cc: (message.CcRecipients ?? []).map(toAddress),
    date,
    bodyHtml: contentIsHtml ? body.Content : null,
    bodyText: contentIsHtml ? null : body.Content,
  });
}

function toAddress(
  recipient: OutlookRestRecipient | undefined,
): { name?: string; address?: string } {
  const emailAddress = recipient?.EmailAddress;
  return {
    name: emailAddress?.Name,
    address: emailAddress?.Address,
  };
}

function buildAttachmentFile(attachment: OutlookRestAttachment): File | null {
  if (attachment["@odata.type"] !== FILE_ATTACHMENT_ODATA_TYPE) {
    // itemAttachments (nested messages) and referenceAttachments (cloud
    // links) are skipped — they have no ContentBytes payload.
    return null;
  }
  if (!attachment.ContentBytes || !attachment.Name) {
    return null;
  }
  if (attachment.IsInline) {
    return null;
  }

  const buffer = decodeBase64ToBuffer(attachment.ContentBytes);
  if (!buffer) {
    return null;
  }
  return new File([buffer], attachment.Name, {
    type: attachment.ContentType ?? "application/octet-stream",
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
