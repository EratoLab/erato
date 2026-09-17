/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SearchQueryV1Params {
  text?: string;
  limit?: number;
  metadata_filters?: SearchMetadataFilter[];
  filters?: {
    sender?: string;
    sourceId?: string;
    mailboxId?: string;
    dateFrom?: number;
    dateTo?: number;
    fileType?: string;
    kind?: "email" | "file";
  };
}
export interface SearchMetadataFilter {
  field: string;
  operator: string;
  value: unknown;
}
