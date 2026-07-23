/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * An extensible configuration layer. Unknown properties must be accepted and preserved.
 */
export interface SidecarConfiguration {
  /**
   * Whether the sidecar should show its system tray icon. Null leaves the decision to the other configuration layer or the sidecar default.
   */
  show_tray_icon?: boolean | null;
  [k: string]: unknown;
}
