/* This file is generated from the canonical JSON schemas. Do not edit. */

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
