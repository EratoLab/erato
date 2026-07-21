export type SidecarClientErrorKind =
  | "aborted"
  | "capability_unavailable"
  | "incompatible_protocol"
  | "invalid_params"
  | "invalid_result"
  | "malformed_message"
  | "permission_denied"
  | "remote_error"
  | "request_cancelled"
  | "sidecar_internal"
  | "timeout"
  | "transport_error";

export class SidecarClientError extends Error {
  readonly kind: SidecarClientErrorKind;
  readonly cause?: unknown;

  constructor(
    kind: SidecarClientErrorKind,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message);
    this.name = "SidecarClientError";
    this.kind = kind;
    this.cause = options.cause;
  }
}

export class SidecarRpcError extends SidecarClientError {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(remoteErrorKind(code, data), message);
    this.name = "SidecarRpcError";
    this.code = code;
    this.data = data;
  }
}

const knownKinds = new Set<SidecarClientErrorKind>([
  "capability_unavailable",
  "incompatible_protocol",
  "invalid_result",
  "permission_denied",
  "request_cancelled",
  "sidecar_internal",
  "timeout",
]);

function remoteErrorKind(code: number, data: unknown): SidecarClientErrorKind {
  if (code === -32602) return "invalid_params";
  if (data && typeof data === "object" && "kind" in data) {
    const kind = (data as { kind?: unknown }).kind;
    if (
      typeof kind === "string" &&
      knownKinds.has(kind as SidecarClientErrorKind)
    ) {
      return kind as SidecarClientErrorKind;
    }
  }
  return "remote_error";
}
