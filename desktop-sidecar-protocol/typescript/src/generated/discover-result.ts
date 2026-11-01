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
   * Opaque security declaration. Unknown profiles remain discoverable but cannot enable delegation or legacy content access.
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
