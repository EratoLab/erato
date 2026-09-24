/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalJobClaims {
  iss: string;
  aud: "erato-local-job-v1";
  sub: string;
  origin: string;
  binding: LocalTaskBinding;
  jti: string;
  iat: number;
  exp: number;
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
