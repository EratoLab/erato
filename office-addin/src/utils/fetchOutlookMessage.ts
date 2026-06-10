import {
  fetchConversationMessagesViaGraph,
  fetchOutlookMessageBytesByInternetMessageIdViaGraph,
  fetchOutlookMessageBytesViaGraph,
  fetchOutlookMessageFilesByInternetMessageIdViaGraph,
  fetchParentMessageInConversationViaGraph,
} from "./fetchOutlookMessageGraph";
import {
  fetchConversationMessagesViaRestV2,
  fetchOutlookMessageBytesByInternetMessageIdViaRestV2,
  fetchOutlookMessageBytesViaRestV2,
  fetchOutlookMessageFilesByInternetMessageIdViaRestV2,
  fetchParentMessageInConversationViaRestV2,
} from "./fetchOutlookMessageRestV2";

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
 * Environment dispatcher for Outlook message fetching (ERMAIN-353).
 *
 * The add-in talks to exactly one of two mutually exclusive mail backends,
 * selected by where the mailbox lives (NOT by auth mode — SE and EXO both
 * authenticate via Entra):
 *
 *   - Cloud mailbox (Exchange Online): Microsoft Graph with a `Mail.Read`
 *     token from MSAL. Outlook REST v2.0 is NOT an option there — legacy
 *     callback tokens were shut off for all Microsoft 365 tenants in
 *     October 2025.
 *   - On-prem mailbox (Exchange on-premises / Subscription Edition): the
 *     Exchange server's own Outlook REST v2.0 endpoint
 *     (`Office.context.mailbox.restUrl`) with a
 *     `getCallbackTokenAsync({ isRest: true })` token. Microsoft Graph does
 *     not exist for on-prem mailboxes.
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
   * Raw RFC822 MIME of a message by its EWS item id (converted to a REST id
   * internally). Throws on HTTP failure.
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

/**
 * Microsoft Graph backing (Exchange Online). Thin delegation to the existing
 * Graph functions — EXO behavior is byte-identical to the pre-seam direct
 * calls. `acquireToken` is expected to be bound to the `Mail.Read` scope.
 */
export function createGraphOutlookMessageFetcher(
  acquireToken: AcquireGraphToken,
): OutlookMessageFetcher {
  return {
    fetchMessageBytes: (ewsItemId, options) =>
      fetchOutlookMessageBytesViaGraph(ewsItemId, acquireToken, options),
    fetchMessageFilesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageFilesByInternetMessageIdViaGraph(
        internetMessageId,
        acquireToken,
        options,
      ),
    fetchMessageBytesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageBytesByInternetMessageIdViaGraph(
        internetMessageId,
        acquireToken,
        options,
      ),
    fetchConversationMessages: (conversationId, options) =>
      fetchConversationMessagesViaGraph(conversationId, acquireToken, options),
    fetchParentMessageInConversation: (conversationId, options) =>
      fetchParentMessageInConversationViaGraph(
        conversationId,
        acquireToken,
        options,
      ),
  };
}

/**
 * Outlook REST v2.0 backing (Exchange on-premises). Callback tokens are
 * acquired per operation from the Office host, so no token parameter is
 * needed here.
 */
export function createRestV2OutlookMessageFetcher(): OutlookMessageFetcher {
  return {
    fetchMessageBytes: (ewsItemId, options) =>
      fetchOutlookMessageBytesViaRestV2(ewsItemId, options),
    fetchMessageFilesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageFilesByInternetMessageIdViaRestV2(
        internetMessageId,
        options,
      ),
    fetchMessageBytesByInternetMessageId: (internetMessageId, options) =>
      fetchOutlookMessageBytesByInternetMessageIdViaRestV2(
        internetMessageId,
        options,
      ),
    fetchConversationMessages: (conversationId, options) =>
      fetchConversationMessagesViaRestV2(conversationId, options),
    fetchParentMessageInConversation: (conversationId, options) =>
      fetchParentMessageInConversationViaRestV2(conversationId, options),
  };
}
