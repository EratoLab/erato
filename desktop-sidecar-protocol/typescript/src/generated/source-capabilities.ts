/* This file is generated from the canonical JSON schemas. Do not edit. */

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
