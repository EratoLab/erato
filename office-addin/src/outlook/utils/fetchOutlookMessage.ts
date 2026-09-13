import {
  fetchConversationMessagesViaEws,
  fetchOutlookMessageBytesByInternetMessageIdViaEws,
  fetchOutlookMessageBytesViaEws,
  fetchOutlookMessageFilesByInternetMessageIdViaEws,
  fetchParentMessageInConversationViaEws,
} from "./fetchOutlookMessageEws";
import {
  fetchConversationMessagesViaGraph,
  fetchOutlookMessageBytesByInternetMessageIdViaGraph,
  fetchOutlookMessageBytesViaGraph,
  fetchOutlookMessageFilesByInternetMessageIdViaGraph,
  fetchParentMessageInConversationViaGraph,
} from "./fetchOutlookMessageGraph";

import type {
  AcquireGraphToken,
  FetchConversationOptions,
  FetchConversationResult,
  FetchOutlookMessageBytesResult,
  FetchOutlookMessageResult,
  GraphRequestOptions,
  ParentMessageMetadata,
} from "./fetchOutlookMessageGraph";

// Result/option types are re-exported so call sites depend only on this seam,
// not on a specific backend module.
export type {
  FetchConversationOptions,
  FetchConversationResult,
  FetchOutlookMessageBytesResult,
  FetchOutlookMessageResult,
  GraphRequestOptions,
  ParentMessageMetadata,
} from "./fetchOutlookMessageGraph";

/**
 * Environment dispatcher for Outlook message fetching.
 *
 * The add-in talks to exactly one of two mutually exclusive mail backends,
 * selected by where the mailbox lives (NOT by auth mode — SE and EXO both
 * authenticate via Entra):
 *
 *   - Cloud mailbox (Exchange Online): Microsoft Graph with a `Mail.Read`
 *     token from MSAL. Outlook REST v2.0 is NOT an option there — legacy
 *     callback tokens were shut off for all Microsoft 365 tenants in
 *     October 2025.
 *   - On-prem mailbox (Exchange on-premises / Subscription Edition): EWS SOAP
 *     (`./fetchOutlookMessageEws.ts`) over two transports — the CURRENT item
 *     via the same-origin Erato backend proxy, carrying the item-scoped
 *     `getCallbackTokenAsync({ isRest: false })` callback token in the
 *     `X-EWS-Authentication` header; conversation/sibling fetches via the
 *     host-brokered `makeEwsRequestAsync` (the callback token doesn't
 *     authorize them). NOT Graph — it does not exist for on-prem mailboxes.
 *
 * `OutlookMessageFetcher` carries one capability per existing call-site need,
 * with signatures, result shapes, and error contracts identical to the
 * original Graph functions, so consumers (`fetchCurrentEmailEml`,
 * `parsedThread`, `parseMsgFile`, the drop handlers in `AddinChat`) stay
 * backend-agnostic. Location-aware selection lives in
 * `useOutlookMessageFetcher`.
 */
export interface OutlookMessageFetcher {
  /**
   * Raw RFC822 MIME of a message by its EWS item id (each backend translates
   * it to its native id form as needed). Throws on HTTP failure.
   */
  fetchMessageBytes(
    ewsItemId: string,
    options?: GraphRequestOptions,
  ): Promise<FetchOutlookMessageBytesResult>;
  /**
   * Message matching an RFC 5322 `Message-ID`, wrapped as a single `.eml`
   * File. `null` when the lookup yields no match (e.g. drafts without an
   * indexed id); throws when the lookup itself fails.
   */
  fetchMessageFilesByInternetMessageId(
    internetMessageId: string,
    options?: GraphRequestOptions,
  ): Promise<FetchOutlookMessageResult | null>;
  fetchMessageBytesByInternetMessageId(
    internetMessageId: string,
    options?: GraphRequestOptions,
  ): Promise<FetchOutlookMessageBytesResult | null>;
  /**
   * Every message in a conversation, attachments expanded. Never throws
   * (aborts aside) — failures surface through `state` ("error" only when
   * nothing could be fetched, "partial" for an incomplete window).
   */
  fetchConversationMessages(
    conversationId: string,
    options?: FetchConversationOptions,
  ): Promise<FetchConversationResult>;
  /**
   * Metadata of the latest non-draft message in a conversation (the
   * reply-context chip). `null` on a miss or ANY failure.
   */
  fetchParentMessageInConversation(
    conversationId: string,
    options?: GraphRequestOptions,
  ): Promise<ParentMessageMetadata | null>;
}

/** The conversation capability on its own — what `fetchCurrentThread` and
 * `useCurrentThread` consume. */
export type FetchConversationMessages =
  OutlookMessageFetcher["fetchConversationMessages"];

/** Delegated Graph scope for the signed-in user's own mailbox. */
export const GRAPH_MAIL_SCOPES = ["Mail.Read"];
/**
 * Reading a mailbox that isn't the signed-in user's own needs its OWN scope:
 * Entra consent has no hierarchy, so a granted `Mail.Read` does not authorise
 * `/users/{owner}` and Graph answers 403 there. Asked for only when an owner
 * is bound, so the common path keeps requesting the narrow scope.
 */
export const GRAPH_SHARED_MAIL_SCOPES = ["Mail.Read.Shared"];

/**
 * Token acquirer that takes the scopes to ask for — the shape of
 * `GraphTokenContextValue.acquireToken`. The Graph factory chooses the scope
 * itself, so no call site can pair an owner with the wrong one.
 */
export type AcquireScopedGraphToken = (
  scopes: string[],
  options?: { forceRefresh?: boolean },
) => Promise<string>;

/**
 * Microsoft Graph backing (Exchange Online). Thin delegation to the Graph
 * functions — every request carries the options the call site passed.
 *
 * `owner` is the address of the mailbox the items live in, bound once here so
 * every capability addresses the same store: absent, requests go to the
 * signed-in user's `/me`; given (an item opened out of a shared or delegated
 * mailbox), they go to that owner's `/users/{owner}` root. It is spread last
 * so the binding wins over anything a call site put in `options` — call sites
 * consume this seam precisely so they don't have to know where the mailbox
 * lives.
 *
 * The scope follows that binding HERE, not at the call site: `Mail.Read`
 * without an owner, `Mail.Read.Shared` with one. Entra consent has no
 * hierarchy, so an owner paired with a `Mail.Read`-only token 403s on every
 * request; deriving the scope from the owner makes that pairing
 * unexpressible. Callers hand in the raw scoped acquirer.
 *
 * The `…ByInternetMessageId` lookups follow the same root deliberately, even
 * though a dropped `.msg` can come from the user's own mailbox: a miss there
 * is not fatal, it falls back to the local reader.
 */
export function createGraphOutlookMessageFetcher(
  acquireToken: AcquireScopedGraphToken,
  { owner }: { owner?: string | null } = {},
): OutlookMessageFetcher {
  const scopes = owner ? GRAPH_SHARED_MAIL_SCOPES : GRAPH_MAIL_SCOPES;
  const acquireMailToken: AcquireGraphToken = (options) =>
    acquireToken(scopes, options);
  return {
    fetchMessageBytes: (ewsItemId, options) =>
      fetchOutlookMessageBytesViaGraph(ewsItemId, acquireMailToken, {
        ...options,
        owner,
      }),
    fetchMessageFilesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageFilesByInternetMessageIdViaGraph(
        internetMessageId,
        acquireMailToken,
        { ...options, owner },
      ),
    fetchMessageBytesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageBytesByInternetMessageIdViaGraph(
        internetMessageId,
        acquireMailToken,
        { ...options, owner },
      ),
    fetchConversationMessages: (conversationId, options) =>
      fetchConversationMessagesViaGraph(conversationId, acquireMailToken, {
        ...options,
        owner,
      }),
    fetchParentMessageInConversation: (conversationId, options) =>
      fetchParentMessageInConversationViaGraph(
        conversationId,
        acquireMailToken,
        {
          ...options,
          owner,
        },
      ),
  };
}

/**
 * EWS SOAP backing (Exchange on-premises / Subscription Edition). Credentials
 * are acquired per operation inside the backend — host-issued callback tokens
 * (`getCallbackTokenAsync({ isRest: false })`) for the proxy transport, the
 * host itself for `makeEwsRequestAsync` — so no token parameter is needed here.
 */
export function createEwsOutlookMessageFetcher(): OutlookMessageFetcher {
  return {
    fetchMessageBytes: (ewsItemId, options) =>
      fetchOutlookMessageBytesViaEws(ewsItemId, options),
    fetchMessageFilesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageFilesByInternetMessageIdViaEws(
        internetMessageId,
        options,
      ),
    fetchMessageBytesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageBytesByInternetMessageIdViaEws(
        internetMessageId,
        options,
      ),
    fetchConversationMessages: (conversationId, options) =>
      fetchConversationMessagesViaEws(conversationId, options),
    fetchParentMessageInConversation: (conversationId, options) =>
      fetchParentMessageInConversationViaEws(conversationId, options),
  };
}
