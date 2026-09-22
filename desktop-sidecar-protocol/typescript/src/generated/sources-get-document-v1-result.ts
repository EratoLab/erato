/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.
 */
export type DocumentExternalIds = {
  key: string;
  value: string;
}[];

export interface SourcesGetDocumentV1Result {
  filename: string;
  mimeType: string;
  contentBase64: string;
  external_ids?: DocumentExternalIds;
  topLevelParent?: TopLevelParent;
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
}
