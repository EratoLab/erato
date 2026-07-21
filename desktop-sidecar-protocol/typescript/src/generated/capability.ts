/* This file is generated from the canonical JSON schemas. Do not edit. */

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
