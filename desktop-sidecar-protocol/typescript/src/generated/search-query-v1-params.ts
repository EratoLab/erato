/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SearchQueryV1Params {
  text?: string;
  limit?: number;
  filters?: {
    sender?: string;
    mailboxId?: string;
    dateFrom?: number;
    dateTo?: number;
    fileType?: string;
    kind?: "email" | "file";
  };
}
