/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalTaskStatus {
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
