import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type {
  FetchConversationOptions,
  FetchConversationResult,
  GraphAttachment,
  GraphBody,
  GraphConversationMessage,
  GraphRecipient,
} from "./fetchOutlookMessageGraph";
import type {
  DesktopSidecarClient,
  OutlookMessageBody,
  OutlookConversationMessage,
  OutlookAttachmentReference,
  OutlookMessageRecipient,
} from "@erato/frontend/library";

const GET_CONVERSATION = "outlook.get_conversation.v1";
/** Discriminator that makes downstream treat a byte-less attachment as a plain
 * file with no retrievable content (an accurate disclosure marker). */
const FILE_ATTACHMENT_TYPE = "#microsoft.graph.fileAttachment";

export interface SidecarFetcherContext {
  /** The fetcher to delegate to for everything but conversation loading, and
   * to fall back to when the conversation itself can't be fetched. */
  inner: OutlookMessageFetcher;
  client: DesktopSidecarClient;
  /** RFC 5322 Message-ID of the current item — the conversation anchor. */
  anchorInternetMessageId: string | null;
  /** The signed-in user's SMTP address, used to select the local mailbox. */
  userEmailAddress: string | null;
}

/** Tracks whether any part of a conversation had to be degraded (an attachment
 * the sidecar could not read), so the result is reported as `partial`. */
interface ConversionProgress {
  partial: boolean;
}

/**
 * Wrap an {@link OutlookMessageFetcher} so conversation loads go through the
 * desktop sidecar — whole thread plus any-size attachments read from the local
 * Outlook store — when it is available, bypassing the `makeEwsRequestAsync`
 * size caps that otherwise degrade Exchange SE threads to byte-less markers.
 *
 * Only `fetchConversationMessages` is overridden; every other capability
 * delegates unchanged. The conversation itself failing (unsupported, no mailbox
 * match, RPC error) falls back to the wrapped fetcher, so the result is never
 * worse than the EWS path. The sidecar carries message bodies and attachment
 * bytes inline in the result; an attachment it could not read arrives with no
 * bytes, degrading just that item to a marker and marking the result `partial`
 * rather than discarding the whole thread.
 */
export function createSidecarOutlookMessageFetcher(
  context: SidecarFetcherContext,
): OutlookMessageFetcher {
  const { inner, client } = context;
  return {
    ...inner,
    fetchConversationMessages: async (conversationId, options) => {
      if (
        !client.supports(GET_CONVERSATION) ||
        !context.anchorInternetMessageId ||
        !context.userEmailAddress
      ) {
        return inner.fetchConversationMessages(conversationId, options);
      }
      try {
        return await fetchConversationViaSidecar(context, options);
      } catch (error) {
        if (options?.signal?.aborted) {
          throw error;
        }
        return inner.fetchConversationMessages(conversationId, options);
      }
    },
  };
}

async function fetchConversationViaSidecar(
  context: SidecarFetcherContext,
  options: FetchConversationOptions | undefined,
): Promise<FetchConversationResult> {
  const { client } = context;
  const anchorInternetMessageId = context.anchorInternetMessageId!;
  const userEmailAddress = context.userEmailAddress!;
  const signal = options?.signal;

  const mailboxId = await resolveMailboxId(client, userEmailAddress, signal);
  if (!mailboxId) {
    throw new Error("No local Outlook mailbox matches the signed-in user.");
  }

  const conversation = await client.invoke(
    GET_CONVERSATION,
    { mailboxId, anchor: { internetMessageId: anchorInternetMessageId } },
    { signal },
  );

  if (conversation.messages.length === 0) {
    // A conversation always contains at least its anchor, so an empty result
    // means the anchor Message-ID was not resolvable in the local store (a
    // format mismatch, or an item not yet synced to the OST). Fall back to EWS
    // rather than presenting an empty thread.
    throw new Error("The sidecar returned no messages for the anchor.");
  }

  const progress: ConversionProgress = { partial: conversation.state !== "ok" };
  const messages = conversation.messages.map((message) =>
    mapConversationMessage(message, progress),
  );

  return { messages, state: progress.partial ? "partial" : "ok" };
}

async function resolveMailboxId(
  client: DesktopSidecarClient,
  userEmailAddress: string,
  signal: AbortSignal | undefined,
): Promise<string | null> {
  const { mailboxes } = await client.invoke(
    "outlook.list_mailboxes.v1",
    {},
    { signal },
  );
  const target = userEmailAddress.trim().toLowerCase();
  const match = mailboxes.find(
    (mailbox) => mailbox.emailAddress?.trim().toLowerCase() === target,
  );
  return match?.id ?? null;
}

function mapConversationMessage(
  message: OutlookConversationMessage,
  progress: ConversionProgress,
): GraphConversationMessage {
  return {
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    from: toGraphRecipient(message.from),
    toRecipients: toGraphRecipients(message.to),
    ccRecipients: toGraphRecipients(message.cc),
    sentDateTime: toIsoDate(message.sentAtUnixSeconds),
    receivedDateTime: toIsoDate(message.receivedAtUnixSeconds),
    isDraft: message.isDraft,
    body: mapBody(message.body),
    attachments: message.attachments.map((attachment, index) =>
      mapAttachment(attachment, index, progress),
    ),
  };
}

function mapBody(body: OutlookMessageBody | undefined): GraphBody | undefined {
  if (!body) {
    return undefined;
  }
  return {
    contentType: body.contentType.includes("html") ? "html" : "text",
    content: body.content,
  };
}

function mapAttachment(
  attachment: OutlookAttachmentReference,
  index: number,
  progress: ConversionProgress,
): GraphAttachment {
  // A stable, unique id is required downstream — `transformAttachment` drops any
  // attachment without one. The sha256 is stable across re-fetch (so per-item
  // dismissal persists); the index disambiguates byte-identical siblings and
  // covers unavailable attachments that carry no hash.
  const base: GraphAttachment = {
    "@odata.type": FILE_ATTACHMENT_TYPE,
    id: attachment.sha256
      ? `${attachment.sha256}-${index}`
      : `sidecar-attachment-${index}`,
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    isInline: attachment.isInline,
    contentId: attachment.contentId,
  };
  if (attachment.contentBytes === undefined) {
    progress.partial = true;
    return base;
  }
  // The wire already carries base64, so it maps straight onto Graph's shape.
  return { ...base, contentBytes: attachment.contentBytes };
}

function toGraphRecipients(
  recipients: readonly OutlookMessageRecipient[] | undefined,
): GraphRecipient[] | undefined {
  if (!recipients) {
    return undefined;
  }
  return recipients
    .map(toGraphRecipient)
    .filter(
      (recipient): recipient is GraphRecipient => recipient !== undefined,
    );
}

function toGraphRecipient(
  recipient: OutlookMessageRecipient | undefined,
): GraphRecipient | undefined {
  if (!recipient || (!recipient.name && !recipient.emailAddress)) {
    return undefined;
  }
  return {
    emailAddress: { name: recipient.name, address: recipient.emailAddress },
  };
}

function toIsoDate(unixSeconds: number | undefined): string | undefined {
  return unixSeconds === undefined
    ? undefined
    : new Date(unixSeconds * 1000).toISOString();
}
