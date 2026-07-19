import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/**
 * Append `newFiles` to `existingFiles`, dropping any whose id already appears
 * (first occurrence wins). Shared by the composer, the file-upload store, and
 * the assistant form so attaching the same upload twice is a no-op.
 */
export function mergeUniqueFilesById(
  existingFiles: FileUploadItem[],
  newFiles: FileUploadItem[],
): FileUploadItem[] {
  const seenFileIds = new Set(existingFiles.map((file) => file.id));
  const uniqueNewFiles = newFiles.filter((file) => {
    if (seenFileIds.has(file.id)) {
      return false;
    }

    seenFileIds.add(file.id);
    return true;
  });

  return [...existingFiles, ...uniqueNewFiles];
}
