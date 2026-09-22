/* This file is generated. Do not edit. */
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

export const validateOutlookFileProvenance: Validator;
export const validateIndexingBenchmarkListV1Params: Validator;
export const validateIndexingBenchmarkListV1Result: Validator;
export const validateIndexingBenchmarkStartV1Params: Validator;
export const validateIndexingBenchmarkStartV1Result: Validator;
export const validateIndexingBenchmarkStatusV1Params: Validator;
export const validateIndexingBenchmarkStatusV1Result: Validator;
export const validateIndexingStartV1Params: Validator;
export const validateIndexingStartV1Result: Validator;
export const validateIndexingStopV1Params: Validator;
export const validateIndexingStopV1Result: Validator;
export const validateSearchQueryV1Params: Validator;
export const validateSearchQueryV1Result: Validator;
export const validateSearchMetadataFieldsV1Params: Validator;
export const validateSearchMetadataFieldsV1Result: Validator;
export const validateIndexingResetV1Result: Validator;
export const validateIndexingResetV1Params: Validator;
export const validateIndexingStatusV1Result: Validator;
export const validateIndexingStatusV1Params: Validator;
export const validateJsonRpcEnvelope: Validator;
export const validateDiscoverParams: Validator;
export const validateDiscoverResult: Validator;
export const validateCancelParams: Validator;
export const validateCancelResult: Validator;
export const validateDiscoveryDocument: Validator;
export const validateDiagnosticsEchoV1Params: Validator;
export const validateDiagnosticsEchoV1Result: Validator;
export const validateSidecarRestartV1Params: Validator;
export const validateSidecarRestartV1Result: Validator;
export const validateSidecarConfigureV1Params: Validator;
export const validateSidecarConfigureV1Result: Validator;
export const validateOutlookListMailboxesV1Params: Validator;
export const validateOutlookListMailboxesV1Result: Validator;
export const validateOutlookListEmailsV1Params: Validator;
export const validateOutlookListEmailsV1Result: Validator;
export const validateOutlookGetConversationV1Params: Validator;
export const validateOutlookGetConversationV1Result: Validator;
export const validateSidecarProgressV1Params: Validator;
export const validateSidecarProgressV1Result: Validator;
export const validateOutlookSearchEmailsV1Params: Validator;
export const validateOutlookSearchEmailsV1Result: Validator;
export const validateSourcesListV1Params: Validator;
export const validateSourcesListV1Result: Validator;
export const validateSourcesGetFolderHierarchyV1Params: Validator;
export const validateSourcesGetFolderHierarchyV1Result: Validator;
export const validateSourcesGetDocumentV1Params: Validator;
export const validateSourcesGetDocumentV1Result: Validator;
