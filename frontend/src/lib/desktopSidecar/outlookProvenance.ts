/* eslint-disable lingui/no-unlocalized-strings -- Protocol identity keys. */
import { outlookMailboxId } from "./mailboxAccess";

import type {
  OutlookFileProvenance,
  OutlookMailboxReference,
  OutlookMessageReference,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";

type ExternalIds = OutlookMessageReference["external_ids"];
type SourceIdentity = { documentId?: string; external_ids?: ExternalIds };

/** Metadata comes from validated sidecar responses, never model-supplied IDs. */
export function outlookMailboxReference(mailbox: {
  id: string;
  emailAddress?: string | null;
  profileName?: string | null;
}): OutlookMailboxReference {
  return {
    mailboxId: outlookMailboxId(mailbox.id),
    ...(mailbox.emailAddress ? { emailAddress: mailbox.emailAddress } : {}),
    ...(mailbox.profileName ? { profileName: mailbox.profileName } : {}),
  };
}

export function outlookMessageReference(
  source: SourceIdentity,
  mailbox?: OutlookMailboxReference,
  internetMessageId?: string | null,
): OutlookMessageReference | undefined {
  const external_ids = [...(source.external_ids ?? [])];
  if (
    internetMessageId &&
    !external_ids.some((id) => id.key === "email_message_id")
  ) {
    external_ids.push({ key: "email_message_id", value: internetMessageId });
  }
  if (!source.documentId && !external_ids.length) return undefined;
  return {
    ...(source.documentId ? { documentId: source.documentId } : {}),
    external_ids,
    ...(mailbox ? { mailbox } : {}),
  };
}

export function outlookFileProvenance(
  document?: OutlookMessageReference,
  topLevelParent?: OutlookMessageReference,
): OutlookFileProvenance | undefined {
  if (!document && !topLevelParent) return undefined;
  return {
    version: 1,
    origins: [
      {
        ...(document ? { document } : {}),
        ...(topLevelParent ? { topLevelParent } : {}),
      },
    ],
  };
}

/** Only actual mail identities make an attachment a message in its own right. */
export function hasMessageIdentity(source: SourceIdentity): boolean {
  return Boolean(
    source.external_ids?.some((id) =>
      ["ews_id", "email_message_id", "outlook_entry_id"].includes(id.key),
    ),
  );
}
