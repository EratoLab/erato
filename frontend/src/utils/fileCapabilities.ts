import type { FileCapability } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Check if a file capability has supported operations
 */
export function hasSupportedOperations(capability: FileCapability): boolean {
  return capability.operations.length > 0;
}

/**
 * Extract file extension from filename (lowercase, without dot)
 */
export function getFileExtension(filename: string): string | null {
  if (filename.length === 0 || !filename.includes(".")) {
    return null;
  }
  const extension = filename.split(".").pop()?.toLowerCase();
  return extension ?? null;
}

/**
 * Find file capability by file extension
 * Returns capability or null if no match found
 */
export function findCapabilityByExtension(
  filename: string,
  capabilities: FileCapability[],
): FileCapability | null {
  const extension = getFileExtension(filename);
  if (extension) {
    // Find capability that matches this extension
    // Priority: exact match, then wildcard '*'
    for (const capability of capabilities) {
      if (
        capability.extensions.some((entry) => entry.toLowerCase() === extension)
      ) {
        return capability;
      }
    }
  }

  // Check for wildcard match
  for (const capability of capabilities) {
    if (capability.extensions.includes("*")) {
      return capability;
    }
  }

  return null;
}

/**
 * Validate files against capabilities BEFORE upload
 * Returns { valid: File[], invalid: File[] }
 */
export function validateFiles(
  files: File[],
  capabilities: FileCapability[],
): { valid: File[]; invalid: File[] } {
  const valid: File[] = [];
  const invalid: File[] = [];

  for (const file of files) {
    const capability = findCapabilityByExtension(file.name, capabilities);

    // Upload eligibility is configured independently from the operations
    // available after the file has been uploaded.
    if (
      !capability ||
      !(capability.upload_allowed ?? hasSupportedOperations(capability))
    ) {
      invalid.push(file);
    } else {
      valid.push(file);
    }
  }

  return { valid, invalid };
}
