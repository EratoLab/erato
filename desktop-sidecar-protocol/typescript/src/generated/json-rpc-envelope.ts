/* This file is generated from the canonical JSON schemas. Do not edit. */

export type JsonRpcEnvelope = Request | Notification | SuccessResponse | ErrorResponse;

export interface Request {
  jsonrpc: "2.0";
  method: string;
  params?:
    | {
        [k: string]: unknown;
      }
    | unknown[];
  id: string | number;
  "x-erato-deadline-at"?: string;
  [k: string]: unknown;
}
export interface Notification {
  jsonrpc: "2.0";
  method: string;
  params?:
    | {
        [k: string]: unknown;
      }
    | unknown[];
  [k: string]: unknown;
}
export interface SuccessResponse {
  jsonrpc: "2.0";
  result: unknown;
  id: string | number;
  [k: string]: unknown;
}
export interface ErrorResponse {
  jsonrpc: "2.0";
  error: JsonRpcError;
  id: (string | number) | null;
  [k: string]: unknown;
}
export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
  [k: string]: unknown;
}
