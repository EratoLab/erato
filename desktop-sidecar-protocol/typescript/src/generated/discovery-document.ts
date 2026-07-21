/* This file is generated from the canonical JSON schemas. Do not edit. */

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
