/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SidecarInstallUiPackageV1Result {
  /**
   * continue: send chunk next_chunk_index of this upload next. installed: the package with digest is installed; stop. busy: another upload, or the sidecar's own download, is in flight; retry later. refused: this upload is not accepted; reason says why; do not retry it. Clients treat an unknown value as refused.
   */
  state: string;
  /**
   * With continue.
   */
  next_chunk_index?: number;
  /**
   * With refused: not_offered, not_eligible, verification or storage. Clients treat an unknown value as final for this upload.
   */
  reason?: string;
  [k: string]: unknown;
}
