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
export interface DropzoneRejection {
  file: { name: string };
  errors: readonly { code: string }[];
}

function hasRejectionCode(rejection: DropzoneRejection, code: string): boolean {
  return rejection.errors.some((error) => error.code === code);
}

/** Names of the files whose rejection carries the given react-dropzone code. */
export function rejectionNames(
  rejections: readonly DropzoneRejection[],
  code: string,
): string[] {
  return rejections
    .filter((rejection) => hasRejectionCode(rejection, code))
    .map((rejection) => rejection.file.name);
}

/**
 * A rejection can carry several reasons; only the size ones belong in the
 * too-large error. A file that also fails the type check is named in the
 * unsupported-type error instead, so it is left out here.
 */
export function oversizedRejectionNames(
  rejections: readonly DropzoneRejection[],
): string[] {
  return rejectionNames(
    rejections.filter(
      (rejection) => !hasRejectionCode(rejection, "file-invalid-type"),
    ),
    "file-too-large",
  );
}
