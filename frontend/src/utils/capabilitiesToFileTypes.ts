import type { FileType } from "./fileTypes";
import type { FileCapability } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Maps backend FileCapability IDs to frontend FileType enum values
 */
const CAPABILITY_ID_TO_FILE_TYPE: Record<string, FileType | null> = {
  word: "document",
  pdf: "pdf",
  excel: "spreadsheet",
  powerpoint: "presentation",
  text: "text",
  image: "image",
  other: null, // Exclude files with no operations
};

/**
 * Check if a file capability has supported operations
 */
export function hasSupportedOperations(capability: FileCapability): boolean {
  return capability.operations.length > 0;
}

/**
 * Convert backend FileCapability array to frontend FileType array
 * Only includes capabilities that have operations (supported files)
 *
 * @param capabilities - Array of file capabilities from the backend
 * @returns Array of FileType values for files that have operations
 */
export function capabilitiesToFileTypes(
  capabilities: FileCapability[],
): FileType[] {
  const fileTypes = new Set<FileType>();

  for (const capability of capabilities) {
    // Skip capabilities with no operations (unsupported files)
    if (!hasSupportedOperations(capability)) {
      continue;
    }

    // Map capability ID to FileType
    const fileType = CAPABILITY_ID_TO_FILE_TYPE[capability.id];

    // Only add valid file types (skip null/unknown)
    if (fileType) {
      fileTypes.add(fileType);
    }
  }

  return Array.from(fileTypes);
}

/**
 * Get all supported file types from capabilities, or fallback to a safe default
 *
 * @param capabilities - Array of file capabilities from the backend
 * @param fallbackTypes - Optional fallback types if capabilities are empty
 * @returns Array of FileType values
 */
export function getSupportedFileTypes(
  capabilities: FileCapability[],
  fallbackTypes?: FileType[],
): FileType[] {
  if (capabilities.length === 0) {
    return fallbackTypes ?? [];
  }

  return capabilitiesToFileTypes(capabilities);
}
