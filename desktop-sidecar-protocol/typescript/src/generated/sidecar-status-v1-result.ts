/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SidecarStatusV1Result {
  /**
   * Extensible permission keys. macos_full_disk_access is the first key. Status is best effort; unknown means the platform could not determine access.
   */
  permissions: {
    [k: string]: "granted" | "not_granted" | "unknown" | "not_appliccable_different_platform";
  };
  [k: string]: unknown;
}
