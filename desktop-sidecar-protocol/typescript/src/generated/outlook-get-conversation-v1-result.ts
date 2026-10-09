/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
  [k: string]: unknown;
}[];

/**
 * The messages of the anchored conversation, oldest first, with bodies and attachment bytes carried inline.
 */
export interface OutlookGetConversationV1Result {
  /**
   * Completeness of the conversation. ok means every message and byte reference was produced; partial means some were omitted (see warnings), for example because maxMessages was reached or an attachment could not be read.
   */
  state: string;
  mailbox?: OutlookMailbox;
  messages: OutlookConversationMessage[];
  warnings?: OutlookConversationWarning[];
  [k: string]: unknown;
}
/**
 * A mailbox or message store available through the local Outlook installation.
 */
export interface OutlookMailbox {
  /**
   * Short opaque mailbox identifier. It is unique for the current sidecar runtime and logically stable across restarts while the Outlook profile and store identity remain unchanged.
   */
  id: string;
  displayName: string;
  emailAddress?: string;
  /**
   * Name of the Outlook profile containing this mailbox. Omitted when the platform or standalone store has no profile concept.
   */
  profileName?: string;
  /**
   * Implementation-defined local Outlook storage source. Known values include pst, ost, macOsProfile, macOsHxAccount (new Outlook for Mac), and windowsNewOutlook (new Outlook for Windows).
   */
  source: string;
  /**
   * IDs of this mailbox's sources in sources.list.v1. Older sidecars omit it.
   *
   * @maxItems 1024
   */
  sourceIds?: string[];
  capabilities?: SourceCapabilities;
  [k: string]: unknown;
}
/**
 * What the sidecar can deliver for one source or mailbox today. An absent object or an absent member means unknown, as from an older sidecar; clients then keep their previous behavior.
 */
export interface SourceCapabilities {
  /**
   * outlook.get_conversation.v1 can read this source's conversations.
   */
  conversations?: boolean;
  /**
   * Email attachments are known, indexed and exportable for this source.
   */
  attachments?: boolean;
  /**
   * sources.get_folder_hierarchy.v1 returns this source's real folder tree.
   */
  folders?: boolean;
  /**
   * To, Cc and Bcc recipients are known for this source's emails, so recipient filters can match them.
   */
  recipients?: boolean;
  /**
   * Documents carry identifiers that let a local Outlook open them.
   */
  openInOutlook?: boolean;
  /**
   * complete when sources.get_document.v1 exports the full stored content; cachedOnly when it can export only what the application cached on this device, so some documents fail with missing_from_local_cache. Extensible; clients treat unknown values as cachedOnly.
   */
  documentExport?: string;
  /**
   * Names from search.metadata_fields.v1 that this source fills. A filter on any other field cannot match this source's documents.
   *
   * @maxItems 512
   */
  metadataFields?: string[];
  [k: string]: unknown;
}
/**
 * One message of an Outlook conversation, with its body and attachment bytes carried inline.
 */
export interface OutlookConversationMessage {
  internetMessageId?: string;
  subject?: string;
  from?: OutlookMessageRecipient;
  to?: OutlookMessageRecipient[];
  cc?: OutlookMessageRecipient[];
  /**
   * UTC Unix timestamp in whole seconds.
   */
  sentAtUnixSeconds?: number;
  /**
   * UTC Unix timestamp in whole seconds.
   */
  receivedAtUnixSeconds?: number;
  /**
   * True when the message is an unsent draft.
   */
  isDraft?: boolean;
  /**
   * Lowercase hex PidTagConversationIndex; its embedded GUID groups the thread.
   */
  conversationIndex?: string;
  body?: OutlookMessageBody;
  attachments: OutlookAttachmentReference[];
  external_ids?: DocumentExternalIds;
  [k: string]: unknown;
}
/**
 * One recipient of an Outlook message.
 */
export interface OutlookMessageRecipient {
  /**
   * Display name, when present.
   */
  name?: string;
  /**
   * SMTP address. Omitted when only a non-routable Exchange address is stored locally.
   */
  emailAddress?: string;
  [k: string]: unknown;
}
/**
 * A message body carried inline in the JSON-RPC result. The sidecar decodes the stored bytes to text using the message code page before sending.
 */
export interface OutlookMessageBody {
  /**
   * Media type of the body, for example text/html or text/plain.
   */
  contentType: string;
  /**
   * The decoded body text.
   */
  content: string;
  [k: string]: unknown;
}
/**
 * Metadata and inline bytes for one attachment. When the bytes are available they are base64-encoded in contentBytes; otherwise unavailableReason explains why.
 */
export interface OutlookAttachmentReference {
  /**
   * File name, when present.
   */
  name?: string;
  /**
   * Media type of the bytes. Embedded messages are reported as message/rfc822.
   */
  contentType?: string;
  /**
   * Exact length of the attachment bytes.
   */
  size?: number;
  /**
   * True when the attachment is referenced from the message body by contentId.
   */
  isInline?: boolean;
  /**
   * Content-ID for an inline attachment, without angle brackets.
   */
  contentId?: string;
  /**
   * Lowercase hex SHA-256 of the attachment bytes, useful for de-duplicating attachments repeated across thread messages.
   */
  sha256?: string;
  /**
   * Base64-encoded attachment bytes, present when the bytes are available.
   */
  contentBytes?: string;
  /**
   * Stable code explaining why bytes are not available, present instead of contentBytes. Known values include unsupported_attachment.
   */
  unavailableReason?: string;
  external_ids?: DocumentExternalIds;
  topLevelParent?: TopLevelParent;
  [k: string]: unknown;
}
/**
 * The outermost containing document, never a folder. External IDs belong to that parent, not to the attachment.
 */
export interface TopLevelParent {
  /**
   * Catalog UUID, when indexed; can be passed to sources.get_document.v1.
   */
  documentId?: string;
  external_ids: DocumentExternalIds;
  [k: string]: unknown;
}
/**
 * A part of a conversation that could not be represented fully, without hiding the rest.
 */
export interface OutlookConversationWarning {
  /**
   * Stable machine-readable warning code. Known values include truncated, attachment_unavailable, embedded_attachments_omitted, body_preview_only, body_unavailable, body_truncated, and unsupported_source. body_preview_only means the message's body is only the preview its application cached. unsupported_source means the mailbox's store cannot be read as conversations at all: the result has no messages and retrying cannot help.
   */
  code: string;
  message?: string;
  /**
   * The message the warning is about, when it is message-scoped.
   */
  internetMessageId?: string;
  [k: string]: unknown;
}
