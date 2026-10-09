/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SourcesListV1Result {
  sources: SourceDescriptor[];
  [k: string]: unknown;
}
export interface SourceDescriptor {
  sourceId: string;
  sourceKind: string;
  sourceKey: string;
  /**
   * Human-readable source name for direct presentation. Older sidecars may omit it.
   */
  displayName?: string;
  /**
   * Effective persisted indexing policy for this source, independent of scheduler activity or scan health. Older sidecars may omit it.
   */
  indexingEnabled?: boolean;
  /**
   * Effective indexing priority for this source, from its user or organization policy or else the source default; lower runs first. Clients that show or write a priority for a source without a policy use this value. Older sidecars may omit it.
   */
  indexingPriority?: number;
  /**
   * Stable product family, such as outlook or teams. Older sidecars may omit it; values are extensible.
   */
  product?: string;
  /**
   * Product variant inferred from the discovered store/source type, such as outlook_classic. Older sidecars may omit it; values are extensible.
   */
  product_variant?: string;
  /**
   * Teams sources only: the signed-in Teams identity (one tenant as one user) that this source indexes. Several identities can share one Teams cache, including guest identities of the same person in other tenants. Older sidecars and other source kinds omit it.
   */
  account?: {
    tenantId: string;
    userId: string;
    displayName?: string | null;
    /**
     * Lowercase address identifying the person across tenants and mail; a guest identity carries its home address.
     */
    email?: string | null;
    userPrincipalName?: string | null;
    tenantName?: string | null;
    /**
     * Member or Guest, as reported by Teams.
     */
    userType?: string | null;
    [k: string]: unknown;
  };
  /**
   * Whether the source is indexed when no user or organization policy names it. Older sidecars omit it.
   */
  defaultEnabled?: boolean;
  /**
   * Why the source has its default: workAccount, otherAccount, guestAccount, outlookDefault, notOutlookDefault, onlyTeamsAccount or noWorkAccount. Extensible; older sidecars omit it.
   */
  defaultReason?: string;
  capabilities?: SourceCapabilities;
  locator: {
    [k: string]: unknown;
  };
  /**
   * Existing catalog source-enabled flag. It is distinct from effective persisted indexing policy in indexingEnabled.
   */
  enabled: boolean;
  discoveryCursor: {
    [k: string]: unknown;
  } | null;
  completedScanId: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
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
