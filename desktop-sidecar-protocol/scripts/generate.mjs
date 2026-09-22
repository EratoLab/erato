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
    "schemas/methods/indexing-benchmark-list-v1-params.schema.json",
    "indexing-benchmark-list-v1-params.ts",
    "IndexingBenchmarkListV1Params",
  ],
  [
    "schemas/methods/indexing-benchmark-list-v1-result.schema.json",
    "indexing-benchmark-list-v1-result.ts",
    "IndexingBenchmarkListV1Result",
  ],

  [
    "schemas/methods/indexing-benchmark-start-v1-params.schema.json",
    "indexing-benchmark-start-v1-params.ts",
    "IndexingBenchmarkStartV1Params",
  ],
  [
    "schemas/methods/indexing-benchmark-start-v1-result.schema.json",
    "indexing-benchmark-start-v1-result.ts",
    "IndexingBenchmarkStartV1Result",
  ],
  [
    "schemas/methods/indexing-benchmark-status-v1-params.schema.json",
    "indexing-benchmark-status-v1-params.ts",
    "IndexingBenchmarkStatusV1Params",
  ],
  [
    "schemas/methods/indexing-benchmark-status-v1-result.schema.json",
    "indexing-benchmark-status-v1-result.ts",
    "IndexingBenchmarkStatusV1Result",
  ],

  [
    "schemas/methods/indexing-start-v1-params.schema.json",
    "indexing-start-v1-params.ts",
    "IndexingStartV1Params",
  ],
  [
    "schemas/methods/indexing-start-v1-result.schema.json",
    "indexing-start-v1-result.ts",
    "IndexingStartV1Result",
  ],
  [
    "schemas/methods/indexing-stop-v1-params.schema.json",
    "indexing-stop-v1-params.ts",
    "IndexingStopV1Params",
  ],
  [
    "schemas/methods/indexing-stop-v1-result.schema.json",
    "indexing-stop-v1-result.ts",
    "IndexingStopV1Result",
  ],
  [
    "schemas/methods/search-query-v1-params.schema.json",
    "search-query-v1-params.ts",
    "SearchQueryV1Params",
  ],
  [
    "schemas/methods/search-metadata-filter.schema.json",
    "search-metadata-filter.ts",
    "SearchMetadataFilter",
  ],
  [
    "schemas/methods/search-metadata-fields-v1-params.schema.json",
    "search-metadata-fields-v1-params.ts",
    "SearchMetadataFieldsV1Params",
  ],
  [
    "schemas/methods/search-metadata-fields-v1-result.schema.json",
    "search-metadata-fields-v1-result.ts",
    "SearchMetadataFieldsV1Result",
  ],
  [
    "schemas/methods/search-query-v1-result.schema.json",
    "search-query-v1-result.ts",
    "SearchQueryV1Result",
  ],

  [
    "schemas/methods/indexing-reset-v1-result.schema.json",
    "indexing-reset-v1-result.ts",
    "IndexingResetV1Result",
  ],
  [
    "schemas/methods/indexing-reset-v1-params.schema.json",
    "indexing-reset-v1-params.ts",
    "IndexingResetV1Params",
  ],
  [
    "schemas/methods/indexing-status-v1-result.schema.json",
    "indexing-status-v1-result.ts",
    "IndexingStatusV1Result",
  ],
  [
    "schemas/methods/indexing-status-v1-params.schema.json",
    "indexing-status-v1-params.ts",
    "IndexingStatusV1Params",
  ],
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
    "schemas/configuration/sidecar-configuration.schema.json",
    "sidecar-configuration.ts",
    "SidecarConfiguration",
  ],
  [
    "schemas/methods/sidecar-configure-v1-params.schema.json",
    "sidecar-configure-v1-params.ts",
    "SidecarConfigureV1Params",
  ],
  [
    "schemas/methods/sidecar-configure-v1-result.schema.json",
    "sidecar-configure-v1-result.ts",
    "SidecarConfigureV1Result",
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
  [
    "schemas/outlook/message-recipient.schema.json",
    "outlook-message-recipient.ts",
    "OutlookMessageRecipient",
  ],
  [
    "schemas/outlook/message-body.schema.json",
    "outlook-message-body.ts",
    "OutlookMessageBody",
  ],
  [
    "schemas/outlook/conversation-warning.schema.json",
    "outlook-conversation-warning.ts",
    "OutlookConversationWarning",
  ],
  [
    "schemas/outlook/attachment-reference.schema.json",
    "outlook-attachment-reference.ts",
    "OutlookAttachmentReference",
  ],
  [
    "schemas/outlook/conversation-message.schema.json",
    "outlook-conversation-message.ts",
    "OutlookConversationMessage",
  ],
  [
    "schemas/methods/outlook-get-conversation-v1-params.schema.json",
    "outlook-get-conversation-v1-params.ts",
    "OutlookGetConversationV1Params",
  ],
  [
    "schemas/methods/outlook-get-conversation-v1-result.schema.json",
    "outlook-get-conversation-v1-result.ts",
    "OutlookGetConversationV1Result",
  ],
  [
    "schemas/outlook/local-trace-step.schema.json",
    "sidecar-local-trace-step.ts",
    "SidecarLocalTraceStep",
  ],
  [
    "schemas/outlook/local-trace.schema.json",
    "sidecar-local-trace.ts",
    "SidecarLocalTrace",
  ],
  [
    "schemas/methods/sidecar-progress-v1-params.schema.json",
    "sidecar-progress-v1-params.ts",
    "SidecarProgressV1Params",
  ],
  [
    "schemas/methods/sidecar-progress-v1-result.schema.json",
    "sidecar-progress-v1-result.ts",
    "SidecarProgressV1Result",
  ],
  [
    "schemas/outlook/search-hit.schema.json",
    "outlook-search-hit.ts",
    "OutlookSearchHit",
  ],
  [
    "schemas/methods/outlook-search-emails-v1-params.schema.json",
    "outlook-search-emails-v1-params.ts",
    "OutlookSearchEmailsV1Params",
  ],
  [
    "schemas/methods/outlook-search-emails-v1-result.schema.json",
    "outlook-search-emails-v1-result.ts",
    "OutlookSearchEmailsV1Result",
  ],
  [
    "schemas/source/source-descriptor.schema.json",
    "source-descriptor.ts",
    "SourceDescriptor",
  ],
  [
    "schemas/source/folder-hierarchy-node.schema.json",
    "folder-hierarchy-node.ts",
    "SourceFolderHierarchyNode",
  ],
  [
    "schemas/methods/sources-list-v1-params.schema.json",
    "sources-list-v1-params.ts",
    "SourcesListV1Params",
  ],
  [
    "schemas/methods/sources-list-v1-result.schema.json",
    "sources-list-v1-result.ts",
    "SourcesListV1Result",
  ],
  [
    "schemas/methods/sources-get-folder-hierarchy-v1-params.schema.json",
    "sources-get-folder-hierarchy-v1-params.ts",
    "SourcesGetFolderHierarchyV1Params",
  ],
  [
    "schemas/methods/sources-get-folder-hierarchy-v1-result.schema.json",
    "sources-get-folder-hierarchy-v1-result.ts",
    "SourcesGetFolderHierarchyV1Result",
  ],
  [
    "schemas/methods/sources-get-document-v1-params.schema.json",
    "sources-get-document-v1-params.ts",
    "SourcesGetDocumentV1Params",
  ],
  [
    "schemas/methods/sources-get-document-v1-result.schema.json",
    "sources-get-document-v1-result.ts",
    "SourcesGetDocumentV1Result",
  ],
];

const validatorTargets = {
  validateIndexingBenchmarkListV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-params.schema.json",
  validateIndexingBenchmarkListV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-result.schema.json",

  validateIndexingBenchmarkStartV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-params.schema.json",
  validateIndexingBenchmarkStartV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-result.schema.json",
  validateIndexingBenchmarkStatusV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-params.schema.json",
  validateIndexingBenchmarkStatusV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-result.schema.json",

  validateIndexingStartV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-params.schema.json",
  validateIndexingStartV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-result.schema.json",
  validateIndexingStopV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-params.schema.json",
  validateIndexingStopV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-result.schema.json",
  validateSearchQueryV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-params.schema.json",
  validateSearchQueryV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-result.schema.json",
  validateSearchMetadataFieldsV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-params.schema.json",
  validateSearchMetadataFieldsV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-result.schema.json",
  validateIndexingResetV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-result.schema.json",
  validateIndexingResetV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-params.schema.json",
  validateIndexingStatusV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-result.schema.json",
  validateIndexingStatusV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-params.schema.json",
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
  validateSidecarConfigureV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-params.schema.json",
  validateSidecarConfigureV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-result.schema.json",
  validateOutlookListMailboxesV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json",
  validateOutlookListMailboxesV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json",
  validateOutlookListEmailsV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json",
  validateOutlookListEmailsV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json",
  validateOutlookGetConversationV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-params.schema.json",
  validateOutlookGetConversationV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-result.schema.json",
  validateSidecarProgressV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-params.schema.json",
  validateSidecarProgressV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-result.schema.json",
  validateOutlookSearchEmailsV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-params.schema.json",
  validateOutlookSearchEmailsV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-result.schema.json",
  validateSourcesListV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-params.schema.json",
  validateSourcesListV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-result.schema.json",
  validateSourcesGetFolderHierarchyV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-params.schema.json",
  validateSourcesGetFolderHierarchyV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-result.schema.json",
  validateSourcesGetDocumentV1Params:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-params.schema.json",
  validateSourcesGetDocumentV1Result:
    "https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-result.schema.json",
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
  )
  .replace(
    /const (formats\d+) = require\("ajv-formats\/dist\/formats"\)\.fullFormats\.uri;/g,
    "const $1 = (value) => /^(?:[a-z][a-z0-9+\\-.]*:)(?:\\/?\\/)?[^\\s]*$/i.test(value);",
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
