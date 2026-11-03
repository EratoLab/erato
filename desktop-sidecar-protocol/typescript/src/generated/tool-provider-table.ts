/* This file is generated from the canonical JSON schemas. Do not edit. */

/**
 * The closed tool enumeration of a built-in provider: each tool, the RPC methods whose work it composes, and what strict review selects from its result.
 */
export interface ToolProviderTable {
  id: string;
  readOnly: boolean;
  egress: string;
  /**
   * @minItems 1
   */
  tools: [
    {
      name: string;
      /**
       * @minItems 1
       */
      methods: [string, ...string[]];
      readOnly: boolean;
      /**
       * What strict review offers for selection, or null when the result is account-level and needs no review.
       */
      selection: null | {
        /**
         * A JSON pointer to the array of reviewable items in `structuredContent`, or `content` for the result's content blocks.
         */
        items: string;
        /**
         * JSON pointers into `structuredContent` to result-level, account-level metadata that accompanies the approved items. Everything else in `structuredContent` crosses only with the item it belongs to.
         */
        resultMetadata: string[];
        /**
         * Arrays in `structuredContent` whose entries each concern the whole result or one item. An entry without the `itemKey` field is result-level and crosses with the approved items; an entry with it crosses only when an approved item has the same value under that key. An entry crosses as its `code` and that key, with a fixed message for the code.
         */
        itemMetadata?: {
          /**
           * A JSON pointer to the array in `structuredContent`.
           */
          pointer: string;
          /**
           * The field an entry and an item share when the entry concerns that item.
           */
          itemKey: string;
          [k: string]: unknown;
        }[];
        [k: string]: unknown;
      };
      [k: string]: unknown;
    },
    ...{
      name: string;
      /**
       * @minItems 1
       */
      methods: [string, ...string[]];
      readOnly: boolean;
      /**
       * What strict review offers for selection, or null when the result is account-level and needs no review.
       */
      selection: null | {
        /**
         * A JSON pointer to the array of reviewable items in `structuredContent`, or `content` for the result's content blocks.
         */
        items: string;
        /**
         * JSON pointers into `structuredContent` to result-level, account-level metadata that accompanies the approved items. Everything else in `structuredContent` crosses only with the item it belongs to.
         */
        resultMetadata: string[];
        /**
         * Arrays in `structuredContent` whose entries each concern the whole result or one item. An entry without the `itemKey` field is result-level and crosses with the approved items; an entry with it crosses only when an approved item has the same value under that key. An entry crosses as its `code` and that key, with a fixed message for the code.
         */
        itemMetadata?: {
          /**
           * A JSON pointer to the array in `structuredContent`.
           */
          pointer: string;
          /**
           * The field an entry and an item share when the entry concerns that item.
           */
          itemKey: string;
          [k: string]: unknown;
        }[];
        [k: string]: unknown;
      };
      [k: string]: unknown;
    }[],
  ];
  [k: string]: unknown;
}
