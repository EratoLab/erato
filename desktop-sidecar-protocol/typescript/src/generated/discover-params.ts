/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface DiscoverParams {
  /**
   * @minItems 1
   */
  protocolVersions: [string, ...string[]];
  clientInfo: ProductInfo;
  host: {
    application: string;
    applicationVersion?: string;
    runtime: string;
    runtimeVersion?: string;
    [k: string]: unknown;
  };
  os: {
    name: string;
    version?: string;
    architecture?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
export interface ProductInfo {
  name: string;
  version: string;
  [k: string]: unknown;
}
