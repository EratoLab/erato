/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface ApprovedLocalExport {
  binding: LocalTaskBinding;
  exportId: string;
  snapshotId: string;
  grantId: string;
  manifestDigest: string;
  approvedAt: number;
  expiresAt: number;
  /**
   * @minItems 1
   * @maxItems 20
   */
  artifacts: [
    {
      artifactId: string;
      filename: string;
      mediaType: "text/plain" | "message/rfc822" | "application/octet-stream" | "application/json" | "application/pdf";
      sha256: string;
      byteLength: number;
      contentBase64: string;
      [k: string]: unknown;
    },
    ...{
      artifactId: string;
      filename: string;
      mediaType: "text/plain" | "message/rfc822" | "application/octet-stream" | "application/json" | "application/pdf";
      sha256: string;
      byteLength: number;
      contentBase64: string;
      [k: string]: unknown;
    }[],
  ];
  [k: string]: unknown;
}
export interface LocalTaskBinding {
  backendOrigin: string;
  accountId: string;
  deviceId: string;
  taskId: string;
  jobId: string;
  attemptId: string;
  toolCallId: string;
  planDigest: string;
  [k: string]: unknown;
}
