import Ajv2020 from "ajv/dist/2020";

import { schemaFeatures, usedFeatures } from "./schemaCoverage";

import type { JsonSchema } from "./schemaCoverage";
import type { ErrorObject } from "ajv";

/**
 * A shell contract schema, read the strict way its catalogue and the page's
 * requests are held to it in tests.
 */
export function schemaChecks(schema: JsonSchema & { $id: string }) {
  // `if` blocks name properties their parent declares.
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addSchema(schema);
  const validate = ajv.getSchema(schema.$id);
  if (!validate) throw new Error(`${schema.$id} did not compile`);

  const matches = (pointer: string, value: unknown) => {
    const at = ajv.getSchema(`${schema.$id}${pointer}`);
    if (!at) throw new Error(`no schema at ${pointer}`);
    return at(value) === true;
  };

  return {
    /** Why a document does not fit the schema; empty when it does. */
    errors(document: unknown): ErrorObject[] {
      return validate(document) ? [] : [...(validate.errors ?? [])];
    },
    /** The properties, values and alternatives none of the documents uses. */
    unused(documents: readonly unknown[]): string[] {
      const used = new Set<string>();
      for (const document of documents) {
        for (const feature of usedFeatures(schema, document, matches)) {
          used.add(feature);
        }
      }
      return [...schemaFeatures(schema)].filter((f) => !used.has(f));
    },
  };
}
