/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface ProtocolErrorData {
  kind:
    | "incompatible_protocol"
    | "capability_unavailable"
    | "invalid_result"
    | "permission_denied"
    | "request_cancelled"
    | "timeout"
    | "sidecar_internal";
  supportedProtocolVersions?: string[];
  method?: string;
  reasonCode?: string;
  requestId?: string | number;
  [k: string]: unknown;
}
