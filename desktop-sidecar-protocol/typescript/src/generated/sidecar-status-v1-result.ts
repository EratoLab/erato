/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SidecarStatusV1Result {
  /**
   * Extensible permission keys. macos_full_disk_access is the first key. Status is best effort; unknown means the platform could not determine access.
   */
  permissions: {
    [k: string]: "granted" | "not_granted" | "unknown" | "not_appliccable_different_platform";
  };
  /**
   * The deployment's desktop UI package (package 0.1.47): whether the sidecar has installed the package the backend serves, is still checking, downloading or receiving it, or failed, and whether the calling client may relay it with sidecar.install_ui_package.v1. Null until a configure call delivered a valid ui_package in this sidecar process. Absent from sidecars that host no desktop UI and from sidecars built before 0.1.47.
   */
  ui_package?: {
    /**
     * current, pending or failed (section 11 of SPEC.md); clients treat an unknown value as pending.
     */
    state: string;
    digest: string;
    /**
     * With failed: network, proxy, tls, unauthorized, not_found, verification, storage or other; clients treat an unknown value as other.
     */
    reason?: string;
    attempted_at: string | null;
    relay: boolean;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}
