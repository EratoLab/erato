/** Per-file size preflight. Exactly at the limit is valid. Limit comes from `useUploadFeature()`. */

export interface ValidFileSizes {
  valid: true;
}

export interface InvalidFileSizes {
  valid: false;
  /** Files whose size exceeds the configured per-file limit. */
  oversizedFiles: File[];
}

export type FileSizeValidation = ValidFileSizes | InvalidFileSizes;

/** One oversized file fails the whole batch; the offenders are returned for the message. */
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

/** Structural react-dropzone rejection, kept local to avoid the dependency. */
interface SizeRejection {
  file: { name: string };
  errors: readonly { code: string }[];
}

/** A rejection can carry several reasons; only the size ones belong in the too-large error. */
export function oversizedRejectionNames(
  rejections: readonly SizeRejection[],
): string[] {
  return rejections
    .filter((rejection) =>
      rejection.errors.some((error) => error.code === "file-too-large"),
    )
    .map((rejection) => rejection.file.name);
}
