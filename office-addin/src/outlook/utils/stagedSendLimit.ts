import type {
  ComposerSizeLimit,
  FileUploadItem,
  FileUploadItemWithSize,
} from "@erato/frontend/library";

export interface StagedSendPart {
  name: string;
  size: number;
}

export interface StagedSendLimits {
  maxBytes: number;
  maxFormatted: string;
  maxFiles: number;
}

/**
 * The first reason a send would be refused: a part over the per-file upload
 * limit (each is checked on its own, as the upload does), else more files than
 * one message may carry. Composer files without a known size pass the size
 * check.
 */
export function findStagedSendLimit(
  parts: readonly StagedSendPart[],
  composerFiles: readonly FileUploadItem[],
  limits: StagedSendLimits,
): ComposerSizeLimit | null {
  const oversized = [
    ...parts
      .filter((part) => part.size > limits.maxBytes)
      .map((part) => part.name),
    ...composerFiles.flatMap((file) => {
      const { size } = file as FileUploadItemWithSize;
      return size !== undefined && size > limits.maxBytes
        ? [file.filename]
        : [];
    }),
  ];
  if (oversized.length > 0) {
    return { names: oversized, formatted: limits.maxFormatted, kind: "size" };
  }
  if (parts.length + composerFiles.length > limits.maxFiles) {
    return { names: [], formatted: String(limits.maxFiles), kind: "count" };
  }
  return null;
}
