import { buildEmailBodyFile } from "./buildEmailBodyHtml";
import { buildEmlFile } from "./fetchOutlookMessageGraph";
import { callOfficeAsync } from "./officeAsync";

import type {
  ConversationFetchState,
  FetchConversationOptions,
  FetchConversationResult,
  FetchOutlookMessageBytesResult,
  FetchOutlookMessageResult,
  GraphAttachment,
  GraphBody,
  GraphConversationMessage,
  GraphRecipient,
  GraphRequestOptions,
  GraphTransport,
  ParentMessageMetadata,
} from "./fetchOutlookMessageGraph";

/**
 * Outlook REST v2.0 implementations of the message-fetch capabilities, for
 * Exchange on-premises (Subscription Edition) where Microsoft Graph does not
 * exist. Authentication is the host-issued callback token from
 * `Office.context.mailbox.getCallbackTokenAsync({ isRest: true })`, sent to
 * the mailbox's own REST endpoint (`Office.context.mailbox.restUrl`).
 *
 * Legacy Exchange Online callback tokens were shut off across all Microsoft
 * 365 tenants in October 2025 (see MS NAA FAQ on legacy tokens), so this path
 * no longer resolves for cloud mailboxes — those go through
 * `./fetchOutlookMessageGraph.ts`. The environment dispatcher lives in
 * `./fetchOutlookMessage.ts`.
 *
 * Result shapes deliberately mirror the Graph module's exported types: the
 * REST v2.0 PascalCase payloads are mapped once (see
 * `mapRestMessageToGraphShape`) onto the Graph-cased
 * `GraphConversationMessage` family so downstream consumers (`parsedThread`,
 * `parseMsgFile`, …) stay backend-agnostic. Error contracts mirror the Graph
 * functions too: bytes fetchers throw on HTTP failure, the conversation fetch
 * reports `{ state: "partial" | "error" }`, and the parent lookup returns
 * `null` rather than throwing.
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
  ContentId?: string;
}

interface OutlookRestMessage {
  Id?: string;
  InternetMessageId?: string;
  Subject?: string;
  Body?: OutlookRestBody;
  UniqueBody?: OutlookRestBody;
  From?: OutlookRestRecipient;
  ToRecipients?: OutlookRestRecipient[];
  CcRecipients?: OutlookRestRecipient[];
  SentDateTime?: string;
  ReceivedDateTime?: string;
  IsDraft?: boolean;
  HasAttachments?: boolean;
  Attachments?: OutlookRestAttachment[];
}

export interface FetchOutlookMessageBodyFilesResult {
  subject: string;
  files: File[];
}

const FILE_ATTACHMENT_ODATA_TYPE = "#Microsoft.OutlookServices.FileAttachment";
const ITEM_ATTACHMENT_ODATA_TYPE = "#Microsoft.OutlookServices.ItemAttachment";
const REFERENCE_ATTACHMENT_ODATA_TYPE =
  "#Microsoft.OutlookServices.ReferenceAttachment";

/** Graph-cased discriminators the shared `GraphConversationMessage` consumers
 * (`parsedThread.transformAttachment`) understand. */
const GRAPH_FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";
const GRAPH_ITEM_ATTACHMENT_TYPE = "#microsoft.graph.itemAttachment";
const GRAPH_REFERENCE_ATTACHMENT_TYPE = "#microsoft.graph.referenceAttachment";

/** Same paging window as the Graph conversation fetch — past the cap the
 * thread is declared `partial`. */
const MAX_CONVERSATION_PAGES = 20;
const CONVERSATION_PAGE_SIZE = 50;
/** Max simultaneous item-attachment `/$value` fetches, mirroring the Graph
 * module's throttle guard (on-prem Exchange throttles per-connection too). */
const ITEM_ENRICH_CONCURRENCY = 5;
/** Upper bound on an honored `Retry-After`, so a bad header can't hang us.
 * Mirrors the Graph module's `MAX_RETRY_AFTER_SECONDS`. */
const MAX_RETRY_AFTER_SECONDS = 10;

/**
 * LEGACY, NO CALLERS TODAY: splits a message into a rendered HTML body file
 * plus per-attachment Files instead of one `.eml`. Superseded by the raw-MIME
 * capabilities below (which feed the backend's `.eml` pipeline) but retained
 * until the on-prem rollout proves `/$value` is universally available there.
 */
export async function fetchOutlookMessageFilesViaRestV2(
  ewsItemId: string,
): Promise<FetchOutlookMessageBodyFilesResult> {
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

/**
 * Raw RFC822 MIME of a message by its EWS item id — the REST v2.0 mirror of
 * `fetchOutlookMessageBytesViaGraph` (same result shape, throws on HTTP
 * failure).
 */
export async function fetchOutlookMessageBytesViaRestV2(
  ewsItemId: string,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult> {
  const restId = convertToRestId(ewsItemId);
  const restUrl = getRestUrl();
  const tokenSource = makeRestTokenSource();
  const metadata = await fetchRestMessageMetadataById(
    restUrl,
    restId,
    tokenSource,
    options,
  );
  const bytes = await fetchRestMessageRawMimeById(
    restUrl,
    restId,
    tokenSource,
    options,
  );
  return {
    bytes,
    subject: metadata.Subject ?? "",
    internetMessageId: metadata.InternetMessageId ?? null,
  };
}

/**
 * Looks up a message by its RFC 5322 `Message-ID` header — the REST v2.0
 * mirror of `fetchOutlookMessageFilesByInternetMessageIdViaGraph`, including
 * its not-found semantics: `null` when the filter yields no match, a thrown
 * error when the lookup itself fails.
 */
export async function fetchOutlookMessageFilesByInternetMessageIdViaRestV2(
  internetMessageId: string,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageResult | null> {
  const result = await fetchOutlookMessageBytesByInternetMessageIdViaRestV2(
    internetMessageId,
    options,
  );
  if (!result) {
    return null;
  }
  return {
    subject: result.subject,
    files: [buildEmlFile(result.bytes, result.subject)],
    internetMessageId: result.internetMessageId,
  };
}

export async function fetchOutlookMessageBytesByInternetMessageIdViaRestV2(
  internetMessageId: string,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult | null> {
  const restUrl = getRestUrl();
  const tokenSource = makeRestTokenSource();
  const match = await findRestMessageByInternetMessageId(
    restUrl,
    internetMessageId,
    tokenSource,
    options,
  );
  if (!match?.Id) {
    return null;
  }
  const bytes = await fetchRestMessageRawMimeById(
    restUrl,
    match.Id,
    tokenSource,
    options,
  );
  return {
    bytes,
    subject: match.Subject ?? "",
    internetMessageId: match.InternetMessageId ?? internetMessageId,
  };
}

/**
 * Latest non-draft message in a conversation — the REST v2.0 mirror of
 * `fetchParentMessageInConversationViaGraph`: single-clause filter, no
 * `$orderby` (Exchange's REST inherits the same restriction on combining
 * `$orderby` with an unrelated `$filter`), latest non-draft picked
 * client-side. Returns `null` on a miss or ANY failure — the reply-context
 * chip quietly does without it.
 */
export async function fetchParentMessageInConversationViaRestV2(
  conversationId: string,
  options: GraphRequestOptions = {},
): Promise<ParentMessageMetadata | null> {
  try {
    const restUrl = getRestUrl();
    const tokenSource = makeRestTokenSource();
    const filter = `ConversationId eq '${escapeODataString(conversationId)}'`;
    const url = `${restUrl}/v2.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=20&$select=Id,Subject,From,ReceivedDateTime,IsDraft`;
    const response = await restFetch(
      url,
      tokenSource,
      "application/json",
      options.signal,
    );
    if (!response.ok) {
      console.warn(
        "[fetchParentMessageInConversationViaRestV2] non-OK status:",
        response.status,
        response.statusText,
      );
      return null;
    }
    const payload = (await response.json()) as {
      value?: OutlookRestMessage[];
    };
    const latest = (payload.value ?? [])
      .filter((message) => message.IsDraft !== true)
      .sort((a, b) =>
        (b.ReceivedDateTime ?? "").localeCompare(a.ReceivedDateTime ?? ""),
      )[0];
    if (!latest) {
      return null;
    }
    return {
      subject: latest.Subject ?? "",
      fromName: latest.From?.EmailAddress?.Name ?? null,
      fromAddress: latest.From?.EmailAddress?.Address ?? null,
    };
  } catch (error) {
    console.warn("[fetchParentMessageInConversationViaRestV2] failed:", error);
    return null;
  }
}

/**
 * Every non-draft message in a conversation — the REST v2.0 mirror of
 * `fetchConversationMessagesViaGraph`, including the `{ messages, state }`
 * contract (`error` only when the very first page fails, `partial` past the
 * page cap or on a later-page failure). NEVER throws (other than abort
 * propagation): an on-prem server that rejects the `$filter` surfaces as
 * `state: "error"`, not a crash.
 *
 * Unlike Graph there is no derived-type `$select` for attachments: a plain
 * `$expand=Attachments` already serializes `ContentBytes`/`ContentId` on
 * FileAttachment rows, so the nested-$select workaround the Graph module
 * needs does not apply here.
 */
export async function fetchConversationMessagesViaRestV2(
  conversationId: string,
  options: FetchConversationOptions = {},
): Promise<FetchConversationResult> {
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);

  let restUrl: string;
  try {
    restUrl = getRestUrl();
  } catch (error) {
    console.warn("[fetchConversationMessagesViaRestV2] no restUrl:", error);
    return { messages: [], state: "error" };
  }
  const tokenSource = makeRestTokenSource();

  const filter = `ConversationId eq '${escapeODataString(conversationId)}'`;
  const select = [
    "Id",
    "InternetMessageId",
    "Subject",
    "From",
    "ToRecipients",
    "CcRecipients",
    "SentDateTime",
    "ReceivedDateTime",
    "Body",
    "UniqueBody",
    "IsDraft",
    "HasAttachments",
  ].join(",");

  const raw: OutlookRestMessage[] = [];
  let nextUrl: string | null =
    `${restUrl}/v2.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=${CONVERSATION_PAGE_SIZE}&$select=${select}&$expand=Attachments`;
  let pages = 0;
  let state: ConversationFetchState = "ok";

  while (nextUrl && pages < MAX_CONVERSATION_PAGES) {
    let response: Response;
    try {
      response = await restFetch(
        nextUrl,
        tokenSource,
        "application/json",
        options.signal,
        transport,
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? error;
      }
      console.warn("[fetchConversationMessagesViaRestV2] fetch failed:", error);
      state = pages === 0 ? "error" : "partial";
      break;
    }
    if (!response.ok) {
      console.warn(
        "[fetchConversationMessagesViaRestV2] non-OK status:",
        response.status,
        response.statusText,
      );
      state = pages === 0 ? "error" : "partial";
      break;
    }
    let payload: {
      value?: OutlookRestMessage[];
      "@odata.nextLink"?: string;
    };
    try {
      payload = await response.json();
    } catch (error) {
      console.warn(
        "[fetchConversationMessagesViaRestV2] JSON parse failed:",
        error,
      );
      state = pages === 0 ? "error" : "partial";
      break;
    }
    raw.push(...(payload.value ?? []));
    nextUrl = payload["@odata.nextLink"] ?? null;
    pages += 1;
  }
  // More pages remained but we stopped at the cap → the window is incomplete.
  if (nextUrl && state === "ok") {
    state = "partial";
  }

  const messages = raw.map(mapRestMessageToGraphShape);

  // Best-effort itemAttachment bytes, mirroring the Graph module. Failures —
  // including an on-prem server that doesn't support attachment `/$value` at
  // all — leave the attachment byte-less, to be disclosed as a marker by
  // `parsedThread.transformAttachment` rather than silently dropped.
  if (messages.length > 0) {
    await enrichRestItemAttachments(
      messages,
      restUrl,
      tokenSource,
      transport,
      options.signal,
    );
  }

  return { messages, state };
}

/**
 * The single REST→Graph casing adapter: every downstream consumer speaks the
 * Graph-cased `GraphConversationMessage` family, so PascalCase REST payloads
 * are mapped here once instead of forking the shared types per backend.
 */
function mapRestMessageToGraphShape(
  message: OutlookRestMessage,
): GraphConversationMessage {
  return {
    id: message.Id,
    internetMessageId: message.InternetMessageId,
    subject: message.Subject,
    from: message.From ? mapRestRecipient(message.From) : undefined,
    toRecipients: message.ToRecipients?.map(mapRestRecipient),
    ccRecipients: message.CcRecipients?.map(mapRestRecipient),
    sentDateTime: message.SentDateTime,
    receivedDateTime: message.ReceivedDateTime,
    body: mapRestBody(message.Body),
    uniqueBody: mapRestBody(message.UniqueBody),
    isDraft: message.IsDraft,
    hasAttachments: message.HasAttachments,
    attachments: message.Attachments?.map(mapRestAttachment),
  };
}

function mapRestRecipient(recipient: OutlookRestRecipient): GraphRecipient {
  return {
    emailAddress: recipient.EmailAddress
      ? {
          name: recipient.EmailAddress.Name,
          address: recipient.EmailAddress.Address,
        }
      : undefined,
  };
}

function mapRestBody(body: OutlookRestBody | undefined): GraphBody | undefined {
  if (!body) {
    return undefined;
  }
  return {
    contentType:
      body.ContentType === "HTML"
        ? "html"
        : body.ContentType === "Text"
          ? "text"
          : undefined,
    content: body.Content,
  };
}

function mapRestAttachment(attachment: OutlookRestAttachment): GraphAttachment {
  return {
    "@odata.type": mapRestAttachmentType(attachment["@odata.type"]),
    id: attachment.Id,
    name: attachment.Name,
    contentType: attachment.ContentType,
    size: attachment.Size,
    isInline: attachment.IsInline,
    contentBytes: attachment.ContentBytes,
    contentId: attachment.ContentId,
  };
}

/** Unknown subtypes pass through unmapped so `transformAttachment` falls into
 * its "unsupported type" disclosure branch rather than mislabeling them. */
function mapRestAttachmentType(
  odataType: string | undefined,
): string | undefined {
  switch (odataType) {
    case FILE_ATTACHMENT_ODATA_TYPE:
      return GRAPH_FILE_ATTACHMENT_TYPE;
    case ITEM_ATTACHMENT_ODATA_TYPE:
      return GRAPH_ITEM_ATTACHMENT_TYPE;
    case REFERENCE_ATTACHMENT_ODATA_TYPE:
      return GRAPH_REFERENCE_ATTACHMENT_TYPE;
    default:
      return odataType;
  }
}

async function enrichRestItemAttachments(
  messages: GraphConversationMessage[],
  restUrl: string,
  tokenSource: RestTokenSource,
  transport: GraphTransport,
  signal: AbortSignal | undefined,
): Promise<void> {
  const tasks: Array<() => Promise<void>> = [];
  for (const message of messages) {
    const messageId = message.id;
    if (!messageId || !message.attachments) continue;
    for (const attachment of message.attachments) {
      if (attachment["@odata.type"] !== GRAPH_ITEM_ATTACHMENT_TYPE) continue;
      if (attachment.contentBytes || !attachment.id) continue;
      const attachmentId = attachment.id;
      tasks.push(() =>
        enrichOneRestItemAttachment(
          messageId,
          attachmentId,
          attachment,
          restUrl,
          tokenSource,
          transport,
          signal,
        ),
      );
    }
  }
  await runWithConcurrency(tasks, ITEM_ENRICH_CONCURRENCY);
}

async function enrichOneRestItemAttachment(
  messageId: string,
  attachmentId: string,
  attachment: GraphAttachment,
  restUrl: string,
  tokenSource: RestTokenSource,
  transport: GraphTransport,
  signal: AbortSignal | undefined,
): Promise<void> {
  const url = `${restUrl}/v2.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
  try {
    let response = await restFetch(
      url,
      tokenSource,
      "application/octet-stream",
      signal,
      transport,
    );
    // Honor a single Retry-After on throttle before giving up to a marker,
    // mirroring the Graph module's enrichOneItemAttachment.
    if (response.status === 429) {
      const retryMs = retryAfterMs(response);
      if (retryMs !== null) {
        await sleep(retryMs, signal);
        response = await restFetch(
          url,
          tokenSource,
          "application/octet-stream",
          signal,
          transport,
        );
      }
    }
    if (!response.ok) return;
    const buffer = await response.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) return;
    attachment.contentBytes = arrayBufferToBase64(buffer);
    if (!attachment.contentType) {
      attachment.contentType = "message/rfc822";
    }
    if (!attachment.name) {
      attachment.name = "attached-item.eml";
    }
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    console.warn(
      "[fetchConversationMessagesViaRestV2] item $value fetch failed:",
      error,
    );
  }
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

/** `restUrl` already names the REST root including the `/api` segment (e.g.
 * `https://exchange.contoso.com/api`); callers append only `/v2.0/…`. */
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

/**
 * Caches one callback token across all requests of a single operation
 * (callback tokens are mailbox-scoped — there is nothing to vary per request)
 * while coalescing concurrent 401-driven re-acquisitions onto a single
 * `getCallbackTokenAsync` round-trip. The REST analogue of the Graph module's
 * token source.
 */
interface RestTokenSource {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

function makeRestTokenSource(): RestTokenSource {
  let cached: Promise<string> | null = null;
  let pendingRefresh: Promise<string> | null = null;

  const run = (refresh: boolean): Promise<string> => {
    const promise = getRestCallbackToken();
    cached = promise;
    if (refresh) {
      pendingRefresh = promise;
    }
    void promise.then(
      () => {
        if (pendingRefresh === promise) pendingRefresh = null;
      },
      () => {
        // Never cache a rejected promise — clear so the next caller
        // re-attempts instead of being served the poisoned failure forever.
        if (cached === promise) cached = null;
        if (pendingRefresh === promise) pendingRefresh = null;
      },
    );
    return promise;
  };

  return {
    get() {
      return cached ?? run(false);
    },
    refresh() {
      return pendingRefresh ?? run(true);
    },
  };
}

/**
 * Issues a REST request with the operation's cached callback token and, on a
 * 401 (callback tokens live ~5 minutes and can expire mid-operation),
 * re-acquires the token and retries exactly once — mirroring the Graph
 * module's `graphFetch` recovery contract.
 */
async function restFetch(
  url: string,
  tokenSource: RestTokenSource,
  accept: string,
  signal: AbortSignal | undefined,
  transport: GraphTransport = globalThis.fetch.bind(globalThis),
): Promise<Response> {
  const request = (token: string) =>
    transport(url, {
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: accept },
    });
  const response = await request(await tokenSource.get());
  if (response.status !== 401) {
    return response;
  }
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return request(await tokenSource.refresh());
}

async function fetchRestMessageMetadataById(
  restUrl: string,
  messageId: string,
  tokenSource: RestTokenSource,
  options: GraphRequestOptions = {},
): Promise<OutlookRestMessage> {
  const url = `${restUrl}/v2.0/me/messages/${encodeURIComponent(messageId)}?$select=Subject,InternetMessageId`;
  const response = await restFetch(
    url,
    tokenSource,
    "application/json",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Outlook REST fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as OutlookRestMessage;
}

async function fetchRestMessageRawMimeById(
  restUrl: string,
  messageId: string,
  tokenSource: RestTokenSource,
  options: GraphRequestOptions = {},
): Promise<ArrayBuffer> {
  const url = `${restUrl}/v2.0/me/messages/${encodeURIComponent(messageId)}/$value`;
  const response = await restFetch(
    url,
    tokenSource,
    "application/octet-stream",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Outlook REST MIME fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.arrayBuffer();
}

async function findRestMessageByInternetMessageId(
  restUrl: string,
  internetMessageId: string,
  tokenSource: RestTokenSource,
  options: GraphRequestOptions = {},
): Promise<OutlookRestMessage | null> {
  const filter = `InternetMessageId eq '${escapeODataString(internetMessageId)}'`;
  const url = `${restUrl}/v2.0/me/messages?$filter=${encodeURIComponent(filter)}&$top=1&$select=Id,Subject,InternetMessageId`;
  const response = await restFetch(
    url,
    tokenSource,
    "application/json",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Outlook REST lookup failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as { value?: OutlookRestMessage[] };
  return payload.value?.[0] ?? null;
}

async function fetchMessage(
  restUrl: string,
  restId: string,
  token: string,
): Promise<OutlookRestMessage> {
  const url = `${restUrl}/v2.0/me/messages/${encodeURIComponent(restId)}?$expand=Attachments`;
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

function toAddress(recipient: OutlookRestRecipient | undefined): {
  name?: string;
  address?: string;
} {
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

/** Run thunks with at most `limit` in flight at once. Each thunk is expected
 * to swallow its own errors (these do), so the pool never rejects. */
async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (cursor < tasks.length) {
        const index = cursor;
        cursor += 1;
        await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

/** Parse a `Retry-After` (delta-seconds) header into a clamped ms delay, or
 * null when absent/unparseable. Clamped so a hostile header can't stall us.
 * Replicated from the Graph module (its helper is private). */
function retryAfterMs(response: Response): number | null {
  const header = response.headers?.get?.("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);

    const handleAbort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

function escapeODataString(value: string): string {
  return value.replace(/'/g, "''");
}
