/**
 * Pure preflight validator for file upload size limits.
 *
 * Checks each file independently against the configured per-file upload limit.
 * A file exactly equal to the limit is valid; `size > maxSizeBytes` is invalid.
 * The caller must NOT hard-code any size constant; read `maxSizeBytes` from
 * `useUploadFeature()` / `FeatureConfigProvider` and pass it here.
 */

export interface ValidFileSizes {
  valid: true;
}

export interface InvalidFileSizes {
  valid: false;
  /** Files whose size exceeds the configured per-file limit. */
  oversizedFiles: File[];
}

export type FileSizeValidation = ValidFileSizes | InvalidFileSizes;

/**
 * Validates that every file in a batch is within the configured per-file limit.
 *
 * If ANY file exceeds the limit the entire batch is considered invalid and its
 * oversized members are returned so callers can include filenames in error
 * messages. No network or side-effect code is triggered here.
 */
export function validateFileSizes(
  files: File[],
  maxSizeBytes: number,
): FileSizeValidation {
  const oversizedFiles = files.filter((f) => f.size > maxSizeBytes);
  if (oversizedFiles.length === 0) {
    return { valid: true };
  }
  return { valid: false, oversizedFiles };
}
