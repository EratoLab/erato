import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import standaloneCode from "ajv/dist/standalone/index.js";
import addFormats from "ajv-formats";
import { compileFromFile } from "json-schema-to-typescript";

import { listFiles, readJson } from "./lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputArgumentIndex = process.argv.indexOf("--output-dir");
const outputDirectory =
  outputArgumentIndex === -1
    ? path.join(root, "typescript", "src", "generated")
    : path.resolve(process.argv[outputArgumentIndex + 1]);

const typeTargets = [
  [
    "schemas/bootstrap/json-rpc-envelope.schema.json",
    "json-rpc-envelope.ts",
    "JsonRpcEnvelope",
  ],
  [
    "schemas/bootstrap/discover-params.schema.json",
    "discover-params.ts",
    "DiscoverParams",
  ],
  [
    "schemas/bootstrap/discover-result.schema.json",
    "discover-result.ts",
    "DiscoverResult",
  ],
  [
    "schemas/bootstrap/cancel-params.schema.json",
    "cancel-params.ts",
    "CancelParams",
  ],
  [
    "schemas/bootstrap/cancel-result.schema.json",
    "cancel-result.ts",
    "CancelResult",
  ],
  [
    "schemas/bootstrap/error-data.schema.json",
    "error-data.ts",
    "ProtocolErrorData",
  ],
  [
    "schemas/capabilities/capability.schema.json",
    "capability.ts",
    "CapabilityDescriptor",
  ],
  [
    "schemas/outlook/mailbox.schema.json",
    "outlook-mailbox.ts",
    "OutlookMailbox",
  ],
  [
    "schemas/outlook/email-summary.schema.json",
    "outlook-email-summary.ts",
    "OutlookEmailSummary",
  ],
  [
    "schemas/outlook/listing-warning.schema.json",
    "outlook-listing-warning.ts",
    "OutlookListingWarning",
  ],
  [
    "schemas/bootstrap/discovery-document.schema.json",
    "discovery-document.ts",
    "DiscoveryDocument",
  ],
  [
    "schemas/methods/diagnostics-echo-v1-params.schema.json",
    "diagnostics-echo-v1-params.ts",
    "DiagnosticsEchoV1Params",
  ],
  [
    "schemas/methods/diagnostics-echo-v1-result.schema.json",
    "diagnostics-echo-v1-result.ts",
    "DiagnosticsEchoV1Result",
  ],
  [
    "schemas/methods/sidecar-restart-v1-params.schema.json",
    "sidecar-restart-v1-params.ts",
    "SidecarRestartV1Params",
  ],
  [
    "schemas/methods/sidecar-restart-v1-result.schema.json",
    "sidecar-restart-v1-result.ts",
    "SidecarRestartV1Result",
  ],
  [
    "schemas/methods/outlook-list-mailboxes-v1-params.schema.json",
    "outlook-list-mailboxes-v1-params.ts",
    "OutlookListMailboxesV1Params",
  ],
  [
    "schemas/methods/outlook-list-mailboxes-v1-result.schema.json",
    "outlook-list-mailboxes-v1-result.ts",
    "OutlookListMailboxesV1Result",
  ],
  [
    "schemas/methods/outlook-list-emails-v1-params.schema.json",
    "outlook-list-emails-v1-params.ts",
    "OutlookListEmailsV1Params",
  ],
  [
    "schemas/methods/outlook-list-emails-v1-result.schema.json",
    "outlook-list-emails-v1-result.ts",
    "OutlookListEmailsV1Result",
  ],
];

const validatorTargets = {
  validateJsonRpcEnvelope:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json",
  validateDiscoverParams:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json",
  validateDiscoverResult:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json",
  validateCancelParams:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json",
  validateCancelResult:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json",
  validateDiscoveryDocument:
    "https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json",
  validateDiagnosticsEchoV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json",
  validateDiagnosticsEchoV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json",
  validateSidecarRestartV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-params.schema.json",
  validateSidecarRestartV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-result.schema.json",
  validateOutlookListMailboxesV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json",
  validateOutlookListMailboxesV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json",
  validateOutlookListEmailsV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json",
  validateOutlookListEmailsV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json",
};

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const [schemaPath, outputName] of typeTargets) {
  const absoluteSchemaPath = path.join(root, schemaPath);
  const source = await compileFromFile(absoluteSchemaPath, {
    bannerComment:
      "/* This file is generated from the canonical JSON schemas. Do not edit. */",
    cwd: path.dirname(absoluteSchemaPath),
    declareExternallyReferenced: true,
    enableConstEnums: false,
    format: true,
    strictIndexSignatures: false,
    style: { semi: true, singleQuote: false, trailingComma: "all" },
    unknownAny: true,
  });
  await writeFile(path.join(outputDirectory, outputName), source, "utf8");
}

const generatedIndex = `/* This file is generated. Do not edit. */
${typeTargets
  .map(
    ([, outputName, typeName]) =>
      `export type { ${typeName} } from "./${outputName.replace(/\.ts$/, ".js")}";`,
  )
  .join("\n")}
`;
await writeFile(path.join(outputDirectory, "index.ts"), generatedIndex, "utf8");

const schemaFiles = await listFiles(path.join(root, "schemas"), (filePath) =>
  filePath.endsWith(".schema.json"),
);
const schemas = await Promise.all(schemaFiles.map(readJson));
const ajv = new Ajv({
  allErrors: true,
  code: { esm: true, lines: true, source: true },
  schemas,
  strict: true,
});
addFormats(ajv);
for (const schemaId of Object.values(validatorTargets)) {
  ajv.getSchema(schemaId);
}

const validatorSource = `${standaloneCode(ajv, validatorTargets)}\n`
  .replace(
    /const (func\d+) = require\("ajv\/dist\/runtime\/ucs2length"\)\.default;/g,
    "const $1 = (value) => Array.from(value).length;",
  )
  .replace(
    /const (func\d+) = require\("ajv\/dist\/runtime\/equal"\)\.default;/g,
    "const $1 = (left, right) => JSON.stringify(left) === JSON.stringify(right);",
  )
  .replace(
    /const (formats\d+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\["date-time"\];/g,
    "const $1 = { validate: (value) => /^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value)) };",
  );
await writeFile(
  path.join(outputDirectory, "validators.mjs"),
  validatorSource,
  "utf8",
);

const validatorDeclarations = `/* This file is generated. Do not edit. */
export interface ValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}

export interface Validator {
  (value: unknown): boolean;
  errors?: ValidationError[] | null;
}

${Object.keys(validatorTargets)
  .map((name) => `export const ${name}: Validator;`)
  .join("\n")}
`;
await writeFile(
  path.join(outputDirectory, "validators.d.mts"),
  validatorDeclarations,
  "utf8",
);
