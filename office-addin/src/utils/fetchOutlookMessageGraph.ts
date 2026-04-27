/**
 * Fetches a single Outlook message via Microsoft Graph and returns the raw
 * RFC822 MIME stream wrapped as a `.eml` File (`message/rfc822`). The backend
 * parses headers, body, and attachment listings server-side; attachment
 * binaries are intentionally left on the wire — the backend extracts
 * attachment filenames only, so any consumer needing attachment contents
 * should upload them separately.
 *
 * This is the Microsoft-365 / Exchange-Online path. It is the blessed
 * replacement for the legacy callback-token + Outlook REST v2.0 route
 * (preserved for on-prem in `./fetchOutlookMessageRestV2.ts`). Callers
 * provide an `acquireGraphToken` function bound to the `Mail.Read` scope via
 * MSAL NAA; see `AddinChat.tsx` for the wiring.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphMessageMetadata {
  id?: string;
  subject?: string;
  internetMessageId?: string;
}

export interface FetchOutlookMessageResult {
  subject: string;
  files: File[];
  internetMessageId: string | null;
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
  const metadata = await fetchMessageMetadataById(restId, token);
  const bytes = await fetchMessageRawMimeById(restId, token);
  const subject = metadata.subject ?? "";
  return {
    subject,
    files: [buildEmlFile(bytes, subject)],
    internetMessageId: metadata.internetMessageId ?? null,
  };
}

/**
 * Looks up a message by its RFC 5322 `Message-ID` header, returning a single
 * `.eml` File if exactly one match is found. Returns `null` when Graph's
 * filter returns an empty result (e.g. for drafts that don't yet have an
 * indexed internet message id).
 */
export async function fetchOutlookMessageFilesByInternetMessageIdViaGraph(
  internetMessageId: string,
  acquireToken: AcquireGraphToken,
): Promise<FetchOutlookMessageResult | null> {
  const token = await acquireToken();
  const match = await findMessageByInternetMessageId(internetMessageId, token);
  if (!match?.id) {
    return null;
  }
  const bytes = await fetchMessageRawMimeById(match.id, token);
  const subject = match.subject ?? "";
  return {
    subject,
    files: [buildEmlFile(bytes, subject)],
    internetMessageId: match.internetMessageId ?? internetMessageId,
  };
}

function convertEwsIdToGraphId(ewsItemId: string): string {
  const mailbox = Office.context.mailbox;
  return mailbox.convertToRestId(
    ewsItemId,
    Office.MailboxEnums.RestVersion.v2_0,
  );
}

async function fetchMessageMetadataById(
  messageId: string,
  token: string,
): Promise<GraphMessageMetadata> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=subject,internetMessageId`;
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
  return (await response.json()) as GraphMessageMetadata;
}

async function fetchMessageRawMimeById(
  messageId: string,
  token: string,
): Promise<ArrayBuffer> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/$value`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/octet-stream",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Graph MIME fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.arrayBuffer();
}

async function findMessageByInternetMessageId(
  internetMessageId: string,
  token: string,
): Promise<GraphMessageMetadata | null> {
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
  const payload = (await response.json()) as { value?: GraphMessageMetadata[] };
  const first = payload.value?.[0];
  return first ?? null;
}

function buildEmlFile(bytes: ArrayBuffer, subject: string): File {
  return new File([bytes], buildEmlFilename(subject), {
    type: "message/rfc822",
  });
}

function buildEmlFilename(subject: string): string {
  const base = subject.trim() || "message";
  const sanitized = Array.from(base)
    .map((character) => {
      if ('<>:"/\\|?*'.includes(character)) {
        return "_";
      }
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 ? "_" : character;
    })
    .join("")
    .slice(0, 100);
  return `${sanitized}.eml`;
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
