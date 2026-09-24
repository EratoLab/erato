/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalExportReceiptClaims {
  iss: string;
  aud: "erato-local-export-receipt-v1";
  binding: LocalTaskBinding;
  exportId: string;
  manifestDigest: string;
  receiptId: string;
  acceptedAt: number;
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
}
