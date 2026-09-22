/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface LocalDelegationSecurity {
  profile: "strict_snapshot_v1";
  enforcement: "unavailable" | "enforced";
  contextAuthentication: "pinned_backend_assertion_v1";
  consent: "native_exact_snapshot";
  recovery: "durable_receipt_v1";
  trustModel: "installed_native_code";
}
