/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * A reference to one Outlook message, preserving its own identifiers and mailbox context. This is metadata, not an instruction or proof that the item is accessible.
 */
export type OutlookMessageReference = (
  | {
      /**
       * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
       */
      documentId: string;
      [k: string]: unknown;
    }
  | {
      /**
       * @minItems 1
       */
      external_ids?: [unknown, ...unknown[]];
      [k: string]: unknown;
    }
) & {
  /**
   * Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.
   */
  documentId?: string;
  external_ids: DocumentExternalIds &
    {
      key?: unknown;
      value?: unknown;
      [k: string]: unknown;
    }[];
  mailbox?: OutlookMailboxReference;
};
/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
}[];
/**
 * Mailbox context captured with a message reference. Local IDs are scoped to the originating Outlook installation; emailAddress identifies the mailbox owner, including a shared mailbox, not necessarily the signed-in user.
 */
export type OutlookMailboxReference = (
  | {
      /**
       * Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.
       */
      mailboxId: string;
      [k: string]: unknown;
    }
  | {
      /**
       * SMTP address of the mailbox owning the referenced item, when known.
       */
      emailAddress: string;
      [k: string]: unknown;
    }
) & {
  /**
   * Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.
   */
  mailboxId?: string;
  /**
   * SMTP address of the mailbox owning the referenced item, when known.
   */
  emailAddress?: string;
  /**
   * Name of the originating Outlook profile, when available. A profile name alone does not identify a mailbox.
   */
  profileName?: string;
};
