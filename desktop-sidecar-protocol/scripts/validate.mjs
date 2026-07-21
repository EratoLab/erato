import path from "node:path";
import { fileURLToPath } from "node:url";

import { openrpcDocument as bundledOpenRpcMetaSchema } from "@open-rpc/meta-schema";
import Ajv from "ajv";
import addFormats from "ajv-formats";

import {
  catalogueDigest,
  formatAjvErrors,
  listFiles,
  readJson,
} from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaFiles = await listFiles(path.join(root, "schemas"), (filePath) =>
  filePath.endsWith(".schema.json"),
);
const schemas = await Promise.all(schemaFiles.map(readJson));
const ajv = new Ajv({ allErrors: true, schemas, strict: true });
addFormats(ajv);

for (const schema of schemas) {
  try {
    ajv.compile(schema);
  } catch (error) {
    throw new Error(`Failed to compile ${schema.$id}: ${String(error)}`);
  }
}

const openrpc = await readJson(path.join(root, "openrpc.json"));
if (openrpc.openrpc !== "1.4.0") {
  throw new Error(
    `openrpc.json must pin OpenRPC 1.4.0, got ${openrpc.openrpc}`,
  );
}

// The latest published npm meta-schema still enumerates versions only through
// 1.3.2. OpenRPC 1.4 retains the same Draft 7 structural meta-schema. Extend
// only the version enum while validating the complete document structure.
const openRpcMetaSchema = structuredClone(bundledOpenRpcMetaSchema);
openRpcMetaSchema.$schema = "http://json-schema.org/draft-07/schema#";
openRpcMetaSchema.properties.openrpc.enum = [
  "1.4.0",
  ...openRpcMetaSchema.properties.openrpc.enum,
];
const openRpcAjv = new Ajv({ allErrors: true, strict: false });
addFormats(openRpcAjv);
// The npm package references its generic JSON-Schema meta-schema without
// shipping it. Schema Objects are validated independently above, so a
// permissive placeholder is sufficient for resolving those two references.
const permissiveSchemaObjectMeta = {
  $id: "https://meta.json-schema.tools",
  definitions: {
    JSONSchemaObject: {
      properties: { $ref: true },
    },
  },
};
openRpcAjv.addSchema(permissiveSchemaObjectMeta);
openRpcAjv.addSchema(
  { ...permissiveSchemaObjectMeta, $id: "https://meta.json-schema.tools/" },
  "https://meta.json-schema.tools/",
);
const validateOpenRpc = openRpcAjv.compile(openRpcMetaSchema);
if (!validateOpenRpc(openrpc)) {
  throw new Error(
    `openrpc.json does not match the OpenRPC meta-schema: ${formatAjvErrors(
      validateOpenRpc.errors,
    )}`,
  );
}

const validateDiscovery = ajv.getSchema(
  "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json",
);
if (!validateDiscovery?.(openrpc)) {
  throw new Error(
    `openrpc.json does not match the Erato discovery contract: ${formatAjvErrors(
      validateDiscovery?.errors,
    )}`,
  );
}

const expectedDigest = catalogueDigest(openrpc);
if (openrpc["x-erato-catalogue"].digest !== expectedDigest) {
  throw new Error(
    `openrpc.json catalogue digest is stale; expected ${expectedDigest}`,
  );
}

const localReferenceFiles = new Set([
  path.resolve(root, "openrpc.json"),
  ...schemaFiles.map((filePath) => path.resolve(filePath)),
]);

function resolvePointer(document, pointer) {
  if (pointer === "" || pointer === "/") return document;
  return pointer
    .split("/")
    .slice(1)
    .reduce((value, segment) => {
      const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
      return value?.[key];
    }, document);
}

async function validateReferences(document, sourceFile) {
  if (document === null || typeof document !== "object") return;
  if (typeof document.$ref === "string") {
    const [filePart, fragment = ""] = document.$ref.split("#", 2);
    if (!filePart.startsWith("http:") && !filePart.startsWith("https:")) {
      const referencedFile = filePart
        ? path.resolve(path.dirname(sourceFile), filePart)
        : sourceFile;
      if (!localReferenceFiles.has(referencedFile)) {
        throw new Error(
          `${sourceFile} references missing file ${document.$ref}`,
        );
      }
      const referencedDocument = await readJson(referencedFile);
      if (
        fragment &&
        resolvePointer(referencedDocument, fragment) === undefined
      ) {
        throw new Error(
          `${sourceFile} references missing pointer ${document.$ref}`,
        );
      }
    }
  }
  for (const value of Object.values(document)) {
    await validateReferences(value, sourceFile);
  }
}

await validateReferences(openrpc, path.join(root, "openrpc.json"));
for (let index = 0; index < schemas.length; index += 1) {
  await validateReferences(schemas[index], schemaFiles[index]);
}

const validators = {
  "rpc.discover:params": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json",
  ),
  "rpc.discover:result": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json",
  ),
  "erato.cancel:params": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json",
  ),
  "erato.cancel:result": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json",
  ),
  "diagnostics.echo.v1:params": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json",
  ),
  "diagnostics.echo.v1:result": ajv.getSchema(
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json",
  ),
};
const validateEnvelope = ajv.getSchema(
  "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json",
);

for (const exampleFile of await listFiles(
  path.join(root, "examples"),
  (filePath) => filePath.endsWith(".json"),
)) {
  const example = await readJson(exampleFile);
  const pendingMethods = new Map();
  for (const entry of example.messages) {
    const message = structuredClone(entry.message);
    if (message.resultFrom) {
      message.result = await readJson(
        path.resolve(path.dirname(exampleFile), message.resultFrom),
      );
      delete message.resultFrom;
    }
    if (message.result?.documentFrom) {
      message.result.document = await readJson(
        path.resolve(path.dirname(exampleFile), message.result.documentFrom),
      );
      delete message.result.documentFrom;
    }
    if (!validateEnvelope?.(message)) {
      throw new Error(
        `${exampleFile} has an invalid envelope: ${formatAjvErrors(
          validateEnvelope?.errors,
        )}`,
      );
    }
    if (message.method && message.id !== undefined) {
      pendingMethods.set(String(message.id), message.method);
    }
    if (message.method && message.params !== undefined) {
      const validator = validators[`${message.method}:params`];
      if (validator && !validator(message.params)) {
        throw new Error(
          `${exampleFile} has invalid ${message.method} params: ${formatAjvErrors(
            validator.errors,
          )}`,
        );
      }
    }
    if ("result" in message) {
      const method = pendingMethods.get(String(message.id));
      const validator = validators[`${method}:result`];
      if (validator && !validator(message.result)) {
        throw new Error(
          `${exampleFile} has invalid ${method} result: ${formatAjvErrors(
            validator.errors,
          )}`,
        );
      }
      pendingMethods.delete(String(message.id));
    }
  }
}

for (const fixtureFile of await listFiles(
  path.join(root, "conformance", "fixtures"),
  (filePath) => filePath.endsWith(".json"),
)) {
  await readJson(fixtureFile);
}

console.log(
  `Validated ${schemas.length} schemas, openrpc.json, examples, and conformance fixtures.`,
);
