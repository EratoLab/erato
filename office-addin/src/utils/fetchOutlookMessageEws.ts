import PostalMime from "postal-mime";

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
import type { Attachment as MimeAttachment } from "postal-mime";

/**
 * HYBRID EWS SOAP implementations of the message-fetch capabilities, for
 * Exchange on-premises / Subscription Edition where Microsoft Graph does not
 * exist. This is the wired on-prem backend; the Outlook REST v2.0 sibling
 * (`./fetchOutlookMessageRestV2.ts`) is retained as a dormant fallback.
 *
 * TWO TRANSPORTS, routed by what the credential authorizes (proven empirically
 * against a live SE box):
 *
 * 1. DIRECT / PROXY ({@link ewsFetch}) — POSTs the SOAP to a same-origin Erato
 *    endpoint ({@link EWS_PROXY_PATH}) carrying the host-issued
 *    `getCallbackTokenAsync({ isRest: false })` callback token. That callback
 *    token is ITEM-SCOPED: its appctx authorizes EWS operations on the CURRENTLY
 *    SELECTED item only (`ParentItemId:<current item>`). GetItem on the current
 *    item (MimeContent or full body) returns 200; mailbox/conversation-wide
 *    operations (GetConversationItems, FindItem) return 500 ErrorAccessDenied —
 *    the token simply does not authorize them. UPSIDE: no response size cap, so
 *    the current item's full MIME comes back whole. We use this path ONLY for
 *    the current item (the id the caller already holds).
 *
 * 2. HOST-BROKERED ({@link ewsHostFetch}) — `Office.context.mailbox.
 *    makeEwsRequestAsync`. The host authenticates with the user's FULL mailbox
 *    credentials (the manifest declares ReadWriteMailbox, requirement set 1.1 is
 *    available on SE), so this path can enumerate the conversation and read
 *    SIBLING messages the callback token can't reach. DOWNSIDE: a hard RESPONSE
 *    cap (5 MB in OWA / 1 MB in classic Outlook; Office.js error code 9020 /
 *    "Response exceeds N MB size limit"); a sibling whose response overflows it
 *    degrades to a body-less disclosure marker. SECOND DOWNSIDE: makeEwsRequestAsync
 *    only permits a fixed OPERATION allow-list (GetItem/FindItem/
 *    GetConversationItems/… — but NOT GetAttachment), so attachment bytes cannot
 *    be fetched with GetAttachment via the host (it answers "the requested web
 *    method is unavailable to this caller or application"); we get them from the
 *    owning message's MIME instead (see ATTACHMENT BYTES below). NOTE: whether
 *    makeEwsRequestAsync actually has broad access on a given SE box is host/
 *    admin-configured (OAuthAuthentication + ReadWriteMailbox); if it is also
 *    restricted, GetConversationItems surfaces ErrorAccessDenied and the
 *    conversation fetch degrades to `state: "error"` rather than crashing.
 *
 * ATTACHMENT BYTES: GetItem's attachment listing is METADATA-only (no bytes for
 * either FileAttachment or ItemAttachment), and GetAttachment is NOT available
 * through the host transport (see above). So bytes come from the OWNING MESSAGE's
 * full RFC822 MIME: GetItem with `IncludeMimeContent` returns the message MIME,
 * which carries every attachment (file AND nested-item) inline; we parse it with
 * postal-mime and splice each matched part's bytes onto the GraphAttachment (see
 * {@link enrichEwsAttachments}). Routed by the SAME hybrid rule: the CURRENT item
 * via DIRECT (no cap — a 3 MB PDF comes through whole), a sibling via HOST (its
 * ~4 MB MIME is subject to the host cap; on overflow that message's attachments
 * degrade to byte-less markers, `state: "partial"`).
 *
 * Why a transport at all and NOT a direct POST to
 * `Office.context.mailbox.ewsUrl`: that is cross-origin (taskpane funnel origin →
 * Exchange host), and the Exchange EWS vdir 401s the unauthenticated CORS
 * preflight, so the browser blocks every direct call. The proxy is same-origin
 * (no CORS, no preflight) and is authenticated by the Erato session cookie
 * (`credentials: "include"`); the Exchange callback token rides the
 * `X-EWS-Authentication` header (NOT `Authorization`, which oauth2-proxy owns),
 * which the proxy re-maps onto `Authorization` for Exchange. The proxy derives
 * the target Exchange URL from its own config, so the client never sends one (no
 * SSRF surface).
 *
 * ROUTING:
 *   - bytes / files for the CURRENT item (by the id the caller holds)
 *       → DIRECT path (no cap).
 *   - conversation enumeration (GetConversationItems) + sibling GetItem
 *       → HOST path (broad), except the member equal to the current item, which
 *         is fetched via the DIRECT path (no cap on the message we care about
 *         most). A sibling that overflows the 1 MB cap degrades to `partial`.
 *   - FindItem-by-Message-ID is mailbox-wide → HOST path; the resolved GetItem
 *     then goes DIRECT if it is the current item, else HOST.
 *
 * Both transports return the SAME SOAP shapes, so the response handling (XML
 * parse + SOAP fault + EWS ResponseCode error) is factored into
 * {@link parseEwsSoap} / {@link assertResponseOk} and shared; only the network
 * legs differ. The XML payloads are mapped once (see `mapEwsItemToGraphShape`)
 * onto the Graph-cased `GraphConversationMessage` family so downstream consumers
 * (`parsedThread`, `parseMsgFile`, …) stay backend-agnostic. Error contracts
 * mirror the Graph functions too: bytes fetchers throw on transport/SOAP
 * failure, the conversation fetch reports `{ state: "partial" | "error" }`, and
 * the parent lookup returns `null` rather than throwing.
 *
 * The environment dispatcher lives in `./fetchOutlookMessage.ts`.
 */

const SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const TYPES_NS = "http://schemas.microsoft.com/exchange/services/2006/types";
const MESSAGES_NS =
  "http://schemas.microsoft.com/exchange/services/2006/messages";

/**
 * Same-origin Erato endpoint that forwards EWS SOAP to Exchange server-side (see
 * module doc for why a direct cross-origin EWS POST is impossible). Contract per
 * the backend (EratoLab/erato PR #727, `ms_office::ews_proxy`): POST the raw SOAP
 * envelope as `text/xml`; the Exchange callback token rides the `Authorization`
 * header (the proxy forwards it to Exchange verbatim and 401s if absent); the
 * proxy derives the target EWS URL from its own `integrations.ms_office.
 * ews_api_endpoint` config, so the client does NOT send a target URL. The
 * response is Exchange's SOAP response passed through verbatim.
 */
const EWS_PROXY_PATH = "/api/v1beta/integrations/ms-office/ews";

/**
 * SE is build 15.2; `Exchange2013_SP1` is the most widely-supported schema
 * version that still exposes everything we use (MimeContent, ConversationId
 * restriction, GetConversationItems). Higher versions add nothing we need and
 * narrow server compatibility, so we pin the lowest sufficient one.
 */
const REQUEST_SERVER_VERSION = "Exchange2013_SP1";

/** PR_INTERNET_MESSAGE_ID — the strongly-typed `message:InternetMessageId`
 * FieldURI is NOT first-class in EWS, so we restrict on this MAPI property tag
 * instead (PidTagInternetMessageId, 0x1035, String). */
const PR_INTERNET_MESSAGE_ID_TAG = "0x1035";

/** Graph-cased discriminators the shared `GraphConversationMessage` consumers
 * (`parsedThread.transformAttachment`) understand. EWS only models
 * FileAttachment and ItemAttachment (no reference attachments). */
const GRAPH_FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";
const GRAPH_ITEM_ATTACHMENT_TYPE = "#microsoft.graph.itemAttachment";

/** Past this many conversation members the thread is declared `partial`,
 * mirroring the Graph/REST cap (50 × 20 = 1000). */
const MAX_CONVERSATION_ITEMS = 1000;
/** Max simultaneous per-message GetItem fetches — both the body-shape GetItem
 * and the attachment-MIME GetItem (on-prem Exchange throttles per-connection),
 * mirroring the Graph/REST throttle guard. */
const EWS_FETCH_CONCURRENCY = 5;

/** EWS ResponseCode meaning "the item does not exist" — maps to not-found
 * (null) rather than a thrown error, mirroring the Graph empty-filter case. */
const ERROR_ITEM_NOT_FOUND = "ErrorItemNotFound";

/** A SOAP Fault or a non-not-found EWS error surfaces as this typed error so
 * callers can distinguish a transport/protocol failure from a clean miss. */
export class EwsRequestError extends Error {
  constructor(
    message: string,
    readonly responseCode?: string,
  ) {
    super(message);
    this.name = "EwsRequestError";
  }
}

/**
 * The host transport ({@link ewsHostFetch}) hit `makeEwsRequestAsync`'s RESPONSE
 * cap (5 MB in OWA / 1 MB in classic Outlook). Distinct from {@link
 * EwsRequestError} so the conversation fetch can degrade just the offending
 * sibling — or, when its attachment MIME overflows, that message's attachments —
 * to byte-less disclosure markers (`state: "partial"`) instead of failing the
 * whole thread. ONLY a genuine size-cap signal (the 9020 code or the strict
 * "Response exceeds N MB size limit" wording) maps here; see {@link ewsHostFetch}.
 */
export class EwsResponseTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EwsResponseTooLargeError";
  }
}

/**
 * `makeEwsRequestAsync`'s Office.js error code for the response cap (5 MB in
 * OWA / 1 MB in classic Outlook), surfaced as "Response exceeds N MB size
 * limit". We also pattern-match the message text via {@link
 * EWS_RESPONSE_TOO_LARGE_MESSAGE} as a belt-and-suspenders signal in case a host
 * reports the cap without the numeric code.
 */
const EWS_RESPONSE_TOO_LARGE_CODE = 9020;

/**
 * STRICT size-cap message matcher. Only a genuine "Response exceeds N MB size
 * limit" counts as the cap; anything else — notably ErrorAccessDenied / "the
 * requested web method is unavailable" (which `makeEwsRequestAsync` returns for
 * operations outside its allow-list) — must NOT be mistaken for an oversize and
 * silently degraded. The old loose `/1 ?MB|exceeds.*size/i` over-matched; this
 * anchors on the actual cap wording so any other failure surfaces as a hard
 * {@link EwsRequestError} instead.
 */
const EWS_RESPONSE_TOO_LARGE_MESSAGE = /response exceeds \d+ ?MB/i;

interface EwsRequestOptions extends GraphRequestOptions {
  transport?: GraphTransport;
}

/** `ewsUrl` is the absolute SOAP endpoint (`https://host/EWS/Exchange.asmx`).
 * Errors if absent so the conversation fetch can report `state: "error"`. */
function getEwsUrl(): string {
  const ewsUrl = Office.context.mailbox.ewsUrl;
  if (!ewsUrl) {
    throw new EwsRequestError(
      "Office.context.mailbox.ewsUrl is not available — EWS not accessible",
    );
  }
  return ewsUrl.trim().replace(/\/$/, "");
}

/** The SOAP-token analogue of REST's `getRestCallbackToken`: a callback token
 * for EWS (NOT REST), accepted by the on-prem server as an OAuth Bearer. */
async function getEwsCallbackToken(): Promise<string> {
  return callOfficeAsync<string>((callback) =>
    Office.context.mailbox.getCallbackTokenAsync({ isRest: false }, callback),
  );
}

/**
 * Caches one callback token across all requests of a single operation while
 * coalescing concurrent 401-driven re-acquisitions onto a single
 * `getCallbackTokenAsync` round-trip. The EWS analogue of the REST module's
 * token source.
 */
interface EwsTokenSource {
  get(): Promise<string>;
  refresh(): Promise<string>;
}

function makeEwsTokenSource(): EwsTokenSource {
  let cached: Promise<string> | null = null;
  let pendingRefresh: Promise<string> | null = null;

  const run = (refresh: boolean): Promise<string> => {
    const promise = getEwsCallbackToken();
    cached = promise;
    if (refresh) {
      pendingRefresh = promise;
    }
    void promise.then(
      () => {
        if (pendingRefresh === promise) pendingRefresh = null;
      },
      () => {
        // Never cache a rejected promise — clear so the next caller re-attempts
        // instead of being served the poisoned failure forever.
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
 * POSTs a SOAP envelope to the same-origin Erato EWS proxy ({@link
 * EWS_PROXY_PATH}), which forwards it to Exchange. The operation's cached
 * callback token rides the `X-EWS-Authentication` header (the proxy re-maps it
 * onto Exchange's `Authorization`); the Erato session authenticates the proxy
 * call via the cookie (`credentials: "include"`). On a 401 (callback tokens live ~5 minutes and can
 * expire mid-operation), re-acquires the token and retries exactly once —
 * mirroring the REST module's `restFetch` recovery contract. Returns the parsed
 * XML document; throws `EwsRequestError` on transport failure or a SOAP Fault.
 *
 * Same-origin POST → no CORS preflight (preflight is a cross-origin concern).
 *
 * `_ewsUrl` is intentionally NOT sent — the backend proxy derives the target
 * Exchange endpoint from its own config. It is still threaded from the call
 * sites only because `getEwsUrl()` there doubles as the "is EWS available on
 * this mailbox" precheck (throws → `state: "error"`); the value itself is now
 * vestigial here and the threading can be removed in a later cleanup.
 *
 * 401 NUANCE (finalize against the proxy's error contract): a 401 here is either
 * an expired *Erato session* (oauth2-proxy, before the endpoint) OR an expired
 * *callback token* (Exchange's 401 passed through). Today we treat 401 as the
 * latter and re-acquire the callback token; if a distinct signal emerges for the
 * token case, switch this branch to it and let the shared API layer's
 * `recoverAuth` own the session 401.
 */
async function ewsFetch(
  soapXml: string,
  _ewsUrl: string,
  tokenSource: EwsTokenSource,
  signal: AbortSignal | undefined,
  transport: GraphTransport = globalThis.fetch.bind(globalThis),
): Promise<Document> {
  const request = (token: string) =>
    transport(EWS_PROXY_PATH, {
      method: "POST",
      signal,
      // Erato session cookie authenticates the request to the proxy.
      credentials: "include",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        // The Exchange callback token rides X-EWS-Authentication, NOT
        // Authorization: oauth2-proxy owns Authorization (it overwrites it with
        // the Erato session token), so the proxy reads this dedicated header and
        // re-maps it onto Authorization for the Exchange request.
        "X-EWS-Authentication": `Bearer ${token}`,
      },
      body: soapXml,
    });

  let response = await request(await tokenSource.get());
  if (response.status === 401) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("Aborted", "AbortError");
    }
    response = await request(await tokenSource.refresh());
  }
  if (!response.ok) {
    throw new EwsRequestError(
      `EWS request failed: ${response.status} ${response.statusText}`,
    );
  }

  return parseEwsSoap(await response.text());
}

/**
 * The host transport: sends the SOAP envelope via
 * `Office.context.mailbox.makeEwsRequestAsync`, which the host issues against
 * Exchange with the user's FULL mailbox credentials (so it can reach
 * conversation-wide / sibling operations the item-scoped callback token can't).
 * Used for the conversation enumeration and for sibling GetItems.
 *
 * On success the host hands back the EWS SOAP response as an XML STRING (in
 * `asyncResult.value`), which we parse exactly like the direct path via the
 * shared {@link parseEwsSoap}. On failure we classify STRICTLY: ONLY a genuine
 * response-size cap (the 9020 code or the "Response exceeds N MB size limit"
 * wording — 5 MB OWA / 1 MB classic) surfaces as {@link EwsResponseTooLargeError}
 * (so the conversation fetch degrades just that sibling/its attachments); every
 * other failure — including the host being restricted or an operation outside
 * the allow-list, both of which come back as ErrorAccessDenied / "the requested
 * web method is unavailable" — surfaces as {@link EwsRequestError} and is NOT
 * mistaken for a degrade-able oversize.
 *
 * Unlike {@link ewsFetch} there is no proxy, no `X-EWS-Authentication` header,
 * and no 401 retry: the host owns the Exchange credential and round-trip.
 */
function ewsHostFetch(soapXml: string): Promise<Document> {
  // makeEwsRequestAsync does NOT accept a UTF-8 XML declaration (per the office.js
  // docs, a `<?xml … encoding="utf-8"?>` request is rejected for EWS, and classic
  // Outlook expects iso-8859-1). The shared builder emits one for the direct/proxy
  // leg (an ordinary HTTP POST, which is fine) — strip it for the host leg so the
  // request reaches Exchange rather than failing on the declaration.
  const hostSoap = soapXml.replace(/^\s*<\?xml[^>]*\?>\s*/i, "");
  return new Promise<Document>((resolve, reject) => {
    Office.context.mailbox.makeEwsRequestAsync(hostSoap, (asyncResult) => {
      if (asyncResult.status === Office.AsyncResultStatus.Succeeded) {
        try {
          resolve(parseEwsSoap(asyncResult.value));
        } catch (error) {
          reject(error);
        }
        return;
      }
      const error = asyncResult.error;
      const message = error?.message ?? "makeEwsRequestAsync failed";
      // ONLY the genuine response-size cap degrades a sibling cleanly. Require
      // either the numeric 9020 code OR the strict "Response exceeds N MB size
      // limit" wording — every other failure (e.g. ErrorAccessDenied / "the
      // requested web method is unavailable", which the host returns for
      // operations outside makeEwsRequestAsync's allow-list) is a hard
      // EwsRequestError, NOT a degrade-able oversize.
      if (
        error?.code === EWS_RESPONSE_TOO_LARGE_CODE ||
        EWS_RESPONSE_TOO_LARGE_MESSAGE.test(message)
      ) {
        reject(new EwsResponseTooLargeError(message));
        return;
      }
      reject(new EwsRequestError(message));
    });
  });
}

/**
 * Shared SOAP-response handling for BOTH transports: parses the EWS SOAP
 * response XML string into a `Document`, then rejects a malformed body
 * (parsererror) or a SOAP Fault as {@link EwsRequestError}. ResponseCode-level
 * errors (per response message) are handled by {@link assertResponseOk} at the
 * call sites, since which codes are tolerable (e.g. ErrorItemNotFound) is
 * operation-specific.
 */
function parseEwsSoap(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) {
    throw new EwsRequestError(
      `EWS response was not valid XML: ${parserError.textContent ?? ""}`,
    );
  }
  const fault = doc.getElementsByTagNameNS(SOAP_NS, "Fault")[0];
  if (fault) {
    const faultString =
      fault.getElementsByTagName("faultstring")[0]?.textContent ??
      fault.textContent ??
      "unknown SOAP fault";
    throw new EwsRequestError(`EWS SOAP fault: ${faultString.trim()}`);
  }
  return doc;
}

/** The currently-selected item's EWS id — the one (and only) message the
 * item-scoped callback token / direct path can fetch. `undefined` in compose
 * mode or when no item is selected. */
function getCurrentItemId(): string | undefined {
  return Office.context.mailbox.item?.itemId;
}

/**
 * Standard EWS SOAP 1.1 envelope with a `RequestServerVersion` header. One
 * builder per operation calls this with its `<m:…>` request body.
 */
function buildSoapEnvelope(body: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<soap:Envelope xmlns:soap="${SOAP_NS}" xmlns:t="${TYPES_NS}" xmlns:m="${MESSAGES_NS}">` +
    "<soap:Header>" +
    `<t:RequestServerVersion Version="${REQUEST_SERVER_VERSION}"/>` +
    "</soap:Header>" +
    `<soap:Body>${body}</soap:Body>` +
    "</soap:Envelope>"
  );
}

/** Escape the five XML-significant characters for safe interpolation into
 * attribute values and element text. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// --- SOAP body builders (one per operation) --------------------------------

function buildGetItemMimeBody(itemId: string): string {
  return (
    "<m:GetItem>" +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    "<t:IncludeMimeContent>true</t:IncludeMimeContent>" +
    "</m:ItemShape>" +
    "<m:ItemIds>" +
    `<t:ItemId Id="${escapeXml(itemId)}"/>` +
    "</m:ItemIds>" +
    "</m:GetItem>"
  );
}

/** GetItem requesting the full body + recipients + attachment listing for a
 * single conversation member (kept per-message so each response stays modest). */
function buildGetItemMessageBody(itemId: string): string {
  return (
    "<m:GetItem>" +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    "<t:BodyType>Best</t:BodyType>" +
    "<t:AdditionalProperties>" +
    '<t:FieldURI FieldURI="item:Subject"/>' +
    '<t:FieldURI FieldURI="item:Body"/>' +
    '<t:FieldURI FieldURI="item:DateTimeSent"/>' +
    '<t:FieldURI FieldURI="item:DateTimeReceived"/>' +
    '<t:FieldURI FieldURI="item:HasAttachments"/>' +
    '<t:FieldURI FieldURI="item:Attachments"/>' +
    '<t:FieldURI FieldURI="message:From"/>' +
    '<t:FieldURI FieldURI="message:ToRecipients"/>' +
    '<t:FieldURI FieldURI="message:CcRecipients"/>' +
    '<t:FieldURI FieldURI="message:InternetMessageId"/>' +
    // IsDraft lives on Item, not Message — "message:IsDraft" is not a defined
    // FieldURI and EWS fails the whole GetItem (ErrorInvalidPropertyRequest).
    '<t:FieldURI FieldURI="item:IsDraft"/>' +
    "</t:AdditionalProperties>" +
    "</m:ItemShape>" +
    "<m:ItemIds>" +
    `<t:ItemId Id="${escapeXml(itemId)}"/>` +
    "</m:ItemIds>" +
    "</m:GetItem>"
  );
}

/**
 * FindItem restricted to messages whose PR_INTERNET_MESSAGE_ID equals the given
 * RFC 5322 Message-ID. IdOnly shape; the caller resolves the id then GetItems.
 * NOTE: FindItem only supports Shallow traversal (Deep is a FindFolder value and
 * is rejected). Shallow does NOT span subfolders, so this resolves a message
 * only within the searched folder — cross-folder .msg resolution would need a
 * per-folder walk (runtime-verify; left for hardening once the approach proves
 * out on a live SE box).
 */
function buildFindByInternetMessageIdBody(internetMessageId: string): string {
  return (
    '<m:FindItem Traversal="Shallow">' +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    "<t:AdditionalProperties>" +
    '<t:FieldURI FieldURI="item:Subject"/>' +
    "</t:AdditionalProperties>" +
    "</m:ItemShape>" +
    '<m:IndexedPageItemView MaxEntriesReturned="1" Offset="0" BasePoint="Beginning"/>' +
    "<m:Restriction>" +
    "<t:IsEqualTo>" +
    `<t:ExtendedFieldURI PropertyTag="${PR_INTERNET_MESSAGE_ID_TAG}" PropertyType="String"/>` +
    "<t:FieldURIOrConstant>" +
    `<t:Constant Value="${escapeXml(internetMessageId)}"/>` +
    "</t:FieldURIOrConstant>" +
    "</t:IsEqualTo>" +
    "</m:Restriction>" +
    "<m:ParentFolderIds>" +
    '<t:DistinguishedFolderId Id="root"/>' +
    "</m:ParentFolderIds>" +
    "</m:FindItem>"
  );
}

/**
 * GetConversationItems for one ConversationId — enumerates EVERY message in the
 * conversation across all folders (including Sent), which is exactly the
 * cross-folder coverage Graph's `conversationId` filter gives. We request only
 * ids here and GetItem each member's body separately so no single response is
 * huge.
 *
 * IMPORTANT (see module-level risk note + the runtime risks output): the
 * Office/REST `conversationId` the caller passes may NOT be in the EWS
 * ConversationId `Id` format — there is no `Office.context.mailbox.convertTo…`
 * for conversation ids. We pass it as-is; if the server rejects it the caller
 * falls back to `buildFindByConversationIdBody`.
 */
function buildGetConversationItemsBody(conversationId: string): string {
  return (
    "<m:GetConversationItems>" +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    "</m:ItemShape>" +
    "<m:Conversations>" +
    "<t:Conversation>" +
    `<t:ConversationId Id="${escapeXml(conversationId)}"/>` +
    "</t:Conversation>" +
    "</m:Conversations>" +
    "</m:GetConversationItems>"
  );
}

/**
 * Best-effort fallback: FindItem restricted by item:ConversationId, used only
 * when GetConversationItems rejects the id format. Two caveats, both runtime-
 * verify on a live SE box: FindItem only supports Shallow traversal (so this
 * does NOT span folders — it won't see Sent-folder copies the way
 * GetConversationItems does), and restricting on item:ConversationId (an
 * ItemId-typed property) may itself be rejected. GetConversationItems is the
 * real cross-folder path; this fallback is a long shot kept for diagnostics.
 */
function buildFindByConversationIdBody(conversationId: string): string {
  return (
    '<m:FindItem Traversal="Shallow">' +
    "<m:ItemShape>" +
    "<t:BaseShape>IdOnly</t:BaseShape>" +
    "</m:ItemShape>" +
    `<m:IndexedPageItemView MaxEntriesReturned="${MAX_CONVERSATION_ITEMS}" Offset="0" BasePoint="Beginning"/>` +
    "<m:Restriction>" +
    "<t:IsEqualTo>" +
    '<t:FieldURI FieldURI="item:ConversationId"/>' +
    "<t:FieldURIOrConstant>" +
    `<t:Constant Value="${escapeXml(conversationId)}"/>` +
    "</t:FieldURIOrConstant>" +
    "</t:IsEqualTo>" +
    "</m:Restriction>" +
    "<m:ParentFolderIds>" +
    '<t:DistinguishedFolderId Id="root"/>' +
    "</m:ParentFolderIds>" +
    "</m:FindItem>"
  );
}

// --- Response inspection helpers -------------------------------------------
//
// EWS responses mix two namespaces: response wrappers, response messages, and
// status fields (`*ResponseMessage`, `ResponseCode`, `MessageText`) live in the
// `m:` messages namespace; the item data (`Items`, `Message`, `ItemId`, `Body`,
// recipients, attachments, `MimeContent`, …) lives in the `t:` types namespace.

/** First descendant in the EWS types (`t:`) namespace, or null. */
function firstTypesEl(
  parent: Element | Document,
  local: string,
): Element | null {
  return parent.getElementsByTagNameNS(TYPES_NS, local)[0] ?? null;
}

function typesText(parent: Element, local: string): string | undefined {
  return firstTypesEl(parent, local)?.textContent ?? undefined;
}

/** First descendant in the EWS messages (`m:`) namespace, or null. */
function firstMessagesEl(
  parent: Element | Document,
  local: string,
): Element | null {
  return parent.getElementsByTagNameNS(MESSAGES_NS, local)[0] ?? null;
}

/**
 * Reads a single response message's `ResponseClass` + `ResponseCode`. Throws
 * `EwsRequestError` on a hard error (other than the codes in `tolerate`, which
 * the caller handles — e.g. ErrorItemNotFound → null).
 */
function assertResponseOk(
  responseMessage: Element,
  tolerate: ReadonlySet<string> = new Set(),
): { responseClass: string; responseCode: string | undefined } {
  const responseClass =
    responseMessage.getAttribute("ResponseClass") ?? "Success";
  const responseCode = firstMessagesEl(
    responseMessage,
    "ResponseCode",
  )?.textContent;
  if (
    responseClass === "Error" &&
    !(responseCode && tolerate.has(responseCode))
  ) {
    const messageText =
      firstMessagesEl(responseMessage, "MessageText")?.textContent ??
      responseCode;
    throw new EwsRequestError(
      `EWS responded with an error: ${messageText ?? "unknown"}`,
      responseCode ?? undefined,
    );
  }
  return { responseClass, responseCode: responseCode ?? undefined };
}

// --- EWS XML → Graph-shape mapper ------------------------------------------

/**
 * The single EWS→Graph casing adapter: every downstream consumer speaks the
 * Graph-cased `GraphConversationMessage` family, so a `<t:Message>` element is
 * mapped here once instead of forking the shared types per backend.
 */
function mapEwsItemToGraphShape(message: Element): GraphConversationMessage {
  const itemId =
    firstTypesEl(message, "ItemId")?.getAttribute("Id") ?? undefined;
  return {
    id: itemId,
    internetMessageId: typesText(message, "InternetMessageId"),
    subject: typesText(message, "Subject"),
    from: mapEwsMailbox(firstTypesEl(message, "From")),
    toRecipients: mapEwsRecipients(firstTypesEl(message, "ToRecipients")),
    ccRecipients: mapEwsRecipients(firstTypesEl(message, "CcRecipients")),
    sentDateTime: typesText(message, "DateTimeSent"),
    receivedDateTime: typesText(message, "DateTimeReceived"),
    body: mapEwsBody(firstTypesEl(message, "Body")),
    isDraft: mapEwsBoolean(typesText(message, "IsDraft")),
    hasAttachments: mapEwsBoolean(typesText(message, "HasAttachments")),
    attachments: mapEwsAttachments(firstTypesEl(message, "Attachments")),
  };
}

/** `<t:From>`/`<t:Sender>` wrap a single `<t:Mailbox>`. */
function mapEwsMailbox(container: Element | null): GraphRecipient | undefined {
  if (!container) return undefined;
  const mailbox = firstTypesEl(container, "Mailbox") ?? container;
  const name = typesText(mailbox, "Name");
  const address = typesText(mailbox, "EmailAddress");
  if (name === undefined && address === undefined) return undefined;
  return { emailAddress: { name, address } };
}

/** `<t:ToRecipients>`/`<t:CcRecipients>` hold zero or more `<t:Mailbox>`. */
function mapEwsRecipients(
  container: Element | null,
): GraphRecipient[] | undefined {
  if (!container) return undefined;
  const mailboxes = container.getElementsByTagNameNS(TYPES_NS, "Mailbox");
  const recipients: GraphRecipient[] = [];
  for (const mailbox of Array.from(mailboxes)) {
    recipients.push({
      emailAddress: {
        name: typesText(mailbox, "Name"),
        address: typesText(mailbox, "EmailAddress"),
      },
    });
  }
  return recipients;
}

function mapEwsBody(body: Element | null): GraphBody | undefined {
  if (!body) return undefined;
  const bodyType = body.getAttribute("BodyType");
  return {
    contentType:
      bodyType === "HTML" ? "html" : bodyType === "Text" ? "text" : undefined,
    content: body.textContent ?? undefined,
  };
}

function mapEwsBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  return value === "true";
}

/**
 * `<t:Attachments>` holds `<t:FileAttachment>` and `<t:ItemAttachment>`
 * children. NEITHER carries its bytes here: EWS `GetItem` (body shape) returns
 * attachment METADATA only (name/size/type/id), never the content — so both
 * kinds come back byte-less and are filled in best-effort by re-fetching the
 * OWNING MESSAGE's full RFC822 MIME (GetItem + IncludeMimeContent) and splicing
 * the matched part's bytes on (see `enrichEwsAttachments`); GetAttachment is NOT
 * used because `makeEwsRequestAsync` does not permit it. `contentBytes` below is
 * read defensively in case a server ever inlines it, but in practice it is empty
 * until enrichment. Unknown subtypes are skipped so they fall into
 * `transformAttachment`'s disclosure branch rather than being mislabeled.
 */
function mapEwsAttachments(
  container: Element | null,
): GraphAttachment[] | undefined {
  if (!container) return undefined;
  const attachments: GraphAttachment[] = [];
  for (const child of Array.from(container.children)) {
    const local = child.localName;
    if (local === "FileAttachment") {
      attachments.push({
        "@odata.type": GRAPH_FILE_ATTACHMENT_TYPE,
        id:
          firstTypesEl(child, "AttachmentId")?.getAttribute("Id") ?? undefined,
        name: typesText(child, "Name"),
        contentType: typesText(child, "ContentType"),
        size: parseSize(typesText(child, "Size")),
        isInline: mapEwsBoolean(typesText(child, "IsInline")),
        contentBytes: typesText(child, "Content"),
        contentId: typesText(child, "ContentId"),
      });
    } else if (local === "ItemAttachment") {
      attachments.push({
        "@odata.type": GRAPH_ITEM_ATTACHMENT_TYPE,
        id:
          firstTypesEl(child, "AttachmentId")?.getAttribute("Id") ?? undefined,
        name: typesText(child, "Name"),
        contentType: typesText(child, "ContentType"),
        size: parseSize(typesText(child, "Size")),
        isInline: mapEwsBoolean(typesText(child, "IsInline")),
      });
    }
  }
  return attachments;
}

function parseSize(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const size = Number(value);
  return Number.isFinite(size) ? size : undefined;
}

// --- Capability implementations --------------------------------------------

/**
 * Raw RFC822 MIME of a message by its EWS item id — the EWS mirror of
 * `fetchOutlookMessageBytesViaGraph` (same result shape, throws on failure).
 * GetItem with `IncludeMimeContent` returns the MIME as base64; we decode it to
 * bytes. The item id is already an EWS id, so no conversion is needed (unlike
 * the Graph/REST paths, which convert to a REST id).
 */
export async function fetchOutlookMessageBytesViaEws(
  ewsItemId: string,
  options: EwsRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult> {
  const ewsUrl = getEwsUrl();
  const tokenSource = makeEwsTokenSource();
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);

  const doc = await ewsFetch(
    buildSoapEnvelope(buildGetItemMimeBody(ewsItemId)),
    ewsUrl,
    tokenSource,
    options.signal,
    transport,
  );
  const responseMessage = firstMessagesEl(doc, "GetItemResponseMessage");
  if (!responseMessage) {
    throw new EwsRequestError("EWS GetItem returned no response message");
  }
  assertResponseOk(responseMessage);
  const message = firstTypesEl(responseMessage, "Message");
  const mimeBase64 = message
    ? typesText(message, "MimeContent")
    : typesText(responseMessage, "MimeContent");
  if (!mimeBase64) {
    throw new EwsRequestError("EWS GetItem returned no MimeContent");
  }
  const bytes = decodeBase64ToBuffer(mimeBase64);
  if (!bytes) {
    throw new EwsRequestError("EWS MimeContent was not valid base64");
  }
  return {
    bytes,
    subject: (message ? typesText(message, "Subject") : undefined) ?? "",
    internetMessageId:
      (message ? typesText(message, "InternetMessageId") : undefined) ?? null,
  };
}

/**
 * Looks up a message by its RFC 5322 `Message-ID` header — the EWS mirror of
 * `fetchOutlookMessageBytesByInternetMessageIdViaGraph`, including its
 * not-found semantics: `null` when FindItem yields no match (or returns
 * ErrorItemNotFound), a thrown error when the lookup itself fails.
 *
 * HYBRID: FindItem is mailbox-wide, which the item-scoped callback token can't
 * run, so the lookup goes through the HOST path. The resolved GetItem then goes
 * DIRECT if it happens to be the current item (no cap), else HOST.
 */
export async function fetchOutlookMessageBytesByInternetMessageIdViaEws(
  internetMessageId: string,
  options: EwsRequestOptions = {},
): Promise<FetchOutlookMessageBytesResult | null> {
  // Precheck that EWS is reachable on this mailbox (throws → caller surfaces the
  // failure), mirroring the original contract; the host FindItem/GetItem legs
  // derive their own endpoint, so the url itself isn't threaded further.
  getEwsUrl();
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);

  const matchId = await findItemIdByInternetMessageId(internetMessageId);
  if (!matchId) {
    return null;
  }
  const result =
    matchId === getCurrentItemId()
      ? // The matched message is the current item → DIRECT (no cap).
        await fetchOutlookMessageBytesViaEws(matchId, { ...options, transport })
      : // A sibling/other-folder message → HOST (broad, may hit the 1 MB cap).
        await fetchOutlookMessageBytesViaEwsHost(matchId);
  return {
    ...result,
    internetMessageId: result.internetMessageId ?? internetMessageId,
  };
}

/**
 * Raw MIME of a message by EWS item id via the HOST path (for messages other
 * than the current item, which the item-scoped token can't reach). Same shape
 * as {@link fetchOutlookMessageBytesViaEws} but no proxy/token/abort plumbing;
 * the host's ~1 MB cap surfaces as {@link EwsResponseTooLargeError}.
 */
async function fetchOutlookMessageBytesViaEwsHost(
  ewsItemId: string,
): Promise<FetchOutlookMessageBytesResult> {
  const doc = await ewsHostFetch(
    buildSoapEnvelope(buildGetItemMimeBody(ewsItemId)),
  );
  const responseMessage = firstMessagesEl(doc, "GetItemResponseMessage");
  if (!responseMessage) {
    throw new EwsRequestError("EWS GetItem returned no response message");
  }
  assertResponseOk(responseMessage);
  const message = firstTypesEl(responseMessage, "Message");
  const mimeBase64 = message
    ? typesText(message, "MimeContent")
    : typesText(responseMessage, "MimeContent");
  if (!mimeBase64) {
    throw new EwsRequestError("EWS GetItem returned no MimeContent");
  }
  const bytes = decodeBase64ToBuffer(mimeBase64);
  if (!bytes) {
    throw new EwsRequestError("EWS MimeContent was not valid base64");
  }
  return {
    bytes,
    subject: (message ? typesText(message, "Subject") : undefined) ?? "",
    internetMessageId:
      (message ? typesText(message, "InternetMessageId") : undefined) ?? null,
  };
}

export async function fetchOutlookMessageFilesByInternetMessageIdViaEws(
  internetMessageId: string,
  options: EwsRequestOptions = {},
): Promise<FetchOutlookMessageResult | null> {
  const result = await fetchOutlookMessageBytesByInternetMessageIdViaEws(
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

/** Resolves an item id by RFC 5322 Message-ID via FindItem on the HOST path —
 * FindItem is mailbox-wide, which the item-scoped callback token can't run. */
async function findItemIdByInternetMessageId(
  internetMessageId: string,
): Promise<string | null> {
  const doc = await ewsHostFetch(
    buildSoapEnvelope(buildFindByInternetMessageIdBody(internetMessageId)),
  );
  const responseMessage = firstMessagesEl(doc, "FindItemResponseMessage");
  if (!responseMessage) {
    throw new EwsRequestError("EWS FindItem returned no response message");
  }
  // A clean "no such item" is a miss (null), not a failure — mirrors Graph's
  // empty-filter case.
  const { responseClass } = assertResponseOk(
    responseMessage,
    new Set([ERROR_ITEM_NOT_FOUND]),
  );
  if (responseClass === "Error") {
    return null;
  }
  const message = firstTypesEl(responseMessage, "Message");
  return message
    ? (firstTypesEl(message, "ItemId")?.getAttribute("Id") ?? null)
    : null;
}

/**
 * Latest non-draft message in a conversation — the EWS mirror of
 * `fetchParentMessageInConversationViaGraph`. Reuses the full conversation
 * enumeration + per-message GetItem, then picks the latest non-draft
 * client-side. Returns `null` on a miss or ANY failure — the reply-context chip
 * quietly does without it.
 */
export async function fetchParentMessageInConversationViaEws(
  conversationId: string,
  options: EwsRequestOptions = {},
): Promise<ParentMessageMetadata | null> {
  try {
    const { messages } = await fetchConversationMessagesViaEws(conversationId, {
      signal: options.signal,
      transport: options.transport,
    });
    const latest = messages
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
    console.warn("[fetchParentMessageInConversationViaEws] failed:", error);
    return null;
  }
}

/**
 * Every message in a conversation, attachments expanded — the EWS mirror of
 * `fetchConversationMessagesViaGraph`, including the `{ messages, state }`
 * contract (`error` only when nothing could be fetched, `partial` when some
 * per-message GetItem calls fail, a sibling overflows the host 1 MB cap, or the
 * item cap is hit). NEVER throws (abort aside): a server (or host) that rejects
 * the enumeration surfaces as `state: "error"`, not a crash.
 *
 * HYBRID transport (see module doc): the item-scoped callback token can't reach
 * the conversation, so we (1) enumerate the member ids via the HOST path
 * (GetConversationItems through `makeEwsRequestAsync`, which the host runs with
 * full mailbox creds) — if THAT fails (e.g. the host is also restricted →
 * ErrorAccessDenied) we return `state: "error"`. Then (2) GetItem each member's
 * body with bounded concurrency, routing the CURRENT item through the DIRECT
 * path (no cap) and every sibling through the HOST path. A sibling whose
 * response overflows the host's cap ({@link EwsResponseTooLargeError}) degrades
 * to a body-less marker (`state: "partial"`) but stays in the thread. Finally
 * enrich byte-less attachments from each owning message's MIME (GetItem +
 * IncludeMimeContent, same hybrid routing — NOT GetAttachment, which the host
 * does not permit; see {@link enrichEwsAttachments}).
 */
export async function fetchConversationMessagesViaEws(
  conversationId: string,
  options: FetchConversationOptions = {},
): Promise<FetchConversationResult> {
  const transport = options.transport ?? globalThis.fetch.bind(globalThis);

  let ewsUrl: string;
  try {
    ewsUrl = getEwsUrl();
  } catch (error) {
    console.warn("[fetchConversationMessagesViaEws] no ewsUrl:", error);
    return { messages: [], state: "error" };
  }
  const tokenSource = makeEwsTokenSource();
  const currentItemId = getCurrentItemId();

  // Phase 1: enumerate the member ids via the HOST path (broad). If the host is
  // also restricted on this box, this throws → the whole fetch degrades to
  // `error` (the "host also restricted" outcome the live test surfaces).
  let itemIds: string[];
  try {
    itemIds = await enumerateConversationItemIds(conversationId);
  } catch (error) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? error;
    }
    console.warn(
      "[fetchConversationMessagesViaEws] enumeration failed:",
      error,
    );
    return { messages: [], state: "error" };
  }

  let state: ConversationFetchState = "ok";
  if (itemIds.length > MAX_CONVERSATION_ITEMS) {
    // More members than we'll fetch → the window is incomplete.
    itemIds = itemIds.slice(0, MAX_CONVERSATION_ITEMS);
    state = "partial";
  }

  // Phase 2: GetItem each member's body. A single GetItem failure (or a sibling
  // overflowing the host cap) degrades the window to `partial` rather than
  // aborting the whole thread.
  const messages: GraphConversationMessage[] = new Array(itemIds.length);
  let anyFailed = false;
  const tasks = itemIds.map((itemId, index) => async () => {
    try {
      const message = await getConversationMessage(
        itemId,
        currentItemId,
        ewsUrl,
        tokenSource,
        options.signal,
        transport,
      );
      if (message) {
        messages[index] = message;
      } else {
        anyFailed = true;
      }
    } catch (error) {
      if (options.signal?.aborted) {
        throw options.signal.reason ?? error;
      }
      if (error instanceof EwsResponseTooLargeError) {
        // The sibling's body blew past the host's ~1 MB cap. Keep the message in
        // the thread (so the parent/structure is preserved) with a body-less
        // marker — downstream `parsedThread` renders the empty body as a
        // disclosure rather than dropping it. Window becomes `partial`.
        console.warn(
          "[fetchConversationMessagesViaEws] sibling exceeds host 1 MB cap, " +
            "degrading to body-less marker:",
          error,
        );
        messages[index] = { id: itemId };
        anyFailed = true;
        return;
      }
      console.warn("[fetchConversationMessagesViaEws] GetItem failed:", error);
      anyFailed = true;
    }
  });
  await runWithConcurrency(tasks, EWS_FETCH_CONCURRENCY);

  const fetched = messages.filter(
    (message): message is GraphConversationMessage => message != null,
  );
  if (fetched.length === 0 && itemIds.length > 0) {
    // We found members but couldn't fetch a single body → surface as error so
    // the caller doesn't silently render "no thread".
    return { messages: [], state: "error" };
  }
  if (anyFailed && state === "ok") {
    state = "partial";
  }

  if (fetched.length > 0) {
    await enrichEwsAttachments(
      fetched,
      currentItemId,
      ewsUrl,
      tokenSource,
      options.signal,
      transport,
    );
  }

  return { messages: fetched, state };
}

/**
 * Enumerates a conversation's member item ids via the HOST path — the
 * item-scoped callback token can't run mailbox/conversation-wide operations, so
 * GetConversationItems (and the FindItem fallback) MUST go through
 * `makeEwsRequestAsync`, which the host runs with full mailbox creds. Tries
 * GetConversationItems first; if the server rejects the conversation id format
 * (the Office/REST id may not be a valid EWS ConversationId — see the runtime
 * risk), falls back to a FindItem ConversationId restriction across the mailbox.
 * A genuine authorization failure (the host being restricted too) rethrows so
 * the caller can report `state: "error"`.
 */
async function enumerateConversationItemIds(
  conversationId: string,
): Promise<string[]> {
  try {
    return await getConversationItemIdsViaGetConversationItems(conversationId);
  } catch (error) {
    // The conversation-id format mismatch lands here — retry via FindItem. A
    // hard authorization failure also lands here and re-throws from the
    // fallback, surfacing as `state: "error"`.
    console.warn(
      "[fetchConversationMessagesViaEws] GetConversationItems failed, " +
        "falling back to FindItem ConversationId restriction:",
      error,
    );
    return getConversationItemIdsViaFindItem(conversationId);
  }
}

async function getConversationItemIdsViaGetConversationItems(
  conversationId: string,
): Promise<string[]> {
  const doc = await ewsHostFetch(
    buildSoapEnvelope(buildGetConversationItemsBody(conversationId)),
  );
  const responseMessage = firstMessagesEl(
    doc,
    "GetConversationItemsResponseMessage",
  );
  if (!responseMessage) {
    throw new EwsRequestError(
      "EWS GetConversationItems returned no response message",
    );
  }
  assertResponseOk(responseMessage);
  const ids: string[] = [];
  // Each <t:ConversationNode> holds the items in one node; every item carries
  // an <t:ItemId>. The order is server-defined; sorting happens client-side via
  // receivedDateTime where it matters (parent selection).
  const itemIdEls = responseMessage.getElementsByTagNameNS(TYPES_NS, "ItemId");
  for (const itemIdEl of Array.from(itemIdEls)) {
    const id = itemIdEl.getAttribute("Id");
    if (id) ids.push(id);
  }
  return ids;
}

async function getConversationItemIdsViaFindItem(
  conversationId: string,
): Promise<string[]> {
  const doc = await ewsHostFetch(
    buildSoapEnvelope(buildFindByConversationIdBody(conversationId)),
  );
  const responseMessage = firstMessagesEl(doc, "FindItemResponseMessage");
  if (!responseMessage) {
    throw new EwsRequestError("EWS FindItem returned no response message");
  }
  assertResponseOk(responseMessage, new Set([ERROR_ITEM_NOT_FOUND]));
  const ids: string[] = [];
  const itemIdEls = responseMessage.getElementsByTagNameNS(TYPES_NS, "ItemId");
  for (const itemIdEl of Array.from(itemIdEls)) {
    const id = itemIdEl.getAttribute("Id");
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * GetItem for one conversation member's body, routed by the HYBRID rule: the
 * CURRENT item goes through the DIRECT path (no cap on the message we care about
 * most), every sibling through the HOST path (which can read it but may hit the
 * ~1 MB cap → {@link EwsResponseTooLargeError}, which the caller degrades).
 * Returns the mapped message, or null on a tolerable not-found (e.g. the item
 * was deleted mid-enumeration).
 */
async function getConversationMessage(
  itemId: string,
  currentItemId: string | undefined,
  ewsUrl: string,
  tokenSource: EwsTokenSource,
  signal: AbortSignal | undefined,
  transport: GraphTransport,
): Promise<GraphConversationMessage | null> {
  const soapXml = buildSoapEnvelope(buildGetItemMessageBody(itemId));
  const doc =
    itemId === currentItemId
      ? await ewsFetch(soapXml, ewsUrl, tokenSource, signal, transport)
      : await ewsHostFetch(soapXml);
  const responseMessage = firstMessagesEl(doc, "GetItemResponseMessage");
  if (!responseMessage) {
    throw new EwsRequestError("EWS GetItem returned no response message");
  }
  const { responseClass } = assertResponseOk(
    responseMessage,
    new Set([ERROR_ITEM_NOT_FOUND]),
  );
  if (responseClass === "Error") {
    return null;
  }
  const message = firstTypesEl(responseMessage, "Message");
  return message ? mapEwsItemToGraphShape(message) : null;
}

/**
 * Splice attachment bytes onto every byte-less attachment by re-fetching the
 * OWNING MESSAGE's full RFC822 MIME (GetItem + `IncludeMimeContent`) and pulling
 * the matched parts out of it. We do NOT use `GetAttachment`: the host transport
 * (`makeEwsRequestAsync`) does not permit it — it answers GetAttachment with
 * "the requested web method is unavailable to this caller or application"
 * (ErrorAccessDenied) at any size. GetItem IS permitted, and its MIME carries
 * BOTH FileAttachment bytes and ItemAttachment (nested message) bytes inline, so
 * one GetItem-MIME per message serves every attachment kind.
 *
 * One GetItem-MIME per MESSAGE (not per attachment), routed by the same HYBRID
 * rule as the body fetch: the CURRENT item goes DIRECT (no cap — a 3 MB PDF on
 * the selected message comes through whole); every sibling goes HOST, whose MIME
 * is subject to the makeEwsRequestAsync response cap (5 MB OWA / 1 MB classic).
 * Best-effort: a single message's MIME failure (including a sibling whose MIME
 * overflows the cap → {@link EwsResponseTooLargeError}) leaves that message's
 * attachments byte-less, to be disclosed as markers downstream, and never
 * poisons the thread.
 */
async function enrichEwsAttachments(
  messages: GraphConversationMessage[],
  currentItemId: string | undefined,
  ewsUrl: string,
  tokenSource: EwsTokenSource,
  signal: AbortSignal | undefined,
  transport: GraphTransport,
): Promise<void> {
  const tasks: Array<() => Promise<void>> = [];
  for (const message of messages) {
    if (!message.id || !message.attachments) continue;
    // Both FileAttachment and ItemAttachment arrive byte-less from the body-shape
    // GetItem; skip the message entirely if none need bytes.
    const needsBytes = message.attachments.some(
      (attachment) => !attachment.contentBytes,
    );
    if (!needsBytes) continue;
    const messageId = message.id;
    const useDirect = messageId === currentItemId;
    tasks.push(() =>
      enrichMessageAttachmentsFromMime(
        message,
        messageId,
        useDirect,
        ewsUrl,
        tokenSource,
        signal,
        transport,
      ),
    );
  }
  await runWithConcurrency(tasks, EWS_FETCH_CONCURRENCY);
}

/**
 * Fetch one message's full RFC822 MIME (GetItem + IncludeMimeContent), parse it
 * with postal-mime, and splice each parsed part's bytes onto the matching
 * byte-less {@link GraphAttachment}. Matching is by filename (case-insensitive)
 * and, for inline parts, by Content-ID. Independently guarded: any failure
 * leaves this message's attachments byte-less (disclosed as markers downstream)
 * rather than poisoning the thread; an abort still propagates.
 */
async function enrichMessageAttachmentsFromMime(
  message: GraphConversationMessage,
  messageId: string,
  useDirect: boolean,
  ewsUrl: string,
  tokenSource: EwsTokenSource,
  signal: AbortSignal | undefined,
  transport: GraphTransport,
): Promise<void> {
  try {
    const soapXml = buildSoapEnvelope(buildGetItemMimeBody(messageId));
    const doc = useDirect
      ? await ewsFetch(soapXml, ewsUrl, tokenSource, signal, transport)
      : await ewsHostFetch(soapXml);
    const responseMessage = firstMessagesEl(doc, "GetItemResponseMessage");
    if (!responseMessage) return;
    // Tolerate any per-message error — one bad message must not poison the
    // thread; its attachments degrade to disclosure markers.
    if (responseMessage.getAttribute("ResponseClass") === "Error") return;
    const mimeMessage = firstTypesEl(responseMessage, "Message");
    const mimeBase64 = mimeMessage
      ? typesText(mimeMessage, "MimeContent")
      : typesText(responseMessage, "MimeContent");
    if (!mimeBase64) return;
    const bytes = decodeBase64ToBuffer(mimeBase64);
    if (!bytes) return;
    // `rfc822Attachments: true` forces nested message/rfc822 parts (Outlook
    // ItemAttachments — e.g. a forwarded email) to be emitted as attachments
    // regardless of their Content-Disposition. Without it, postal-mime inlines a
    // disposition-less submessage, leaking its inner attachments into the parent
    // and dropping the nested email itself, so the byte-less ItemAttachment never
    // gets matched.
    const parsed = await PostalMime.parse(bytes, { rfc822Attachments: true });
    spliceMimeAttachmentBytes(message, parsed.attachments ?? []);
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason ?? error;
    }
    // A sibling's MIME overflowing the host cap (EwsResponseTooLargeError) is
    // swallowed here too — the message's attachments stay byte-less and are
    // disclosed as markers downstream rather than failing the thread.
    console.warn(
      "[fetchConversationMessagesViaEws] attachment MIME enrichment failed:",
      error,
    );
  }
}

/**
 * Match each parsed MIME attachment to one of the message's byte-less
 * {@link GraphAttachment} entries and copy its bytes (as base64) onto
 * `contentBytes`, filling `contentType`/`name` from the parsed part when the
 * GetItem metadata left them empty. Matching prefers Content-ID (for inline
 * parts), then filename (case-insensitive); a parsed part with no GraphAttachment
 * match is ignored (the GetItem listing is the source of truth for which
 * attachments exist).
 */
function spliceMimeAttachmentBytes(
  message: GraphConversationMessage,
  parsedAttachments: ReadonlyArray<MimeAttachment>,
): void {
  const pending = (message.attachments ?? []).filter(
    (attachment) => !attachment.contentBytes,
  );
  if (pending.length === 0) return;
  const used = new Set<MimeAttachment>();
  for (const target of pending) {
    const part = parsedAttachments.find(
      (candidate) => !used.has(candidate) && mimePartMatches(target, candidate),
    );
    if (!part) continue;
    used.add(part);
    const base64 = mimeContentToBase64(part.content);
    if (!base64) continue;
    target.contentBytes = base64;
    if (!target.contentType && part.mimeType) {
      target.contentType = part.mimeType;
    }
    if (!target.name && part.filename) {
      target.name = part.filename;
    }
  }
}

/** True when a parsed MIME part is the same attachment as a GraphAttachment:
 * Content-ID equality (preferred for inline parts) or case-insensitive filename
 * equality. */
function mimePartMatches(
  target: GraphAttachment,
  part: MimeAttachment,
): boolean {
  const targetCid = normalizeContentId(target.contentId);
  const partCid = normalizeContentId(part.contentId);
  if (targetCid && partCid && targetCid === partCid) {
    return true;
  }
  const targetName = target.name?.trim().toLowerCase();
  const partName = part.filename?.trim().toLowerCase();
  if (targetName && partName) {
    return targetName === partName;
  }
  // Nested-email fallback: postal-mime emits a forwarded message/rfc822 part (an
  // Outlook ItemAttachment) with neither a filename nor a Content-ID when the
  // submessage carries no Content-Disposition, so neither key above can pair it.
  // Match such a part to a byte-less ItemAttachment by type alone so the nested
  // email's bytes aren't dropped; distinct nested emails are still consumed in
  // document order via the caller's `used` set. A differently-named pair is
  // rejected above (both names present and unequal), so this never mis-pairs.
  const partIsRfc822 = part.mimeType?.trim().toLowerCase() === "message/rfc822";
  return partIsRfc822 && target["@odata.type"] === GRAPH_ITEM_ATTACHMENT_TYPE;
}

/** Strip the surrounding angle brackets EWS/MIME wrap Content-IDs in so the two
 * sources compare equal (`<cid@host>` ↔ `cid@host`). */
function normalizeContentId(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^<|>$/g, "");
}

/** postal-mime hands back an attachment's `content` as ArrayBuffer / Uint8Array
 * (the default arraybuffer encoding) or, for some text parts, a decoded string.
 * Normalize any of those to the base64 string GraphAttachment.contentBytes
 * expects (the form `parsedThread.transformAttachment` then base64-decodes). */
function mimeContentToBase64(
  content: ArrayBuffer | Uint8Array | string,
): string | null {
  let bytes: Uint8Array;
  if (typeof content === "string") {
    bytes = new TextEncoder().encode(content);
  } else if (content instanceof Uint8Array) {
    bytes = content;
  } else if (content instanceof ArrayBuffer) {
    bytes = new Uint8Array(content);
  } else {
    return null;
  }
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

// --- Shared utilities (mirrored from the REST/Graph siblings) --------------

function decodeBase64ToBuffer(base64: string): ArrayBuffer | null {
  try {
    const binary = atob(base64.replace(/\s/g, ""));
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

/** Run thunks with at most `limit` in flight at once. Each thunk swallows its
 * own errors (these do, aborts aside), so the pool never rejects spuriously. */
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
