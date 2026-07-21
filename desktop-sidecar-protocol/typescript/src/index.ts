export {
  DesktopSidecarClient,
  MAX_BODY_BYTES,
  PROTOCOL_VERSIONS,
  createBrowserClientInfo,
  type DesktopSidecarClientOptions,
  type InvokeOptions,
  type SidecarCapability,
  type SidecarClientInfo,
  type SidecarReadinessState,
  type SidecarMethodContract,
  type SidecarSnapshot,
} from "./client.js";
export {
  SidecarClientError,
  SidecarRpcError,
  type SidecarClientErrorKind,
} from "./errors.js";
export {
  HttpTransport,
  type HttpTransportOptions,
  type SidecarFetch,
  type SidecarTransport,
  type SidecarTransportRequestOptions,
} from "./transport.js";
export type {
  CapabilityDescriptor,
  CancelParams,
  CancelResult,
  DiagnosticsEchoV1Params,
  DiagnosticsEchoV1Result,
  DiscoverParams,
  DiscoverResult,
  DiscoveryDocument,
  JsonRpcEnvelope,
  ProtocolErrorData,
} from "./generated/index.js";
