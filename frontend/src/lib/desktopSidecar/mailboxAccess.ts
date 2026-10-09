/* eslint-disable lingui/no-unlocalized-strings -- Protocol values and model-facing errors. */
import { storeName } from "./outlookStores";

import type {
  DesktopSidecarClient,
  OutlookConversationWarning,
  OutlookGetConversationV1Params,
  OutlookMailbox,
} from "@erato/desktop-sidecar-protocol";

/** Outlook RPCs use compact mailbox IDs; the index uses UUID spelling. */
export function outlookMailboxId(id: string): string {
  const compact = id.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    throw new Error("Invalid local Outlook mailbox ID.");
  }
  return compact;
}

/** Never guess a mailbox: the add-in must retain its own/shared mailbox scope. */
export async function resolveSidecarMailbox(
  client: DesktopSidecarClient,
  emailAddress: string,
  signal?: AbortSignal,
): Promise<OutlookMailbox | null> {
  const { mailboxes } = await client.invoke(
    "outlook.list_mailboxes.v1",
    {},
    { signal },
  );
  const target = emailAddress.trim().toLowerCase();
  return (
    mailboxes.find(
      (mailbox) => mailbox.emailAddress?.trim().toLowerCase() === target,
    ) ?? null
  );
}

export async function resolveSidecarMailboxId(
  client: DesktopSidecarClient,
  emailAddress: string,
  signal?: AbortSignal,
): Promise<string | null> {
  return (
    (await resolveSidecarMailbox(client, emailAddress, signal))?.id ?? null
  );
}

/**
 * The sidecar produced no messages for a conversation. Retrying the same
 * anchor cannot help; `code` says why.
 */
export class SidecarConversationUnavailableError extends Error {
  readonly code: "unsupported_source" | "no_messages";
  readonly state: string;
  readonly warnings: OutlookConversationWarning[];

  constructor(
    code: SidecarConversationUnavailableError["code"],
    message: string,
    result: { state: string; warnings?: OutlookConversationWarning[] },
  ) {
    super(message);
    this.name = "SidecarConversationUnavailableError";
    this.code = code;
    this.state = result.state;
    this.warnings = result.warnings ?? [];
  }
}

export const NO_CONVERSATION_MESSAGES =
  "The local mailbox has no message with this Message-ID. Use get_sidecar_document with the search hit's documentId instead; do not retry this anchor.";

export async function readSidecarConversation(
  client: DesktopSidecarClient,
  params: OutlookGetConversationV1Params,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const result = await client.invoke(
    "outlook.get_conversation.v1",
    { ...params, mailboxId: outlookMailboxId(params.mailboxId) },
    { signal },
  );
  if (result.messages.length === 0) {
    if (
      result.warnings?.some((warning) => warning.code === "unsupported_source")
    ) {
      const store = storeName(result.mailbox?.source);
      throw new SidecarConversationUnavailableError(
        "unsupported_source",
        `Conversation reading isn't available for this mailbox${store ? ` (${store})` : ""}. Use get_sidecar_document with the search hit's documentId instead. Do not retry read_sidecar_conversation for this mailbox.`,
        result,
      );
    }
    throw new SidecarConversationUnavailableError(
      "no_messages",
      NO_CONVERSATION_MESSAGES,
      result,
    );
  }
  return result;
}
