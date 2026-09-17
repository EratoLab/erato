/* This file is generated from the canonical JSON schemas. Do not edit. */

export interface SearchMetadataFieldsV1Result {
  fields: {
    field: string;
    /**
     * @minItems 1
     */
    operators: [string, ...string[]];
    type: string;
    description: string;
    /**
     * @minItems 1
     */
    applicable_kinds: [string, ...string[]];
  }[];
}
