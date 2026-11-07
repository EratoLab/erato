/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * One chunk of the deployment's desktop UI package archive, relayed by the client after the sidecar's own download failed for a network, proxy or TLS reason (package 0.1.47). Every chunk but the last carries exactly 131072 bytes; chunk_count is ceil(total_bytes / 131072).
 */
export interface SidecarInstallUiPackageV1Params {
  /**
   * Chosen by the client for one pass over one archive's bytes, the same for all its chunks; a random UUID. The sidecar assembles only one upload at a time.
   */
  upload_id: string;
  /**
   * The package digest, equal to the digest the calling Origin last offered with sidecar.configure.v1.
   */
  digest: string;
  total_bytes: number;
  chunk_index: number;
  chunk_count: number;
  /**
   * The chunk's bytes, RFC 4648 base64 with padding.
   */
  content_base64: string;
  [k: string]: unknown;
}
