import type {
  DesktopSidecarClient,
  OutlookBodyHandle,
  OutlookConversationMessage,
  OutlookAttachmentReference,
  OutlookMessageRecipient,
} from "@erato/frontend/library";

import type { OutlookMessageFetcher } from "./fetchOutlookMessage";
import type {
  FetchConversationOptions,
  FetchConversationResult,
  GraphAttachment,
  GraphBody,
  GraphConversationMessage,
  GraphRecipient,
} from "./fetchOutlookMessageGraph";

const GET_CONVERSATION = "outlook.get_conversation.v1";
/** Max simultaneous transfer fetches, mirroring the Graph item-enrich guard. */
const TRANSFER_CONCURRENCY = 5;

export interface SidecarFetcherContext {
  /** The fetcher to delegate to for everything but conversation loading, and
   * to fall back to on any sidecar failure. */
  inner: OutlookMessageFetcher;
  client: DesktopSidecarClient;
  /** RFC 5322 Message-ID of the current item — the conversation anchor. */
  anchorInternetMessageId: string | null;
  /** The signed-in user's SMTP address, used to select the local mailbox. */
  userEmailAddress: string | null;
}

/**
 * Wrap an {@link OutlookMessageFetcher} so conversation loads go through the
 * desktop sidecar — whole thread plus any-size attachments read from the local
 * Outlook store — when it is available, bypassing the `makeEwsRequestAsync`
 * size caps that otherwise degrade Exchange SE threads to byte-less markers.
 *
 * Only `fetchConversationMessages` is overridden; every other capability
 * delegates unchanged. **Any** sidecar failure (unsupported, no mailbox match,
 * RPC/transfer error) falls back to the wrapped fetcher, so the result is never
 * worse than the EWS path alone.
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
      } catch {
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

  const messages = await mapWithConcurrency(
    conversation.messages,
    TRANSFER_CONCURRENCY,
    (message) => mapConversationMessage(client, message, signal),
  );

  return { messages, state: conversation.state === "ok" ? "ok" : "partial" };
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

async function mapConversationMessage(
  client: DesktopSidecarClient,
  message: OutlookConversationMessage,
  signal: AbortSignal | undefined,
): Promise<GraphConversationMessage> {
  const [body, attachments] = await Promise.all([
    mapBody(client, message.bodyHandle, signal),
    mapWithConcurrency(message.attachments, TRANSFER_CONCURRENCY, (attachment) =>
      mapAttachment(client, attachment, signal),
    ),
  ]);

  return {
    internetMessageId: message.internetMessageId,
    subject: message.subject,
    from: toGraphRecipient(message.from),
    toRecipients: toGraphRecipients(message.to),
    ccRecipients: toGraphRecipients(message.cc),
    sentDateTime: toIsoDate(message.sentAtUnixSeconds),
    receivedDateTime: toIsoDate(message.receivedAtUnixSeconds),
    isDraft: message.isDraft,
    body,
    attachments,
  };
}

async function mapBody(
  client: DesktopSidecarClient,
  bodyHandle: OutlookBodyHandle | undefined,
  signal: AbortSignal | undefined,
): Promise<GraphBody | undefined> {
  if (!bodyHandle) {
    return undefined;
  }
  const bytes = await client.fetchTransfer(bodyHandle.handle, { signal });
  return {
    contentType: bodyHandle.contentType.includes("html") ? "html" : "text",
    content: new TextDecoder().decode(bytes),
  };
}

async function mapAttachment(
  client: DesktopSidecarClient,
  attachment: OutlookAttachmentReference,
  signal: AbortSignal | undefined,
): Promise<GraphAttachment> {
  const base: GraphAttachment = {
    name: attachment.name,
    contentType: attachment.contentType,
    size: attachment.size,
    isInline: attachment.isInline,
    contentId: attachment.contentId,
  };
  if (!attachment.contentHandle) {
    return base;
  }
  const bytes = await client.fetchTransfer(attachment.contentHandle, { signal });
  return { ...base, contentBytes: bytesToBase64(bytes) };
}

function toGraphRecipients(
  recipients: readonly OutlookMessageRecipient[] | undefined,
): GraphRecipient[] | undefined {
  if (!recipients) {
    return undefined;
  }
  return recipients
    .map(toGraphRecipient)
    .filter((recipient): recipient is GraphRecipient => recipient !== undefined);
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const current = next++;
        results[current] = await map(items[current], current);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
