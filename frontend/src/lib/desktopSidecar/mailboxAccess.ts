import type {
  DesktopSidecarClient,
  OutlookGetConversationV1Params,
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
export async function resolveSidecarMailboxId(
  client: DesktopSidecarClient,
  emailAddress: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const { mailboxes } = await client.invoke(
    "outlook.list_mailboxes.v1",
    {},
    { signal },
  );
  const target = emailAddress.trim().toLowerCase();
  return (
    mailboxes.find(
      (mailbox) => mailbox.emailAddress?.trim().toLowerCase() === target,
    )?.id ?? null
  );
}

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
    throw new Error("The sidecar returned no messages for the anchor.");
  }
  return result;
}
