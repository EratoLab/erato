/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface DiscoverResult {
  protocolVersion: string;
  serverInfo: ProductInfo;
  instanceId: string;
  /**
   * Opaque id of this sidecar installation for the current OS user profile: the same for every page and every restart, different on another computer or user profile. Routing identity for Erato clients, not a credential. Absent from sidecars built before package 0.1.43.
   */
  installationId?: string;
  document: DiscoveryDocument;
  /**
   * Whether this sidecar runs in strict mode, as installed by its bootstrap; configuration never sets or relaxes it. Absent from sidecars built before package 0.1.44.
   */
  strict?: boolean;
  jobs?: JobsCapability;
  /**
   * The providers whose tools `jobs.start.v1` accepts. Absent from sidecars built before package 0.1.44.
   */
  providers?: ToolProvider[];
  /**
   * Transitional security declaration of the deprecated local_* strict path. Unknown profiles remain discoverable but cannot enable delegation or legacy content access.
   */
  localDelegation?: {
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface ProductInfo {
  name: string;
  version: string;
  [k: string]: unknown;
}
export interface DiscoveryDocument {
  openrpc: string;
  info: {
    title: string;
    version: string;
    [k: string]: unknown;
  };
  methods: {
    name: string;
    params: unknown[];
    result: {
      [k: string]: unknown;
    };
    "x-erato-capability"?: CapabilityDescriptor;
    [k: string]: unknown;
  }[];
  "x-erato-catalogue": CatalogueIdentity;
  [k: string]: unknown;
}
export interface CapabilityDescriptor {
  id: string;
  major: number;
  method: string;
  availability:
    | {
        state: "enabled";
        [k: string]: unknown;
      }
    | {
        state: "disabled";
        reasonCode: string;
        [k: string]: unknown;
      }
    | {
        state: string;
        [k: string]: unknown;
      };
  [k: string]: unknown;
}
export interface CatalogueIdentity {
  revision: string;
  digest: string;
  [k: string]: unknown;
}
/**
 * Present in discovery when the sidecar runs tool calls through the jobs.* envelope, with its limits: the most calls one job carries and the longest `wait_ms` it honors. Absent from sidecars built before package 0.1.44; clients then use the direct RPCs.
 */
export interface JobsCapability {
  maxCalls: number;
  maxWaitMs: number;
  [k: string]: unknown;
}
/**
 * A provider whose tools this sidecar runs as jobs.
 */
export interface ToolProvider {
  id: string;
  tools: string[];
  readOnly: boolean;
  /**
   * Whether the provider's tools reach beyond this device: `none` or `open_world`. Open vocabulary; a client treats any other value as `open_world`.
   */
  egress: string;
  /**
   * False when the provider cannot run calls at all. A refusal of one tool, such as a content tool under stage-1 strict mode, is a per-call error instead.
   */
  available: boolean;
  [k: string]: unknown;
}
