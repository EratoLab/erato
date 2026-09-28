/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalExportsStatusV1Result {
  handle: string;
  state:
    | "queued"
    | "running"
    | "ready_for_review"
    | "approved"
    | "acknowledged"
    | "declined"
    | "cancelled"
    | "expired"
    | "failed";
}
