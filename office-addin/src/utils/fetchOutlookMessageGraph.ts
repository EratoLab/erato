/**
 * Fetches a single Outlook message via Microsoft Graph and returns the raw
 * RFC822 MIME stream wrapped as a `.eml` File (`message/rfc822`). The backend
 * parses headers, body, and attachment listings server-side; attachment
 * binaries are intentionally left on the wire — the backend extracts
 * attachment filenames only, so any consumer needing attachment contents
 * should upload them separately.
 *
 * This is the Microsoft-365 / Exchange-Online path. It is the blessed
 * replacement for the legacy callback-token + Outlook REST v2.0 route (shut
 * off for Microsoft 365 tenants in October 2025); on-prem mailboxes use the
 * EWS SOAP backend in `./fetchOutlookMessageEws.ts` instead. Callers
 * provide an `acquireGraphToken` function bound to the `Mail.Read` scope via
 * MSAL NAA; see `AddinChat.tsx` for the wiring.
 */

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

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

export interface FetchOutlookMessageBytesResult {
  bytes: ArrayBuffer;
  subject: string;
  internetMessageId: string | null;
}

export type AcquireGraphToken = (options?: {
  forceRefresh?: boolean;
}) => Promise<string>;

export interface GraphRequestOptions {
  signal?: AbortSignal;
}

/**
 * Fetches a message by its EWS item id. The id is converted to the Graph-
 * compatible REST id via `Office.context.mailbox.convertToRestId` before the
 * HTTP call.
 */
export async function fetchOutlookMessageFilesViaGraph(
  ewsItemId: string,
  acquireToken: AcquireGraphToken,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageResult> {
  const { bytes, subject, internetMessageId } =
    await fetchOutlookMessageBytesViaGraph(ewsItemId, acquireToken, options);
  return {
    subject,
    files: [buildEmlFile(bytes, subject)],
    internetMessageId,
  };
}

export async function fetchOutlookMessageBytesViaGraph(
  ewsItemId: string,
  acquireToken: AcquireGraphToken,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult> {
  const restId = convertEwsIdToGraphId(ewsItemId);
  const tokenSource = makeGraphTokenSource(acquireToken);
  const metadata = await fetchMessageMetadataById(restId, tokenSource, options);
  const bytes = await fetchMessageRawMimeById(restId, tokenSource, options);
  return {
    bytes,
    subject: metadata.subject ?? "",
    internetMessageId: metadata.internetMessageId ?? null,
  };
}

/**
 * Looks up the most recent non-draft message in a conversation thread —
 * i.e. the message a user is replying to / forwarding when their compose
 * window has a `conversationId` but no `itemId` (drafts aren't indexed by
 * Graph). Used by the add-in's "reply context" preview chip.
 *
 * Returns just the metadata needed to render the chip (subject + sender);
 * deliberately does *not* fetch the body. The body is already present in
 * the user's draft via Outlook's auto-quote and reaches the LLM via
 * `outlook_review_draft.full_body` — fetching it again here would double
 * the token cost.
 *
 * Returns `null` when the conversation has no indexed messages (a brand-
 * new outbound thread, for example) or when Graph errors out.
 */
export interface ParentMessageMetadata {
  subject: string;
  fromName: string | null;
  fromAddress: string | null;
}

export async function fetchParentMessageInConversationViaGraph(
  conversationId: string,
  acquireToken: AcquireGraphToken,
  options: GraphRequestOptions = {},
): Promise<ParentMessageMetadata | null> {
  try {
    const tokenSource = makeGraphTokenSource(acquireToken);
    // Single-clause filter on an indexed property + no `$orderby`. Adding
    // `and isDraft eq false` plus `$orderby=receivedDateTime desc` trips
    // Graph's `InefficientFilter` constraint: properties in `$orderby` must
    // also appear in `$filter`, in the same order, before non-orderby
    // properties.
    // We instead pull the most recent ~thread-worth of messages and pick
    // the latest non-draft client-side.
    const filter = `conversationId eq '${escapeODataString(conversationId)}'`;
    const url = `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$top=20&$select=id,subject,from,receivedDateTime,isDraft`;
    const response = await graphFetch(
      url,
      tokenSource,
      "application/json",
      options.signal,
    );
    if (!response.ok) {
      console.warn(
        "[fetchParentMessageInConversationViaGraph] non-OK status:",
        response.status,
        response.statusText,
      );
      return null;
    }
    const payload = (await response.json()) as {
      value?: Array<{
        subject?: string;
        receivedDateTime?: string;
        isDraft?: boolean;
        from?: {
          emailAddress?: { name?: string; address?: string };
        };
      }>;
    };
    const candidates = payload.value ?? [];
    // Drop drafts; sort by receivedDateTime desc; take the latest. We
    // don't need to be defensive about missing receivedDateTime — Exchange
    // populates it for any indexed message.
    const latest = candidates
      .filter((message) => message.isDraft !== true)
      .sort((a, b) =>
        (b.receivedDateTime ?? "").localeCompare(a.receivedDateTime ?? ""),
      )[0];
    if (!latest) {
      return null;
    }
    return {
      subject: latest.subject ?? "",
      fromName: latest.from?.emailAddress?.name ?? null,
      fromAddress: latest.from?.emailAddress?.address ?? null,
    };
  } catch (error) {
    console.warn("[fetchParentMessageInConversationViaGraph] failed:", error);
    return null;
  }
}

/**
 * Fetches every non-draft message in a conversation thread, with each
 * message's `fileAttachment` bytes expanded inline. Paginates `@odata.nextLink`
 * up to `MAX_CONVERSATION_PAGES` (declaring the thread `partial` past the cap),
 * then enriches any `itemAttachment` bytes via bounded-concurrency `/$value`
 * fetches (see `enrichItemAttachments`) to stay under Graph's throttle.
 *
 * `uniqueBody` is included alongside `body`: the former contains only the
 * portion of the body unique to that message (Graph strips prior quoted
 * history), the latter the message as it would render in Outlook. We carry
 * BOTH and let `parsedThread.chooseBody` decide — defaulting to the full
 * `body` so forwarded content (whose `uniqueBody` is often just a signature)
 * is never lost; see `parsedThread.ts`.
 *
 * Attachments returned here are typed loosely: `fileAttachment` carries
 * `contentBytes` (base64), `itemAttachment` is a nested message/item whose
 * bytes we fetch best-effort via `/$value` (see `enrichItemAttachments`),
 * and `referenceAttachment` is a cloud pointer with no inline bytes. Callers
 * discriminate on the `@odata.type` discriminator; nothing is silently dropped.
 */
export interface GraphRecipient {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphBody {
  contentType?: "html" | "text";
  content?: string;
}

export interface GraphAttachment {
  "@odata.type"?: string;
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  contentId?: string;
}

export interface GraphConversationMessage {
  id?: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  sentDateTime?: string;
  receivedDateTime?: string;
  body?: GraphBody;
  uniqueBody?: GraphBody;
  isDraft?: boolean;
  hasAttachments?: boolean;
  attachments?: GraphAttachment[];
}

/**
 * Optional transport — defaults to global `fetch`. Tests inject a stub so
 * they don't have to `vi.stubGlobal` and assert on call ordering.
 */
export type GraphTransport = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export interface FetchConversationOptions {
  transport?: GraphTransport;
  signal?: AbortSignal;
}

/**
 * Outcome of a conversation fetch — distinguishes the three cases the caller
 * must treat differently (a bare `[]` conflates them):
 *   - `ok`      — every page fetched successfully.
 *   - `partial` — at least one page succeeded but a later page failed or the
 *                 hard page cap was hit. Some messages may be missing; the
 *                 caller should mark the thread incomplete.
 *   - `error`   — the very first page failed; `messages` is empty and the
 *                 caller must surface a load error rather than silently
 *                 producing "no thread".
 */
export type ConversationFetchState = "ok" | "partial" | "error";

export interface FetchConversationResult {
  messages: GraphConversationMessage[];
  state: ConversationFetchState;
}

const ITEM_ATTACHMENT_TYPE = "#microsoft.graph.itemAttachment";
/** Graph paginates at server discretion; follow `@odata.nextLink` up to this
 * many pages (50 × 20 = 1000 messages) before declaring the thread partial. */
const MAX_CONVERSATION_PAGES = 20;
const CONVERSATION_PAGE_SIZE = 50;
/** Max simultaneous item-attachment `/$value` fetches (Graph throttle guard). */
const ITEM_ENRICH_CONCURRENCY = 5;
/** Upper bound on an honored `Retry-After`, so a bad header can't hang us. */
const MAX_RETRY_AFTER_SECONDS = 10;

export async function fetchConversationMessagesViaGraph(
  conversationId: string,
  acquireToken: AcquireGraphToken,
  options: FetchConversationOptions = {},
): Promise<FetchConversationResult> {
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);
  const tokenSource = makeGraphTokenSource(acquireToken);

  const filter = `conversationId eq '${escapeODataString(conversationId)}'`;
  const select = [
    "id",
    "internetMessageId",
    "subject",
    "from",
    "toRecipients",
    "ccRecipients",
    "sentDateTime",
    "receivedDateTime",
    "body",
    "uniqueBody",
    "isDraft",
    "hasAttachments",
  ].join(",");
  // Both `contentBytes` AND `contentId` live only on the
  // `microsoft.graph.fileAttachment` subtype — the polymorphic
  // `attachment` base type defines just `id`, `name`, `contentType`,
  // `size`, `isInline`, and `lastModifiedDateTime`. Selecting either
  // unqualified trips `BadRequest: Could not find a property named '…'
  // on type 'microsoft.graph.attachment'`. OData's derived-type-property
  // syntax `<namespace.subtype>/<property>` projects the field only when
  // the row materializes as that subtype; itemAttachment and
  // referenceAttachment items still come back (without those fields), so
  // callers can discriminate on `@odata.type` and skip non-file rows.
  const attachmentSelect = [
    "id",
    "name",
    "contentType",
    "size",
    "isInline",
    "microsoft.graph.fileAttachment/contentId",
    "microsoft.graph.fileAttachment/contentBytes",
  ].join(",");
  const expand = `attachments($select=${attachmentSelect})`;

  const messages: GraphConversationMessage[] = [];
  let nextUrl: string | null =
    `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$top=${CONVERSATION_PAGE_SIZE}&$select=${select}&$expand=${expand}`;
  let pages = 0;
  let state: ConversationFetchState = "ok";

  while (nextUrl && pages < MAX_CONVERSATION_PAGES) {
    let response: Response;
    try {
      response = await graphFetch(
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
      console.warn("[fetchConversationMessagesViaGraph] fetch failed:", error);
      state = pages === 0 ? "error" : "partial";
      break;
    }
    if (!response.ok) {
      console.warn(
        "[fetchConversationMessagesViaGraph] non-OK status:",
        response.status,
        response.statusText,
      );
      state = pages === 0 ? "error" : "partial";
      break;
    }
    let payload: {
      value?: GraphConversationMessage[];
      "@odata.nextLink"?: string;
    };
    try {
      payload = await response.json();
    } catch (error) {
      console.warn(
        "[fetchConversationMessagesViaGraph] JSON parse failed:",
        error,
      );
      state = pages === 0 ? "error" : "partial";
      break;
    }
    messages.push(...(payload.value ?? []));
    nextUrl = payload["@odata.nextLink"] ?? null;
    pages += 1;
  }
  // More pages remained but we stopped at the cap → the window is incomplete.
  if (nextUrl && state === "ok") {
    state = "partial";
  }

  // Best-effort: pull the bytes of any itemAttachment (forwarded .msg/.eml)
  // so its content reaches the LLM. Failures degrade to a disclosure marker
  // downstream (parsedThread.transformAttachment), never a silent drop.
  if (messages.length > 0) {
    await enrichItemAttachments(
      messages,
      tokenSource,
      transport,
      options.signal,
    );
  }

  return { messages, state };
}

/**
 * For every `itemAttachment` lacking inline bytes, fetch the item as raw MIME
 * via `/messages/{id}/attachments/{attId}/$value` and splice the base64 onto
 * the attachment's `contentBytes` so the existing fileAttachment decode path
 * picks it up. Each fetch is independently guarded — one failure (or a
 * transport that doesn't implement `arrayBuffer`) leaves that attachment
 * byte-less, to be disclosed as a marker rather than dropped.
 */
async function enrichItemAttachments(
  messages: GraphConversationMessage[],
  tokenSource: GraphTokenSource,
  transport: GraphTransport,
  signal: AbortSignal | undefined,
): Promise<void> {
  const tasks: Array<() => Promise<void>> = [];
  for (const message of messages) {
    const messageId = message.id;
    if (!messageId || !message.attachments) continue;
    for (const attachment of message.attachments) {
      if (attachment["@odata.type"] !== ITEM_ATTACHMENT_TYPE) continue;
      if (attachment.contentBytes || !attachment.id) continue;
      const attachmentId = attachment.id;
      tasks.push(() =>
        enrichOneItemAttachment(
          messageId,
          attachmentId,
          attachment,
          tokenSource,
          transport,
          signal,
        ),
      );
    }
  }
  // Bounded fan-out: a thread that forwarded many items would otherwise fire
  // one /$value GET per item simultaneously and trip Graph's per-app throttle.
  await runWithConcurrency(tasks, ITEM_ENRICH_CONCURRENCY);
}

async function enrichOneItemAttachment(
  messageId: string,
  attachmentId: string,
  attachment: GraphAttachment,
  tokenSource: GraphTokenSource,
  transport: GraphTransport,
  signal: AbortSignal | undefined,
): Promise<void> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
  try {
    let response = await graphFetch(
      url,
      tokenSource,
      "application/octet-stream",
      signal,
      transport,
    );
    // Honor a single Retry-After on throttle before giving up to a marker.
    if (response.status === 429) {
      const retryMs = retryAfterMs(response);
      if (retryMs !== null) {
        await sleep(retryMs, signal);
        response = await graphFetch(
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
    console.warn("[enrichItemAttachments] item $value fetch failed:", error);
  }
}

/** Run thunks with at most `limit` in flight at once. Each thunk is expected to
 * swallow its own errors (these do), so the pool never rejects. */
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

/** Parse a `Retry-After` (delta-seconds) header into a clamped ms delay, or
 * null when absent/unparseable. Clamped so a hostile header can't stall us. */
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

/**
 * Looks up a message by its RFC 5322 `Message-ID` header, returning a single
 * `.eml` File if exactly one match is found. Returns `null` when Graph's
 * filter returns an empty result (e.g. for drafts that don't yet have an
 * indexed internet message id).
 */
export async function fetchOutlookMessageFilesByInternetMessageIdViaGraph(
  internetMessageId: string,
  acquireToken: AcquireGraphToken,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageResult | null> {
  const result = await fetchOutlookMessageBytesByInternetMessageIdViaGraph(
    internetMessageId,
    acquireToken,
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

export async function fetchOutlookMessageBytesByInternetMessageIdViaGraph(
  internetMessageId: string,
  acquireToken: AcquireGraphToken,
  options: GraphRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult | null> {
  const tokenSource = makeGraphTokenSource(acquireToken);
  const match = await findMessageByInternetMessageId(
    internetMessageId,
    tokenSource,
    options,
  );
  if (!match?.id) {
    return null;
  }
  const bytes = await fetchMessageRawMimeById(match.id, tokenSource, options);
  return {
    bytes,
    subject: match.subject ?? "",
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

/**
 * Caches one Mail.Read token across all requests of a single operation (so a
 * multi-request fetch still acquires only once) while allowing a forced refresh
 * when a request comes back 401.
 */
export interface GraphTokenSource {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

export function makeGraphTokenSource(
  acquireToken: AcquireGraphToken,
): GraphTokenSource {
  // The current in-flight/resolved token promise, and the in-flight FORCED
  // acquire (if any). A forced acquire is tracked separately so a burst of
  // concurrent 401-driven refresh() calls (e.g. the bounded itemAttachment
  // enrichment fan-out) coalesces onto ONE force-refresh instead of firing N.
  let cached: Promise<string> | null = null;
  let pendingForce: Promise<string> | null = null;

  const run = (force: boolean): Promise<string> => {
    const promise = acquireToken(force ? { forceRefresh: true } : undefined);
    cached = promise;
    if (force) {
      pendingForce = promise;
    }
    void promise.then(
      () => {
        if (pendingForce === promise) pendingForce = null;
      },
      () => {
        // Never cache a rejected promise — clear so the next caller re-attempts
        // instead of being served the poisoned failure forever.
        if (cached === promise) cached = null;
        if (pendingForce === promise) pendingForce = null;
      },
    );
    return promise;
  };

  return {
    get() {
      return cached ?? run(false);
    },
    refresh() {
      return pendingForce ?? run(true);
    },
  };
}

/**
 * Issues a Graph request with the operation's cached Mail.Read token and, on a
 * 401 (token revoked / CAE-invalidated even though MSAL returned it from cache),
 * force-refreshes the token and retries exactly once. The add-in-side analogue
 * of the session `recoverAuth`, scoped to the Graph token — a separate cache
 * from the proxy-session bootstrap token, hence handled here rather than via the
 * shared recovery handler. `init` opts a non-GET request (method/body/extra
 * headers) into the same retry semantics; Authorization/Accept stay owned here.
 */
export async function graphFetch(
  url: string,
  tokenSource: GraphTokenSource,
  accept: string,
  signal: AbortSignal | undefined,
  transport: GraphTransport = globalThis.fetch.bind(globalThis),
  init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const request = (token: string) =>
    transport(url, {
      ...init,
      signal,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
        Accept: accept,
      },
    });
  const response = await request(await tokenSource.get());
  if (response.status !== 401) {
    return response;
  }
  // Don't waste a force-refresh + replay if the caller already aborted in the
  // window between the 401 and the retry (matches the abort checks elsewhere).
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return request(await tokenSource.refresh());
}

async function fetchMessageMetadataById(
  messageId: string,
  tokenSource: GraphTokenSource,
  options: GraphRequestOptions = {},
): Promise<GraphMessageMetadata> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}?$select=subject,internetMessageId`;
  const response = await graphFetch(
    url,
    tokenSource,
    "application/json",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Graph fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as GraphMessageMetadata;
}

async function fetchMessageRawMimeById(
  messageId: string,
  tokenSource: GraphTokenSource,
  options: GraphRequestOptions = {},
): Promise<ArrayBuffer> {
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/$value`;
  const response = await graphFetch(
    url,
    tokenSource,
    "application/octet-stream",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Graph MIME fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  return await response.arrayBuffer();
}

async function findMessageByInternetMessageId(
  internetMessageId: string,
  tokenSource: GraphTokenSource,
  options: GraphRequestOptions = {},
): Promise<GraphMessageMetadata | null> {
  const filter = `internetMessageId eq '${escapeODataString(internetMessageId)}'`;
  const url = `${GRAPH_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$top=1&$select=id,subject,internetMessageId`;
  const response = await graphFetch(
    url,
    tokenSource,
    "application/json",
    options.signal,
  );
  if (!response.ok) {
    throw new Error(
      `Graph lookup failed: ${response.status} ${response.statusText}`,
    );
  }
  const payload = (await response.json()) as { value?: GraphMessageMetadata[] };
  const first = payload.value?.[0];
  return first ?? null;
}

/** Exported for the EWS sibling so both backends produce identically
 * named/typed `.eml` Files for the same message. */
export function buildEmlFile(bytes: ArrayBuffer, subject: string): File {
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
