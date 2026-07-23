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
