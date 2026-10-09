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
  /**
   * Why a method that reads a source's content could not produce it: document_not_found, missing_from_local_cache, source_changed, unsupported_source or export_too_large. Extensible; clients treat unknown values like an absent field.
   */
  sourceError?: string;
  requestId?: string | number;
  [k: string]: unknown;
}
